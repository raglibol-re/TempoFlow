/**
 * Attention proofing for paid ad-watching. The advertiser pays a viewer ONLY
 * while that viewer is *provably* attending — and "provably" is layered:
 *
 *   L1 passive  — a heartbeat only counts when the viewer's tab is VISIBLE, the
 *                 ad video is actually PLAYING, and the player is ON-SCREEN.
 *                 (Client-reported, so advisory — stops the honest "leave it in a
 *                 background tab" cheat, not a determined script.)
 *   L2 active   — at random intervals the server issues a CHALLENGE: an
 *                 unpredictable token plus a random on-screen position. The viewer
 *                 must echo the token back (by tapping the target rendered on the
 *                 ad) within ANSWER_MS. Miss it → attention goes stale → payment
 *                 pauses until they respond. This is what actually forces a human
 *                 to be looking at the screen.
 *   L3 binding  — every heartbeat must carry the per-session TOKEN handed out when
 *                 the viewer opened the session. A blind `curl` loop with no
 *                 session (or a stale token) mints no attention.
 *
 * ⚠️ TESTNET / demo-grade. L1 signals are spoofable and L2 could be scripted by
 * someone who reimplements the protocol; the goal is to make casual gaming
 * impossible and scripted gaming expensive, not to be Sybil-proof.
 */

import { randomBytes } from "node:crypto";

const HEARTBEAT_TTL_MS = 2500; // a "fresh" (attentive) beat must be newer than this
const PRESENCE_TTL_MS = 20000; // viewer is "still here" if ANY beat arrived this recently
                               // (look-away keeps beating; only truly leaving stops it)
const ANSWER_MS = 6000; // grace window to respond to a challenge (still paid during it)
const CHALLENGE_MIN_GAP_MS = 8000; // soonest the next challenge may appear
const CHALLENGE_MAX_GAP_MS = 16000; // latest

export interface Challenge {
  id: string; // unpredictable token the client must echo back
  x: number; // target position, % of player width  (15–85)
  y: number; // target position, % of player height (15–85)
  answerMs: number; // how long the client has to respond
}

interface Signals {
  visible?: boolean; // document.visibilityState === "visible"
  playing?: boolean; // ad video actually playing (not paused/ended)
  onScreen?: boolean; // player is in the viewport
}

interface Session {
  token: string;
  lastBeat: number; // ms timestamp of the last VALID beat (present, even if looked away)
  lastGoodBeat: number; // ms timestamp of the last beat that passed L1+L3 and wasn't challenge-overdue
  challenge: (Challenge & { issuedAt: number }) | null;
  nextChallengeAt: number; // when the next challenge becomes due
}

const sessions = new Map<string, Session>();
const key = (campaignId: string, viewer: string) => `${campaignId}:${viewer}`;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const newToken = () => randomBytes(8).toString("hex");
const scheduleNext = (now: number) => now + rand(CHALLENGE_MIN_GAP_MS, CHALLENGE_MAX_GAP_MS);

/** Open (or re-open) an attention session for a viewer on a campaign. Returns the
 *  token the client must include with every subsequent heartbeat. */
export function openSession(campaignId: string, viewer: string): { token: string } {
  const now = Date.now();
  const token = newToken();
  sessions.set(key(campaignId, viewer), {
    token,
    lastBeat: 0,
    lastGoodBeat: 0,
    challenge: null,
    nextChallengeAt: scheduleNext(now),
  });
  return { token };
}

export interface HeartbeatResult {
  ok: boolean;
  paused: boolean; // true → not currently counting as attention (won't be paid)
  reason?: "no-session" | "bad-token" | "inattentive" | "challenge";
  challenge: Challenge | null; // present → client must render + answer it
}

/** Record a heartbeat. Only refreshes attention when L1 signals pass, the token
 *  matches (L3), and any outstanding challenge isn't overdue (L2). May hand back a
 *  fresh challenge for the client to render. */
export function heartbeat(
  campaignId: string,
  viewer: string,
  token: string | undefined,
  signals: Signals,
): HeartbeatResult {
  const now = Date.now();
  const s = sessions.get(key(campaignId, viewer));
  if (!s) return { ok: false, paused: true, reason: "no-session", challenge: null };
  if (!token || token !== s.token) return { ok: false, paused: true, reason: "bad-token", challenge: null };

  // Presence: ANY valid beat means the viewer is still here (even looked-away beats
  // carry visible:false). Keeps the channel open across look-aways so payment can
  // resume instantly — we only tear the channel down once these stop entirely.
  s.lastBeat = now;

  const pub = (c: Session["challenge"]): Challenge | null =>
    c ? { id: c.id, x: c.x, y: c.y, answerMs: c.answerMs } : null;

  // L1: passive gate. Hidden tab / scrolled-away player / manual look-away → don't
  // count, and don't run the challenge clock (no point quizzing someone who's away).
  // NOTE: we intentionally do NOT require `playing` here — the ad video only starts
  // playing once payment is flowing, so gating payment on `playing` would deadlock
  // (and emoji-only ads have no <video> at all). `visible` already folds in the
  // manual look-away toggle from the client.
  const attentive = signals.visible !== false && signals.onScreen !== false;
  if (!attentive) return { ok: true, paused: true, reason: "inattentive", challenge: pub(s.challenge) };

  // L2: challenge handling.
  if (s.challenge) {
    const overdue = now - s.challenge.issuedAt > s.challenge.answerMs;
    if (overdue) {
      // Unanswered past the window → stop refreshing attention so payment pauses.
      // Keep the same challenge outstanding until they finally tap it.
      return { ok: true, paused: true, reason: "challenge", challenge: pub(s.challenge) };
    }
    // Within the grace window: still attentive (don't punish instantly).
    s.lastGoodBeat = now;
    return { ok: true, paused: false, challenge: pub(s.challenge) };
  }

  // No outstanding challenge: maybe it's time to issue one.
  if (now >= s.nextChallengeAt) {
    s.challenge = {
      id: newToken(),
      x: Math.round(rand(15, 85)),
      y: Math.round(rand(15, 85)),
      answerMs: ANSWER_MS,
      issuedAt: now,
    };
    s.lastGoodBeat = now;
    return { ok: true, paused: false, challenge: pub(s.challenge) };
  }

  s.lastGoodBeat = now;
  return { ok: true, paused: false, challenge: null };
}

/** Answer the outstanding challenge by echoing its id. Clears it, schedules the
 *  next one, and refreshes attention so payment resumes immediately. */
export function answer(
  campaignId: string,
  viewer: string,
  token: string | undefined,
  challengeId: string,
): { ok: boolean; reason?: string } {
  const now = Date.now();
  const s = sessions.get(key(campaignId, viewer));
  if (!s) return { ok: false, reason: "no-session" };
  if (!token || token !== s.token) return { ok: false, reason: "bad-token" };
  if (!s.challenge || s.challenge.id !== challengeId) return { ok: false, reason: "no-match" };
  s.challenge = null;
  s.nextChallengeAt = scheduleNext(now);
  s.lastGoodBeat = now;
  return { ok: true };
}

/** Is the viewer's attention currently fresh enough to pay for? */
export function isAttentionFresh(campaignId: string, viewer: string): boolean {
  const s = sessions.get(key(campaignId, viewer));
  return s != null && Date.now() - s.lastGoodBeat <= HEARTBEAT_TTL_MS;
}

/** Has the viewer truly LEFT (no beats at all for a while)? A look-away keeps
 *  beating, so this stays false — the payment channel can stay open and resume.
 *  Only a real departure (tab closed, navigated away, Stop) flips this true, which
 *  is the signal to close the channel and refund the advertiser's unspent deposit. */
export function isGone(campaignId: string, viewer: string): boolean {
  const s = sessions.get(key(campaignId, viewer));
  return !!s && s.lastBeat > 0 && Date.now() - s.lastBeat > PRESENCE_TTL_MS;
}

/** Drop a session entirely (on explicit stop) so a fresh watch starts clean. */
export function endSession(campaignId: string, viewer: string): void {
  sessions.delete(key(campaignId, viewer));
}
