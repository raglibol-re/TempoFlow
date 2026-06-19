/**
 * TempoFlow — pay-per-second streaming (Twitch/YouTube/DAZN-style).
 * Watch creators (money out/sec), earn from ads (money in/sec), upload videos,
 * run campaigns, manage your profile. Payments are shown as app credit; faucet
 * funding and Tempo settlement stay on the server.
 */
import "./tailwind.css";
import "./styles.css";
import { StrictMode, useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { SparklesCore } from "@/components/ui/sparkles";
import { createRoot } from "react-dom/client";
import type { Clip, Campaign } from "@flow/shared";
import { PLATFORM_FEE } from "@flow/shared";
import {
  fetchUsers, fetchFeed, fetchCampaigns, fetchNet, fetchBalance,
  fundUser, resetNet, sendHeartbeat, runAd, uploadAd, fundCampaign, stopCampaign, fetchEscrowAddress, uploadClip, setClipPrice, watchClip,
  videoSrc, connectTempoAccount, registerAppAccount, syncCheckoutSession, createCampaign, openAttentionSession, answerChallenge, stopAd,
  fetchProfile, updateProfile, uploadProfilePic, picSrc, followCreator, unfollowCreator,
  sendTip, runAuction, matchAd, askCreator, fetchGoals, createGoal, pledgeGoal, goLive, stopLive, cheerLive, fetchLiveStats, liveHostBeat, endLiveBeacon, explorerTxUrl, explorerAddressUrl, tempoAppUrl, exportPrivateKey, ensureKey, isValidKey, updateClipMeta, deleteClip,
  viewClip, toggleLike, fetchSocial, fetchVideoPopularity, postComment, fetchLiveChat, postLiveChat, type SocialComment,
  SERVER_CONFIGURED, saveServerUrl,
  type DemoUser, type Tick, type CloseSummary, type WatchHandle, type NetSnapshot, type AttentionChallenge,
  type Profile as ProfileData, type PublicUser, type Goal, type AuctionResult, type LiveStats, type AskEvent,
} from "./flow";
import { popularityPath, positionToTime, watchCountAtSecond, type SecondPopularity } from "./video-timeline";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const nf = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 });
const usd = (n: number) => "$" + nf(n);
const fmtBal = usd;
const shortHash = (h: string) => (h.length > 22 ? `${h.slice(0, 12)}…${h.slice(-8)}` : h);
const copy = (t: string) => { try { navigator.clipboard?.writeText(t); } catch { /* no clipboard */ } };

// Theme: dark by default. Applied to <html data-theme> before React renders (no flash).
type Theme = "dark" | "light";
function applyTheme(t: Theme) { try { document.documentElement.dataset.theme = t; localStorage.setItem("tempoflow-theme", t); } catch { /* no storage */ } }
const initialTheme: Theme = (() => { try { return (localStorage.getItem("tempoflow-theme") as Theme) || "dark"; } catch { return "dark"; } })();
applyTheme(initialTheme);

// ───────────────────────── brand mark (logo) ─────────────────────────
/** TempoFlow logo: a play head streaming forward over a flow wave (money/sec).
 *  Same artwork as /favicon.svg so the tab icon and the in-app logo match. */
function BrandMark({ size = 24 }: { size?: number }) {
  const gid = `tf-${size}`;
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent2)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill={`url(#${gid})`} />
      <path d="M12 8.2 L23 15.2 a0.95 0.95 0 0 1 0 1.6 L12 23.8 Z" fill="#fff" />
      <path d="M5 26.4 q3.2 -3.4 6.4 0 t6.4 0 t6.4 0" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

// ───────────────────────── money-flow canvas ─────────────────────────
function MoneyFlow({ dir, active }: { dir: "in" | "out"; active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const on = useRef(active); on.current = active;
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const W = (cv.width = cv.offsetWidth * dpr), H = (cv.height = 44 * dpr);
    const col = dir === "out" ? [255, 93, 115] : [43, 217, 160];
    const ps: { x: number; y: number; v: number; r: number; a: number }[] = [];
    let raf = 0, acc = 0;
    const loop = () => {
      ctx.clearRect(0, 0, W, H);
      if (on.current && ++acc % 3 === 0) {
        const fl = dir === "in";
        ps.push({ x: fl ? -6 : W + 6, y: Math.random() * H, v: (1.6 + Math.random() * 2.6) * dpr * (fl ? 1 : -1), r: (1.4 + Math.random() * 2.4) * dpr, a: 1 });
      }
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]!; p.x += p.v; p.a -= 0.004;
        if (p.a <= 0 || p.x < -10 || p.x > W + 10) { ps.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${p.a})`;
        ctx.shadowBlur = 8 * dpr; ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},.9)`; ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, [dir]);
  return <canvas ref={ref} className="flowcanvas" />;
}

// ───────────────────────── login ─────────────────────────
const ROLES: Record<string, string> = { viewer: "Viewers", creator: "Creators", advertiser: "Advertisers" };
function Login({ users, onLogin, onError }: { users: DemoUser[]; onLogin: (u: DemoUser) => void; onError: (e: string) => void }) {
  const [key, setKey] = useState(""); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(""); const [handle, setHandle] = useState("");
  const [created, setCreated] = useState<DemoUser | null>(null); // new account → show its key to save
  const [copied, setCopied] = useState(false);
  const demo = users.filter((u) => u.key && !u.id.startsWith("me-")); // seed accounts only
  async function connect() {
    if (!key.trim()) return; setBusy(true);
    try { onLogin(await connectTempoAccount(key)); } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  async function createAccount() {
    if (!name.trim() || !handle.trim()) return; setBusy(true);
    try { setCreated(await registerAppAccount(name.trim(), handle.trim())); } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  const Hero = (
    <div className="login-hero">
      <SparklesCore background="transparent" minSize={0.6} maxSize={1.6} particleDensity={200} speed={1.4} particleColor="#9147ff" className="login-hero-sparkles" />
      <div className="brand" style={{ fontSize: 30, justifyContent: "center", position: "relative", zIndex: 1 }}><BrandMark size={40} />Tempo<b>Flow</b></div>
      <div className="login-hero-mask" />
    </div>
  );

  // After creating an account: reveal the private key ONCE so the user can save it —
  // that key is their login on any device, and is also exportable later in Settings.
  if (created) {
    return (
      <div className="login">
        {Hero}
        <div className="login-card">
          <h3 style={{ marginTop: 0 }}>✓ Account created — save your key</h3>
          <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
            This private key <b>is</b> your login. Save it now — paste it under “Log in with your key” to return on any device. It’s also always available in <b>Settings → Export key</b> while you’re signed in. ⚠️ TESTNET key only — never a mainnet key.
          </div>
          <div className="mono" style={{ fontSize: 11, wordBreak: "break-all", background: "#0003", padding: "9px 10px", borderRadius: 8, lineHeight: 1.5 }}>{created.key || "(loading your key…)"}</div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn btn-sm" onClick={() => { if (created.key) { navigator.clipboard?.writeText(created.key); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? "✓ copied" : "Copy key"}</button>
            <button className="btn" style={{ flex: 1 }} onClick={() => onLogin(created)}>I saved it — enter TempoFlow →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <section className="login-aside">
        <div className="brand login-brand"><BrandMark size={34} />Tempo<b>Flow</b></div>
        <div className="login-eyebrow">Streaming commerce platform</div>
        <h1>Sign in to manage real-time creator payments.</h1>
        <p>Watch videos by the second, fund ad campaigns, and track app credit from one account.</p>
        <div className="login-metrics" aria-label="Platform capabilities">
          <div><b>1s</b><span>metered billing</span></div>
          <div><b>Testnet</b><span>demo funds</span></div>
          <div><b>Ledger</b><span>auditable balance</span></div>
        </div>
      </section>

      <main className="login-panel">
        <div className="login-panel-head">
          <h2>Create account</h2>
          <p>We create a Tempo testnet wallet for you. Save the private key after account creation; it is how you return later.</p>
        </div>
        <div className="login-form">
          <label className="fld">Display name<input className="input" placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="fld">Handle<input className="input" placeholder="jane.doe" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createAccount()} /></label>
          <button className="btn login-primary" onClick={createAccount} disabled={busy || !name.trim() || !handle.trim()}>{busy ? "Creating account…" : "Continue"}</button>
        </div>

        <div className="returning-login">
          <div className="login-panel-head compact">
            <h2>Returning user</h2>
            <p>Paste the private key you saved to restore your channel, balance, and history.</p>
          </div>
          <div className="login-form compact">
            <input className="input" type="password" placeholder="0x… your private key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()} />
            <button className="btn btn-ghost login-primary" onClick={connect} disabled={busy || !key.trim()}>{busy ? "Logging in…" : "Log in with key"}</button>
          </div>
        </div>

        <div className="login-separator"><span>or continue with a demo profile</span></div>
        <div className="demo-directory">
          {["viewer", "creator", "advertiser"].map((r) => {
            const us = demo.filter((u) => u.role === r); if (!us.length) return null;
            return (
              <div key={r} className="demo-group">
                <div className="role-chip">{ROLES[r]}</div>
                <div className="login-grid">
                  {us.map((u) => (
                    <button key={u.id} className="login-acct" onClick={() => onLogin(u)}>
                      <span className="login-acct-avatar">{u.avatar}</span>
                      <span className="login-acct-copy">
                        <b>{u.name}</b>
                        <small>@{u.handle}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="login-foot">Your testnet key is your login. Save it once, export it anytime in Settings.</div>
      </main>
    </div>
  );
}

function BackendSetup({ error }: { error?: string | null }) {
  const [url, setUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  function save() {
    try { saveServerUrl(url); } catch (e: any) { setLocalError(e?.message ?? String(e)); }
  }
  return (
    <div className="backend-page">
      <SparklesCore
        background="transparent"
        minSize={0.5}
        maxSize={1.3}
        particleDensity={90}
        speed={0.8}
        particleColor="#9147ff"
        className="backend-sparkles"
      />
      <div className="backend-shell">
        <div className="backend-copy">
          <div className="brand backend-brand"><BrandMark size={36} />Tempo<b>Flow</b></div>
          <div className="backend-kicker">pay-per-second streaming</div>
          <h1>Connect the live backend to open the platform.</h1>
          <p>
            The web app is deployed. It just needs the server URL that provides
            profiles, videos, test funds, and real-time rewards.
          </p>
          <div className="backend-pills">
            <span>App credit</span>
            <span>Creator payouts</span>
            <span>Ad rewards</span>
          </div>
        </div>

        <div className="backend-card">
          <div className="backend-card-head">
            <div>
              <div className="backend-card-title">Backend URL</div>
              <div className="backend-card-sub">Paste your HTTPS tunnel or hosted server.</div>
            </div>
            <span className="backend-status">not connected</span>
          </div>
          <div className="backend-form">
            <input
              className="input backend-input"
              placeholder="https://your-backend.trycloudflare.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              autoFocus
            />
            <button className="btn backend-submit" onClick={save} disabled={!url.trim()}>Connect</button>
          </div>
          {(localError || error) && <div className="toast-err backend-error">{localError || error}</div>}
          <div className="backend-steps">
            <div><b>1</b><span>Run <code>pnpm dev</code> locally.</span></div>
            <div><b>2</b><span>Run <code>pnpm tunnel</code> in another terminal.</span></div>
            <div><b>3</b><span>Paste the printed HTTPS URL here.</span></div>
          </div>
        </div>

        <div className="backend-preview" aria-hidden="true">
          <div className="preview-top">
            <span />
            <span />
            <span />
          </div>
          <div className="preview-hero">
            <div className="preview-video" />
            <div className="preview-panel">
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="preview-grid">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── video card / grid ─────────────────────────
function VideoCard({ clip, owner, onOpen, onProfile }: { clip: Clip; owner?: PublicUser; onOpen: () => void; onProfile?: (id: string) => void }) {
  return (
    <div className="vcard" onClick={onOpen}>
      <div className="vthumb">
        {clip.hasVideo
          ? <video src={videoSrc(clip.id) + "#t=0.1"} preload="metadata" muted playsInline />
          : <span className="emoji">{clip.thumb ?? "🎬"}</span>}
        <div className="play">▶</div>
        <span className="badge">${clip.pricePerSec}/s</span>
        {clip.tags.includes("live") && <span className="badge live">● LIVE</span>}
      </div>
      <div className="vmeta">
        {owner
          ? <Avatar user={owner} size={32} onClick={onProfile ? () => onProfile(owner.id) : undefined} />
          : <div className="a">{clip.thumb ?? "🎬"}</div>}
        <div>
          <div className="vtitle">{clip.title}</div>
          <div className="vchan">
            {owner && onProfile
              ? <span className="chan-link" onClick={(e) => { e.stopPropagation(); onProfile(owner.id); }}>@{clip.creator}</span>
              : <>@{clip.creator}</>}
            {clip.recipients.length > 1 ? " · collab" : ""}
          </div>
          <div className="vchan" style={{ marginTop: 2 }}>{clip.live ? "● live now" : `${clip.views ?? 0} views`}{(clip.likeCount ?? 0) > 0 ? ` · ♥ ${clip.likeCount}` : ""}{(clip.commentCount ?? 0) > 0 ? ` · 💬 ${clip.commentCount}` : ""}</div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── watch view (payment panel) ─────────────────────────
// ───────────────────────── tip boost (Feature 1) ─────────────────────────
function TipBoost({ me, clip, active, onTipped }: { me: DemoUser; clip: Clip; active: boolean; onTipped?: () => void }) {
  const [boost, setBoost] = useState(0); // extra $/sec streamed on top of watchtime
  const [tipped, setTipped] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const boostRef = useRef(0); boostRef.current = boost;
  const send = async (amt: number) => {
    const r = await sendTip(me.id, clip.id, amt).catch(() => null);
    if (r?.ok) { setTipped((t) => +(t + amt).toFixed(6)); setNote(null); onTipped?.(); }
    else { setNote("out of credit"); setBoost(0); }
  };
  useEffect(() => {
    if (!active || boost <= 0) return;
    const id = setInterval(() => { void send(boostRef.current); }, 1000);
    return () => clearInterval(id);
  }, [active, boost, clip.id, me.id]);
  return (
    <div className="tipbox">
      <div className="tip-head">💜 Tip {clip.creator}{tipped > 0 && <span className="tip-total">+{usd(tipped)} sent</span>}</div>
      <div className="tip-quick">
        {[0.05, 0.25, 1].map((v) => <button key={v} className="btn btn-ghost btn-sm" onClick={() => send(v)}>+{usd(v)}</button>)}
      </div>
      <div className="tip-boost">
        <span className="muted" style={{ fontSize: 12 }}>stream a boost while watching</span>
        <div className="tip-boost-opts">
          {[0, 0.01, 0.05, 0.1].map((v) => (
            <button key={v} className={"chip " + (boost === v ? "chip-ok" : "")} onClick={() => setBoost(v)}>{v === 0 ? "off" : `+${usd(v)}/s`}</button>
          ))}
        </div>
      </div>
      {note && <div className="muted" style={{ fontSize: 11.5, color: "var(--out)" }}>{note}</div>}
    </div>
  );
}

// ───────────────────────── live meter + cheer (Feature 5) ─────────────────
function LiveMeter({ clipId, onEnded }: { clipId: string; onEnded?: () => void }) {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [applause, setApplause] = useState(0);
  const endedFired = useRef(false);
  useEffect(() => {
    let on = true;
    const tick = () => fetchLiveStats(clipId).then((s) => {
      if (!on) return;
      setStats(s); setApplause((a) => Math.max(a, s.applause));
      if (s.ended && !endedFired.current) { endedFired.current = true; onEnded?.(); }
    }).catch(() => {});
    tick(); const id = setInterval(tick, 1500); return () => { on = false; clearInterval(id); };
  }, [clipId]);
  const cheer = async () => { setApplause((a) => a + 1); await cheerLive(clipId); };
  return (
    <div className="livemeter">
      <div className="live-row"><span className="live-badge">● LIVE</span><span><b>{stats?.viewers ?? 0}</b> watching now</span></div>
      <div className="statline"><span className="k">combined</span><span style={{ color: "var(--in)" }}>{usd(stats?.perSecUsd ?? 0)}/sec → creator</span></div>
      <div className="statline"><span className="k">this stream</span><span>{usd(stats?.totalUsd ?? 0)}</span></div>
      <button className="btn btn-ghost btn-sm cheer-btn" onClick={cheer}>👏 Cheer · {applause}</button>
    </div>
  );
}

/** The creator's own LIVE view. The stream stays live only while the host is on this
 *  page (heartbeats); leaving the page or hitting End ends it (and the server sweeps
 *  it away if the host vanishes). Distinct from watching a regular video. */
function HostLiveView({ clip, me, onBack, onEnded }: { clip: Clip; me: DemoUser; onBack: () => void; onEnded: () => void }) {
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    let on = true;
    const beat = () => { if (on) void liveHostBeat(clip.id, me.id); };
    beat(); const id = setInterval(beat, 5000);
    const onUnload = () => endLiveBeacon(clip.id, me.id);
    window.addEventListener("beforeunload", onUnload);
    // NOTE: no stopLive on unmount (StrictMode double-invokes cleanups) — when the
    // host leaves, heartbeats stop and the server sweep ends the stream within ~15s.
    return () => { on = false; clearInterval(id); window.removeEventListener("beforeunload", onUnload); };
  }, [clip.id, me.id]);
  async function end(then: () => void) { setEnding(true); await stopLive(clip.id, me.id); then(); }
  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={() => end(onBack)}>← Back (ends stream)</button><span className="muted">you’re live · hosting</span></div>
      <div className="watch">
        <div>
          <div className="player">
            {clip.hasVideo ? <video src={videoSrc(clip.id)} autoPlay loop muted playsInline /> : <span className="emoji">🔴</span>}
            <span className="live-badge player-live">● LIVE</span>
          </div>
          <div className="w-title">{clip.title}</div>
          <div className="w-chan"><div className="a">🔴</div><div><b>@{clip.creator}</b><div className="muted" style={{ fontSize: 12.5 }}>your live stream · viewers pay you per second</div></div></div>
          <div className="receipt" style={{ marginTop: 12 }}>You’re the host. The stream is live while you’re on this page and <b>ends automatically if you leave</b>. Each viewer pays you on-chain per second — watch it add up in the meter.</div>
        </div>
        <div className="panel">
          <h3><span className="livedot on" /> your live stream</h3>
          <LiveMeter clipId={clip.id} />
          <div style={{ marginTop: 12 }}><LiveChat clipId={clip.id} me={me} /></div>
          <button className="btn" style={{ width: "100%", marginTop: 12, background: "var(--out)", borderColor: "var(--out)" }} onClick={() => end(onEnded)} disabled={ending}>{ending ? "ending…" : "■ End stream"}</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── attention auction (Feature 2) ─────────────────
function AuctionPanel({ me, onStart }: { me: DemoUser; onStart: (campaignId: string, clearingUsd: number) => void }) {
  const [res, setRes] = useState<AuctionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setRes(await runAuction(me.id)); } catch { /* keep last */ } setBusy(false); };
  useEffect(() => { void run(); /* eslint-disable-next-line */ }, []);
  return (
    <div className="auction">
      <div className="auction-head"><b>⚡ Live attention auction</b><button className="btn btn-ghost btn-sm" onClick={run} disabled={busy}>{busy ? "…" : "↻ refresh bids"}</button></div>
      <div className="muted" style={{ fontSize: 12.5, margin: "2px 0 10px" }}>Advertisers bid for your attention. Highest bid wins the slot — but you’re paid the <b>second-highest</b> price (Vickrey), so bidding honestly is the best strategy.</div>
      {!res ? <div className="muted">running auction…</div> : (<>
        <div className="bidbook">
          {res.bids.map((b) => (
            <div key={b.campaignId} className={"bidrow" + (res.winner?.id === b.campaignId ? " win" : "") + (b.funded ? "" : " dim")}>
              <span>{res.winner?.id === b.campaignId ? "🏆 " : ""}{b.advertiser}</span>
              <span className="muted">{usd(b.bidUsd)}/s{b.funded ? "" : " · unfunded"}</span>
            </div>
          ))}
          {!res.bids.length && <div className="muted">No campaigns yet.</div>}
        </div>
        {res.winner ? (
          <div className="auction-win">
            <div>Winner <b>{res.winner.advertiser}</b> · you earn <b style={{ color: "var(--in)" }}>{usd(res.clearingUsd)}/sec</b> <span className="muted">(clearing price)</span></div>
            <button className="btn" onClick={() => onStart(res.winner!.id, res.clearingUsd)}>▶ Earn from the winner</button>
          </div>
        ) : <div className="muted">No funded bidders right now — fund an ad to seed the auction.</div>}
      </>)}
    </div>
  );
}

// ───────────────────────── crowdfund goal (Feature 4) ─────────────────────
function GoalCard({ goal, me, isMe, onChanged, onError }: { goal: Goal; me: DemoUser; isMe: boolean; onChanged: () => void; onError: (e: string) => void }) {
  const [amt, setAmt] = useState("1");
  const [busy, setBusy] = useState(false);
  const pledged = goal.pledgedUsd ?? 0, target = Number(goal.targetUsd);
  const pct = target > 0 ? Math.min(100, (pledged / target) * 100) : 0;
  const left = Math.max(0, goal.deadline - Date.now());
  const back = async () => {
    setBusy(true);
    try { const r = await pledgeGoal(goal.id, me.id, Number(amt)); if (!r.ok && r.reason === "insufficient_balance") onError("Not enough credit to pledge."); onChanged(); }
    catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  };
  return (
    <div className="goalcard">
      <div className="goal-head"><b>🎯 {goal.title}</b>
        <span className={"chip " + (goal.status === "funded" ? "chip-ok" : goal.status === "expired" ? "chip-bad" : "")}>{goal.status === "active" ? "live" : goal.status}</span>
      </div>
      <div className="bar" style={{ marginTop: 8 }}><i style={{ width: pct + "%", background: "linear-gradient(90deg,var(--in),#7af5c9)" }} /></div>
      <div className="statline" style={{ marginTop: 6 }}><span><b>{usd(pledged)}</b> <span className="muted">of {usd(target)}</span></span><span className="muted">{goal.backers ?? 0} backers</span></div>
      {goal.status === "active" ? (<>
        <div className="muted" style={{ fontSize: 12 }}>{left > 0 ? `${Math.ceil(left / 60000)} min left · auto-refunds if not reached` : "resolving…"}</div>
        {!isMe && (
          <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
            <span className="muted">$</span>
            <input className="input" type="number" step="0.5" min="0" style={{ width: 90 }} value={amt} onChange={(e) => setAmt(e.target.value)} />
            <button className="btn btn-sm" onClick={back} disabled={busy || !(Number(amt) > 0)}>{busy ? "…" : "Back this goal"}</button>
          </div>
        )}
        {(goal.viewerPledgedUsd ?? 0) > 0 && <div className="muted" style={{ fontSize: 12, color: "var(--in)" }}>You’ve pledged {usd(goal.viewerPledgedUsd!)} (held in escrow)</div>}
      </>) : goal.status === "funded" ? <div className="muted" style={{ color: "var(--in)" }}>✓ Funded — pledges released to {goal.creator}.</div>
        : <div className="muted">Goal missed — all pledges refunded to backers.</div>}
    </div>
  );
}
function CreateGoalForm({ me, onCreated, onError }: { me: DemoUser; onCreated: () => void; onError: (e: string) => void }) {
  const [title, setTitle] = useState(""); const [target, setTarget] = useState("10"); const [minutes, setMinutes] = useState("10");
  const [busy, setBusy] = useState(false);
  const create = async () => { if (!title.trim()) return; setBusy(true); try { await createGoal(me.id, title.trim(), Number(target), Number(minutes)); setTitle(""); onCreated(); } catch (e: any) { onError(e?.message ?? String(e)); } setBusy(false); };
  return (
    <div className="goalcard">
      <div className="goal-head"><b>🎯 Start a funding goal</b></div>
      <div className="row" style={{ flexDirection: "column", gap: 8, marginTop: 8 }}>
        <input className="input" placeholder="e.g. New camera for 4K streams" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="row" style={{ alignItems: "center" }}>
          <span className="muted">$</span><input className="input" type="number" min="1" style={{ width: 90 }} value={target} onChange={(e) => setTarget(e.target.value)} />
          <span className="muted">in</span><input className="input" type="number" min="1" style={{ width: 70 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} /><span className="muted">min</span>
          <button className="btn btn-sm" onClick={create} disabled={busy || !title.trim()}>{busy ? "…" : "Launch"}</button>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>Backers’ pledges are escrowed. Reach the goal → released to you; miss it → auto-refunded.</div>
      </div>
    </div>
  );
}

// ───────────────────────── ask creator's AI (Feature 3) ───────────────────
function AskCreatorBox({ creator, me, onBalance }: { creator: PublicUser; me: DemoUser; onBalance: () => void }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [meta, setMeta] = useState<{ tokens: number; costUsd: number; via?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<(() => void) | null>(null);
  useEffect(() => () => abort.current?.(), []);
  const ask = () => {
    if (!q.trim() || streaming) return;
    setAnswer(""); setMeta(null); setErr(null); setStreaming(true);
    abort.current = askCreator(creator.id, me.id, q.trim(), (e: AskEvent) => {
      if (e.type === "token") setAnswer((a) => a + (e.text ?? ""));
      else if (e.type === "start") setMeta({ tokens: 0, costUsd: 0, via: e.via });
      else if (e.type === "done") { setMeta({ tokens: e.tokens ?? 0, costUsd: e.costUsd ?? 0, via: undefined }); setStreaming(false); onBalance(); }
      else if (e.type === "out-of-balance") { setErr("Out of credit — top up to keep chatting."); setStreaming(false); onBalance(); }
      else if (e.type === "error") { setErr(e.error ?? "error"); setStreaming(false); }
    });
  };
  return (
    <div className="askbox">
      <div className="ask-head"><b>🤖 Ask {creator.name}’s AI</b><span className="muted" style={{ fontSize: 12 }}>pay per token · revenue to {creator.name}</span></div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" placeholder={`Ask ${creator.name} anything…`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} disabled={streaming} />
        <button className="btn btn-sm" onClick={ask} disabled={streaming || !q.trim()}>{streaming ? "…" : "Ask"}</button>
      </div>
      {(answer || streaming) && <div className="ask-answer">{answer || "…"}{streaming && <span className="ask-caret">▋</span>}</div>}
      {meta && !streaming && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{meta.tokens} tokens · paid {usd(meta.costUsd)} to {creator.name}</div>}
      {err && <div className="muted" style={{ fontSize: 12, color: "var(--out)" }}>{err}</div>}
    </div>
  );
}

// ───────────────────────── social: likes + comments ─────────────────────────
function timeAgo(ts: number) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Likes + view count + comment thread for a clip (under the video, YouTube-style). */
function SocialBar({ clip, me }: { clip: Clip; me: DemoUser }) {
  const [snap, setSnap] = useState<{ views: number; likeCount: number; liked: boolean; comments: SocialComment[] } | null>(null);
  const [draft, setDraft] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { let on = true; fetchSocial(clip.id, me.id).then((s) => { if (on) setSnap(s); }).catch(() => {}); return () => { on = false; }; }, [clip.id, me.id]);
  async function like() {
    if (!snap) return;
    setSnap({ ...snap, liked: !snap.liked, likeCount: snap.likeCount + (snap.liked ? -1 : 1) }); // optimistic
    try { const r = await toggleLike(clip.id, me.id); setSnap((s) => (s ? { ...s, liked: r.liked, likeCount: r.count } : s)); } catch { /* corrected on next load */ }
  }
  async function comment() {
    const body = draft.trim(); if (!body) return; setBusy(true);
    try { const c = await postComment(clip.id, me.id, body); setSnap((s) => (s ? { ...s, comments: [c, ...s.comments] } : s)); setDraft(""); } catch { /* ignore */ }
    setBusy(false);
  }
  return (
    <div className="social">
      <div className="social-actions">
        <button className={"like-btn" + (snap?.liked ? " on" : "")} onClick={like} disabled={!snap}>{snap?.liked ? "♥" : "♡"} {snap?.likeCount ?? clip.likeCount ?? 0}</button>
        <span className="muted" style={{ fontSize: 13 }}>👁 {snap?.views ?? clip.views ?? 0} views</span>
        <span className="muted" style={{ fontSize: 13 }}>💬 {snap?.comments.length ?? clip.commentCount ?? 0}</span>
      </div>
      <div className="comment-input">
        <Avatar user={me} size={30} />
        <input className="input" placeholder="Add a comment…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && comment()} />
        <button className="btn btn-sm" onClick={comment} disabled={busy || !draft.trim()}>Post</button>
      </div>
      <div className="comment-list">
        {snap?.comments.map((c) => (
          <div key={c.id} className="comment">
            <div className="a" style={{ fontSize: 18 }}>{c.user.avatar}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5 }}><b>{c.user.name}</b> <span className="muted">@{c.user.handle} · {timeAgo(c.createdAt)}</span></div>
              <div style={{ fontSize: 13.5, wordBreak: "break-word" }}>{c.body}</div>
            </div>
          </div>
        ))}
        {snap && !snap.comments.length && <div className="muted" style={{ fontSize: 13, padding: "6px 2px" }}>No comments yet — be the first.</div>}
      </div>
    </div>
  );
}

/** Real-time live chat panel (poll every 2s). Used by the host + live viewers. */
function LiveChat({ clipId, me }: { clipId: string; me: DemoUser }) {
  const [msgs, setMsgs] = useState<SocialComment[]>([]);
  const [draft, setDraft] = useState("");
  const since = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let on = true;
    const tick = async () => {
      const fresh = await fetchLiveChat(clipId, since.current);
      if (!on || !fresh.length) return;
      since.current = Math.max(since.current, ...fresh.map((m) => m.createdAt));
      setMsgs((prev) => [...prev, ...fresh].slice(-200));
    };
    tick(); const id = setInterval(tick, 2000); return () => { on = false; clearInterval(id); };
  }, [clipId]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs]);
  async function send() {
    const body = draft.trim(); if (!body) return; setDraft("");
    try { const m = await postLiveChat(clipId, me.id, body); since.current = Math.max(since.current, m.createdAt); setMsgs((p) => [...p, m].slice(-200)); } catch { /* ignore */ }
  }
  return (
    <div className="livechat">
      <div className="livechat-head">💬 Live chat</div>
      <div className="livechat-list" ref={listRef}>
        {msgs.map((m) => (
          <div key={m.id} className="chat-msg"><span className="chat-user">{m.user.avatar} {m.user.name}:</span> {m.body}</div>
        ))}
        {!msgs.length && <div className="muted" style={{ fontSize: 12.5, padding: 6 }}>Say hi 👋</div>}
      </div>
      <div className="livechat-input">
        <input className="input" placeholder="Chat…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn btn-sm" onClick={send} disabled={!draft.trim()}>Send</button>
      </div>
    </div>
  );
}

const LOW_CAP = 0.012;

/** Autonomous interest-matching ad agent (DETERMINISTIC — no API key). While you watch,
 *  it reads what you're into (the clip's tags), auto-picks the funded ad that best
 *  matches, and pays YOU per verified second of attention — settled on-chain. The
 *  self-financing feed, run by a machine: no human chooses the ad, no LLM key needed. */
function AdAgentPanel({ clip, me, onEarned, active }: { clip: Clip; me: DemoUser; onEarned: (usd: number) => void; active: boolean }) {
  const [ad, setAd] = useState<Campaign | null>(null);
  const [reason, setReason] = useState("reading your interests…");
  const [earned, setEarned] = useState(0);
  const [visible, setVisible] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const box = useRef<HTMLDivElement | null>(null);
  const token = useRef<string | undefined>(undefined);
  const baseline = useRef<number | null>(null);
  const visRef = useRef(visible); visRef.current = visible;
  const scrRef = useRef(onScreen); scrRef.current = onScreen;
  const earning = !!ad && active && visible && onScreen;

  // The agent's decision: match an ad to this clip's interests.
  useEffect(() => {
    let on = true;
    matchAd(clip.tags ?? []).then((m) => { if (on) { setAd(m.match); setReason(m.match ? m.reason : "no funded ad is bidding right now"); } });
    return () => { on = false; };
  }, [clip.id]);
  useEffect(() => { const f = () => setVisible(document.visibilityState === "visible"); document.addEventListener("visibilitychange", f); f(); return () => document.removeEventListener("visibilitychange", f); }, []);
  useEffect(() => { const el = box.current; if (!el || typeof IntersectionObserver === "undefined") return; const io = new IntersectionObserver(([e]) => setOnScreen(!!e && e.isIntersecting && e.intersectionRatio > 0.25), { threshold: [0, 0.25, 1] }); io.observe(el); return () => io.disconnect(); }, [ad?.id]);
  // The agent autonomously pays you: open attention session, prove attention, the
  // advertiser agent settles per second; poll on-chain earnings. Gated on `active`
  // (the watch payment is flowing) so the two MPP channels open one-after-another
  // instead of fighting over the rate-limited RPC.
  useEffect(() => {
    if (!ad || !active) return;
    let alive = true; baseline.current = null;
    openAttentionSession(ad.id, me.id).then((t) => { if (alive) token.current = t; });
    const beat = () => { void sendHeartbeat(ad.id, me.id, token.current, { visible: visRef.current, playing: true, onScreen: scrRef.current }); };
    beat(); const beatId = setInterval(beat, 1000);
    const pumpId = setInterval(() => { if (visRef.current && scrRef.current) runAd(ad.id, me.id); }, 4000); runAd(ad.id, me.id);
    const netId = setInterval(async () => {
      try { const n = await fetchNet(me.id); if (baseline.current == null) baseline.current = n.inUsd; const e = +(n.inUsd - (baseline.current ?? 0)).toFixed(6); if (alive) { setEarned(e); onEarned(e); } } catch { /* keep last */ }
    }, 1500);
    return () => { alive = false; clearInterval(beatId); clearInterval(pumpId); clearInterval(netId); stopAd(ad.id, me.id); };
  }, [ad?.id, me.id, active]);

  return (
    <div className="panel agent-panel" ref={box}>
      <div className="agent-head">🤖 Your ad agent <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>· autonomous · no API key</span></div>
      {ad ? (<>
        <div className="agent-ad">
          {ad.hasVideo ? <video src={videoSrc(ad.id)} preload="metadata" autoPlay loop muted playsInline /> : <span className="emoji" style={{ fontSize: 40 }}>{ad.thumb ?? "📣"}</span>}
          <span className="adtag">● AD</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>matched <b>{ad.title ?? ad.advertiser}</b> — {reason}</div>
        <div className="bignum in" style={{ fontSize: 26 }}>+ {usd(earned)}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>{!active ? "starts paying once your watch session is live…" : earning ? "paying you per verified second → settled on-chain" : "keep the ad on screen to keep earning"}</div>
      </>) : <div className="muted" style={{ fontSize: 12.5 }}>{reason}</div>}
    </div>
  );
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function incrementPopularity(popularity: SecondPopularity[], second: number): SecondPopularity[] {
  const target = Math.max(0, Math.floor(second));
  const next = [...popularity];
  const idx = next.findIndex((p) => Math.floor(p.second) === target);
  if (idx >= 0) {
    const current = next[idx]!;
    next[idx] = { second: current.second, watchCount: Math.max(0, current.watchCount) + 1 };
  }
  else next.push({ second: target, watchCount: 1 });
  return next.sort((a, b) => a.second - b.second);
}

function PopularityTimeline({
  videoDuration,
  currentTime,
  bufferedTime,
  popularityBySecond,
  onSeek,
}: {
  videoDuration: number;
  currentTime: number;
  bufferedTime?: number;
  popularityBySecond: SecondPopularity[];
  onSeek: (targetTime: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ time: number; x: number; watchCount: number } | null>(null);
  const [width, setWidth] = useState(640);
  const duration = Math.max(0, Number.isFinite(videoDuration) ? videoDuration : 0);
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, Math.max(0, ((bufferedTime ?? 0) / duration) * 100)) : 0;
  const graphHeight = 42;
  const path = popularityPath(popularityBySecond, duration, width, graphHeight);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(1, Math.floor(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function timeFromEvent(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return positionToTime(e.clientX, rect.left, rect.width, duration);
  }

  function handleMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const time = positionToTime(e.clientX, rect.left, rect.width, duration);
    setHover({
      time,
      x: Math.min(rect.width, Math.max(0, e.clientX - rect.left)),
      watchCount: watchCountAtSecond(popularityBySecond, time),
    });
  }

  return (
    <div
      ref={ref}
      className="yt-timeline"
      onClick={(e) => { e.stopPropagation(); onSeek(timeFromEvent(e)); }}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      tabIndex={0}
      role="slider"
      aria-label="Video timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
    >
      <div className="yt-pop-graph">
        <svg viewBox={`0 0 ${width} ${graphHeight}`} preserveAspectRatio="none" aria-hidden="true">
          <path className="yt-pop-fill" d={path ? `${path} L ${width} ${graphHeight} L 0 ${graphHeight} Z` : ""} />
          <path className="yt-pop-line" d={path} />
        </svg>
      </div>
      <div className="yt-track">
        <span className="yt-buffered" style={{ width: `${bufferedPct}%` }} />
        <span className="yt-progress" style={{ width: `${progressPct}%` }} />
      </div>
      {hover && duration > 0 && (
        <>
          <span className="yt-hover-marker" style={{ left: hover.x }} />
          <span className="yt-hover-label" style={{ left: hover.x }}>
            {formatTime(hover.time)} · {hover.watchCount} views
          </span>
        </>
      )}
    </div>
  );
}

function WatchView({ clip, me, onBack, onError, onSettled, onProfile, balance, onTopup }: { clip: Clip; me: DemoUser; onBack: () => void; onError: (e: string) => void; onSettled: () => void; onProfile?: (id: string) => void; balance: number | null; onTopup: () => void }) {
  const [phase, setPhase] = useState<"idle" | "opening" | "watching" | "paused" | "closing">("idle");
  const [spent, setSpent] = useState(0);
  const [secs, setSecs] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(clip.durationSec);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [popularity, setPopularity] = useState<SecondPopularity[]>([]);
  const [reason, setReason] = useState<"ended" | "out-of-funds" | null>(null);
  const [streamEnded, setStreamEnded] = useState(false); // live host left
  const [earned, setEarned] = useState(0); // earned by the autonomous ad agent this session
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const [low, setLow] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsControls, setFsControls] = useState(true);
  const handle = useRef<WatchHandle | null>(null);
  const player = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const capping = useRef(false);
  const hideFsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deposit = low ? LOW_CAP : 0.5;
  const collab = clip.recipients.length > 1;

  useEffect(() => () => { handle.current?.stop().catch(() => {}); }, []);
  useEffect(() => { void viewClip(clip.id); }, [clip.id]); // count a view when the page opens
  useEffect(() => {
    setPopularity([]);
    fetchVideoPopularity(clip.id).then((snapshot) => {
      setPopularity(snapshot.popularity ?? []);
      if (snapshot.duration > 0) setVideoDuration(snapshot.duration);
    }).catch(() => setPopularity([]));
  }, [clip.id]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const sync = () => {
      setCurrentTime(v.currentTime || 0);
      if (Number.isFinite(v.duration) && v.duration > 0) setVideoDuration(v.duration);
      const ranges = v.buffered;
      setBufferedTime(ranges.length ? ranges.end(ranges.length - 1) : 0);
    };
    v.addEventListener("loadedmetadata", sync);
    v.addEventListener("durationchange", sync);
    v.addEventListener("timeupdate", sync);
    v.addEventListener("progress", sync);
    return () => {
      v.removeEventListener("loadedmetadata", sync);
      v.removeEventListener("durationchange", sync);
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("progress", sync);
    };
  }, [clip.id]);
  useEffect(() => {
    const onFullScreenChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeFullscreen(); };
    document.addEventListener("fullscreenchange", onFullScreenChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullScreenChange);
      document.removeEventListener("keydown", onKey);
      if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    };
  }, []);

  async function start() {
    setSummary(null); setSpent(0); setSecs(0); setReason(null); capping.current = false; setPhase("opening");
    // Play INSTANTLY — don't make the viewer wait ~8–15s for the on-chain channel to
    // open. The video starts now; the payment stream connects in the background and
    // charging begins as soon as it's ready.
    video.current?.play().catch(() => {});
    try {
      handle.current = await watchClip(clip, me,
        (t: Tick) => {
          setPhase("watching"); setSpent(t.spentUsd); setSecs(t.second); video.current?.play().catch(() => {});
          setPopularity((prev) => incrementPopularity(prev, t.second - 1));
          if (low && t.spentUsd >= LOW_CAP && !capping.current) { capping.current = true; closeOut("out-of-funds"); }
        },
        (r) => { if (!capping.current) { setReason(r); setPhase("paused"); video.current?.pause(); } });
    } catch (e: any) { onError(e?.message ?? String(e)); setPhase("idle"); }
  }
  async function closeOut(why: "ended" | "out-of-funds") {
    if (!handle.current) return;
    setReason(why); video.current?.pause(); setPhase("closing");
    try { setSummary((await handle.current.stop()) ?? null); } catch (e: any) { onError(e?.message ?? String(e)); }
    handle.current = null; setPhase("paused"); onSettled();
  }
  function togglePlayback() {
    if (phase === "opening" || phase === "closing") return;
    if (phase === "watching") { void closeOut("ended"); return; }
    void start();
  }
  function revealFsControls() {
    if (!fullscreen) return;
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function openFullscreen(e: MouseEvent) {
    e.stopPropagation();
    setFullscreen(true);
    setFsControls(true);
    await player.current?.requestFullscreen?.().catch(() => {});
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function closeFullscreen(e?: MouseEvent) {
    e?.stopPropagation();
    setFullscreen(false);
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }
  function seekVideo(targetTime: number) {
    const duration = Math.max(0, videoDuration || clip.durationSec);
    const target = Math.min(Math.max(0, targetTime), Math.max(0, duration - 0.05));
    if (video.current) video.current.currentTime = target;
    setCurrentTime(target);
  }
  const live = phase === "watching";
  const pct = Math.min(100, (spent / deposit) * 100);
  const price = Number(clip.pricePerSec);
  const broke = balance != null && balance < deposit; // not enough on-chain pathUSD to open the channel

  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back</button><span className="muted">watching</span></div>
      <div className="watch">
        <div>
          <div
            ref={player}
            className={"player click-player" + (fullscreen ? " player-fullscreen" : "")}
            onClick={togglePlayback}
            onMouseMove={revealFsControls}
            title={live ? "click to stop" : "click to start"}
          >
            {clip.hasVideo
              ? <video ref={video} src={videoSrc(clip.id)} preload="metadata" loop playsInline style={{ opacity: phase === "paused" ? 0.4 : 1 }} />
              : <span className="emoji" style={{ opacity: live ? 1 : 0.5 }}>{clip.thumb ?? "🎬"}</span>}
            <button className="fs-open" onClick={openFullscreen} title="fullscreen" aria-label="Open fullscreen">⛶</button>
            {clip.live && <span className="live-badge player-live">● LIVE</span>}
            {fullscreen && (
              <div className={"fs-layer" + (fsControls ? " show" : "")}>
                <button className="fs-back" onClick={closeFullscreen}>← Back</button>
                <div className="fs-cost">
                  <span>cost</span>
                  <b>− {usd(spent)}</b>
                  <small>{usd(Number(clip.pricePerSec))}/sec · {secs}s</small>
                </div>
              </div>
            )}
            {streamEnded && <div className="ov">🔴 Stream ended — the creator left the live.</div>}
            {!streamEnded && phase === "idle" && <div className="ov">{broke ? "⛔ You’re out of credit — add funds to watch this." : `▶ Click the video or press “Watch” — you pay ${usd(price)}/sec to the creator`}</div>}
            {!streamEnded && phase === "opening" && <span className="player-connecting">⚡ playing now · settling payment on-chain…</span>}
            {!streamEnded && phase === "paused" && <div className="ov">{reason === "out-of-funds" ? "⛔ Out of credit — top up to keep watching." : "⏸ Paused — payment stopped. Click the video to start again."}</div>}
          </div>
          <PopularityTimeline
            videoDuration={videoDuration || clip.durationSec}
            currentTime={currentTime}
            bufferedTime={bufferedTime}
            popularityBySecond={popularity}
            onSeek={seekVideo}
          />
          <div className="w-title">{clip.title}</div>
          <div className="w-chan">
            <div className="a">{clip.thumb ?? "🎬"}</div>
            <div><b className={onProfile ? "chan-link" : undefined} onClick={() => onProfile?.(clip.ownerId)}>@{clip.creator}</b><div className="muted" style={{ fontSize: 12.5 }}>{clip.tags.map((t) => "#" + t).join(" ")}</div></div>
          </div>
          {collab && <div className="receipt" style={{ marginTop: 12 }}>Revenue split: {clip.recipients.map((r, i) => <span key={i}>{i ? " · " : ""}<b>{r.label}</b> {r.percentage}%</span>)}</div>}
          {clip.live ? <div style={{ marginTop: 14 }}><LiveChat clipId={clip.id} me={me} /></div> : <SocialBar clip={clip} me={me} />}
        </div>

        {/* payment + autonomous ad-agent sidebar */}
        <div className="watch-side">
        <div className="panel">
          <h3><span className={"livedot" + (live ? " on" : "")} /> pay-per-second → creator</h3>
          {clip.live && <LiveMeter clipId={clip.id} onEnded={() => { setStreamEnded(true); if (handle.current) void closeOut("ended"); }} />}
          <div className="bignum out">− {usd(spent)}</div>
          <div className="statline"><span className="k">rate</span><span>{usd(Number(clip.pricePerSec))}/sec</span></div>
          <div className="statline"><span className="k">watched</span><span>{secs}s</span></div>
          {!clip.live && <>
            <div className="statline"><span className="k">earned back by agent</span><span style={{ color: "var(--in)" }}>+ {usd(earned)}</span></div>
            <div className="statline"><span className="k">net this session</span><span><b style={{ color: earned - spent >= 0 ? "var(--in)" : "var(--out)" }}>{earned - spent >= 0 ? "+" : "−"} {usd(Math.abs(earned - spent))}</b>{Math.abs(earned - spent) < 0.012 ? " · ≈ free" : ""}</span></div>
          </>}
          <div>
            <div className="statline" style={{ marginBottom: 5 }}><span className="k">channel deposit</span><span>{usd(spent)} / {usd(deposit)}</span></div>
            <div className="bar"><i style={{ width: pct + "%" }} /></div>
            <div className="statline" style={{ marginTop: 5 }}><span className="k">refundable on stop</span><span style={{ color: "var(--in)" }}>{usd(Math.max(0, deposit - spent))}</span></div>
          </div>
          <MoneyFlow dir="out" active={live} />
          <TipBoost me={me} clip={clip} active={live} onTipped={onSettled} />
          <div className="row">
            {phase === "idle" || phase === "paused"
              ? <button className="btn" onClick={start} style={{ flex: 1 }}>{phase === "paused" ? "▶ Resume" : "▶ Watch"}</button>
              : <button className="btn" disabled style={{ flex: 1 }}>{phase === "opening" ? "opening…" : "watching…"}</button>}
            <button className="btn btn-ghost" onClick={() => closeOut("ended")} disabled={phase !== "watching"}>Stop</button>
          </div>
          <label className="toggle"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Demo: limited funds (stops after ~6s)</label>
          {summary && (() => {
            const paid = summary.spentUsd ?? spent;
            const refunded = Math.max(0, deposit - paid);
            return (
              <div className="receipt">
                <div className="receipt-head">✓ Charged from app balance</div>
                <div className="statline"><span className="k">paid to creator</span><span><b>{usd(paid)}</b>{summary.seconds != null ? ` · ${summary.seconds}s` : ""}</span></div>
                <div className="statline"><span className="k">deposit refunded</span><span style={{ color: "var(--in)" }}>{usd(refunded)}</span></div>
                {summary.txHash
                  ? <div className="tx" title="click to copy full tx hash" onClick={() => copy(summary.txHash!)}>tx {shortHash(summary.txHash)} <span className="copy">⧉ copy</span></div>
                  : <div className="tx">transaction recorded in your ledger</div>}
              </div>
            );
          })()}
        </div>
        {!clip.live && <AdAgentPanel clip={clip} me={me} onEarned={setEarned} active={phase === "watching" || phase === "paused"} />}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── ad watch (earn) ─────────────────────────
/** Watch a red-framed ad video and get PAID per second of proven attention.
 *  The money is pulled automatically from the advertiser's wallet (server-spawned
 *  payer); when the ad's funded budget runs out it simply stops paying. */
function AdWatch({ ad, me, onBack, onProfile, rewardRate }: { ad: Campaign; me: DemoUser; onBack: () => void; onProfile?: (id: string) => void; rewardRate?: number | null }) {
  const [watching, setWatching] = useState(false); // user pressed "Watch ad" (explicit start)
  const [attention, setAttention] = useState(true); // manual "look away" toggle
  const [visible, setVisible] = useState(true); // tab foregrounded (Layer 1)
  const [onScreen, setOnScreen] = useState(true); // player in viewport (Layer 1)
  const [challenge, setChallenge] = useState<AttentionChallenge | null>(null); // active proof (Layer 2)
  const [earned, setEarned] = useState(0);
  const [paying, setPaying] = useState(false);
  const [started, setStarted] = useState(false); // payment channel open + actually paying
  const [events, setEvents] = useState<NetSnapshot["events"]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsControls, setFsControls] = useState(true);
  const baseline = useRef<number | null>(null);
  const prev = useRef(0);
  const video = useRef<HTMLVideoElement | null>(null);
  const player = useRef<HTMLDivElement | null>(null);
  const hideFsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef<string | undefined>(undefined); // per-session token (Layer 3)
  const startWatch = () => { baseline.current = null; prev.current = 0; setEarned(0); setStarted(false); setAttention(true); setWatching(true); };
  const toggleAdPlayback = () => {
    if (!watching) { startWatch(); return; }
    if (funded) setAttention((a) => !a);
  };
  function revealFsControls() {
    if (!fullscreen) return;
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function openFullscreen(e: MouseEvent) {
    e.stopPropagation();
    setFullscreen(true);
    setFsControls(true);
    await player.current?.requestFullscreen?.().catch(() => {});
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function closeFullscreen(e?: MouseEvent) {
    e?.stopPropagation();
    setFullscreen(false);
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }
  // Truly leaving (Stop / navigate away) closes the channel → advertiser refunded.
  useEffect(() => () => { stopAd(ad.id, me.id); }, [ad.id, me.id]);
  useEffect(() => {
    const onFullScreenChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeFullscreen(); };
    document.addEventListener("fullscreenchange", onFullScreenChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullScreenChange);
      document.removeEventListener("keydown", onKey);
      if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    };
  }, []);

  // Mirror live attention inputs into refs so the 1s heartbeat reads fresh values
  // without re-subscribing every toggle.
  const attRef = useRef(attention); attRef.current = attention;
  const visRef = useRef(visible); visRef.current = visible;
  const scrRef = useRef(onScreen); scrRef.current = onScreen;

  // Layer 1a: tab visibility.
  useEffect(() => {
    const f = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", f); f();
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  // Layer 1b: is the player actually on-screen?
  useEffect(() => {
    const el = player.current; if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e && e.isIntersecting && e.intersectionRatio > 0.4), { threshold: [0, 0.4, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Open a session, then heartbeat every second with REAL signals (Layer 1) +
  // the session token (Layer 3). The server's reply may carry a challenge (L2).
  useEffect(() => {
    if (!watching) return; // nothing runs until the viewer presses Watch
    let alive = true;
    openAttentionSession(ad.id, me.id, rewardRate ?? undefined).then((t) => { if (alive) token.current = t; });
    const beat = async () => {
      const v = video.current;
      const playing = !!v && !v.paused && !v.ended && v.readyState >= 2;
      // Manual "look away" collapses into the visibility signal.
      const res = await sendHeartbeat(ad.id, me.id, token.current, { visible: visRef.current && attRef.current, playing, onScreen: scrRef.current });
      if (alive) setChallenge(res?.challenge ?? null);
    };
    const beatId = setInterval(beat, 1000);
    const pumpId = setInterval(() => { if (attRef.current && visRef.current && scrRef.current) runAd(ad.id, me.id); }, 4000);
    beat(); runAd(ad.id, me.id);
    return () => { alive = false; clearInterval(beatId); clearInterval(pumpId); };
  }, [ad.id, me.id, watching]);

  // Layer 2: prove you're watching by tapping the target → payment resumes.
  const proveAttention = (id: string) => {
    setChallenge(null); // optimistic; the next heartbeat confirms
    void answerChallenge(ad.id, me.id, token.current, id);
  };

  // Poll my on-chain earnings → delta since this ad opened. The first non-zero
  // earning means the advertiser's payment channel is open AND paying.
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(async () => {
      try {
        const n = await fetchNet(me.id);
        if (baseline.current == null) baseline.current = n.inUsd;
        const e = +(n.inUsd - (baseline.current ?? 0)).toFixed(6);
        setPaying(e > prev.current); prev.current = e; setEarned(e);
        if (e > 0) setStarted(true);
        setEvents(n.events.filter((ev) => ev.direction === "in").slice(0, 6));
      } catch { /* keep last */ }
    }, 1500);
    return () => clearInterval(id);
  }, [me.id, watching]);

  // What the viewer EARNS per second: the auction clearing price if they arrived via
  // the auction, otherwise the campaign's own rate.
  const price = rewardRate ?? Number(ad.pricePerSec);
  const budget = Number(ad.maxBudget);
  const spent = ad.spentUsd ?? 0;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const funded = ad.funded ?? budget - spent >= price;
  // Channel open, funded, AND provably attentive (manual + tab visible + on-screen).
  const live = watching && attention && started && funded && visible && onScreen;

  // Play the ad ONLY while it's actually being paid for. Try with sound; if the
  // browser blocks unmuted autoplay, fall back to muted so it still plays.
  useEffect(() => {
    const v = video.current; if (!v) return;
    if (live) { v.muted = false; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); }
    else v.pause();
  }, [live]);

  // Never get stuck on "opening" — if the ad is funded and you're watching but no
  // payment has registered after a grace period (slow channel / self-watch), start
  // anyway so the ad isn't blocked forever.
  useEffect(() => {
    if (!watching || !funded || !attention || started) return;
    const t = setTimeout(() => setStarted(true), 15000); // backstop only — opening an on-chain channel can take ~8-15s on the public RPC
    return () => clearTimeout(t);
  }, [watching, funded, attention, started]);

  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back to ads</button><span className="muted">earning from an ad</span></div>
      <div className="watch">
        <div>
          <div
            className={"player ad click-player" + (fullscreen ? " player-fullscreen" : "")}
            ref={player}
            onClick={toggleAdPlayback}
            onMouseMove={revealFsControls}
            title={!watching ? "click to start" : attention ? "click to pause" : "click to resume"}
          >
            {ad.hasVideo
              ? <video ref={video} src={videoSrc(ad.id)} preload="metadata" loop playsInline style={{ opacity: live ? 1 : 0.35 }} />
              : <span className="emoji" style={{ opacity: live ? 1 : 0.35 }}>{ad.thumb ?? "📣"}</span>}
            <span className="adtag">● AD</span>
            <button className="fs-open" onClick={openFullscreen} title="fullscreen" aria-label="Open fullscreen">⛶</button>
            {fullscreen && (
              <div className={"fs-layer" + (fsControls ? " show" : "")}>
                <button className="fs-back" onClick={closeFullscreen}>← Back</button>
                <div className="fs-cost fs-earn">
                  <span>earned</span>
                  <b>+ {usd(earned)}</b>
                  <small>{usd(price)}/sec · {paying ? "paying" : watching ? "ready" : "paused"}</small>
                </div>
              </div>
            )}
            {!watching
              ? <div className="ov ov-watch"><button className="btn btn-lg" onClick={(e) => { e.stopPropagation(); startWatch(); }}>▶ Watch ad</button><div className="muted" style={{ marginTop: 10 }}>or click the video · get paid {usd(price)}/sec</div></div>
              : !funded
              ? <div className="ov">⛔ This ad is out of funding — it can’t pay, so it won’t play.</div>
              : !attention
              ? <div className="ov">🙈 paused. Click the video to resume instantly.</div>
              : !visible
              ? <div className="ov">🛑 tab in the background — attention can’t be proven, paused</div>
              : !onScreen
              ? <div className="ov">⬆️ scroll the ad back into view to keep earning</div>
              : !started
              ? <div className="ov">⏳ preparing reward stream…</div>
              : null}
            {/* Layer 2: random attention challenge — tap it within a few seconds. */}
            {challenge && funded && started && (
              <button
                className="att-challenge"
                style={{ left: challenge.x + "%", top: challenge.y + "%" }}
                onClick={(e) => { e.stopPropagation(); proveAttention(challenge.id); }}
              >👀 still watching? tap to keep earning</button>
            )}
          </div>
          <div className="w-title">{ad.title ?? ad.advertiser}</div>
          <div className="w-chan">
            <div className="a">{ad.thumb ?? "📣"}</div>
            <div><b className={onProfile ? "chan-link" : undefined} onClick={() => onProfile?.(ad.ownerId)}>{ad.advertiser}</b><div className="muted" style={{ fontSize: 12.5 }}>sponsored · pays you to watch · {ad.tags.map((t) => "#" + t).join(" ")}</div></div>
          </div>
        </div>

        <div className="panel">
          <h3><span className={"livedot in" + (paying ? " on" : "")} /> earning — paid by advertiser</h3>
          {rewardRate != null && <div className="auction-banner">🏆 Auction win · clearing price <b>{usd(rewardRate)}/sec</b> (2nd-price)</div>}
          <div className="bignum in">+ {usd(earned)}</div>
          <div className="statline"><span className="k">rate</span><span>{usd(price)}/sec</span></div>
          <div>
            <div className="statline" style={{ marginBottom: 5 }}><span className="k">ad funding used</span><span>{usd(spent)} / {usd(budget)}</span></div>
            <div className="bar"><i style={{ width: pct + "%", background: "linear-gradient(90deg,var(--out),#ff9356)" }} /></div>
            <div className="statline" style={{ marginTop: 5 }}><span className="k">budget left</span><span style={{ color: funded ? "var(--in)" : "var(--out)" }}>{usd(Math.max(0, budget - spent))}</span></div>
          </div>
          <MoneyFlow dir="in" active={attention && paying} />
          <div className="receipt" style={{ background: "#0f141f", borderColor: "#22304a" }}>Paid per second from <b>{ad.advertiser}</b> while attention is verified. Looking away pauses rewards immediately.</div>
          {events.length > 0 && (
            <div className="feed-events">
              <div className="role-chip">your live receipts</div>
              {events.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--in)" }}>▲ from {e.counterparty}</span>
                  <span className="muted">{usd(Number(e.amount))}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            {!watching
              ? <button className="btn" style={{ flex: 1 }} onClick={startWatch}>▶ Watch ad · earn {usd(price)}/sec</button>
              : <>
                  <button className={attention ? "btn btn-ghost" : "btn"} style={{ flex: 1 }} onClick={() => setAttention((a) => !a)}>{attention ? "Look away 🙈" : "Look back 👀"}</button>
                  <button className="btn btn-ghost" onClick={onBack}>Stop</button>
                </>}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>{!watching ? "press ▶ Watch ad to start earning" : !funded ? "⛔ unfunded — ask the advertiser to fund it" : !attention ? "paused — look back to keep earning" : !visible ? "background tab — paused, come back to keep earning" : !onScreen ? "ad scrolled off-screen — paused" : challenge ? "tap the prompt to prove you’re watching" : !started ? "preparing reward stream" : paying ? "attention proven — being paid" : "attention proven"}</div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── avatar (pic or symbol) ─────────────────────────
function Avatar({ user, size = 40, ring, onClick }: { user: { id: string; avatar: string; pic?: string }; size?: number; ring?: boolean; onClick?: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={"av" + (onClick ? " av-link" : "") + (ring ? " av-ring" : "")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      title={onClick ? "view profile" : undefined}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
    >
      {user.pic && !broken
        ? <img src={picSrc(user.id)} alt="" onError={() => setBroken(true)} />
        : <span>{user.avatar}</span>}
    </div>
  );
}

const EMOJI_PRESETS = ["🌌","🎹","🍜","🎮","🐧","🦊","🎬","🎨","🚀","🔥","💎","🌊","🎧","📸","⚡","🐉","🌸","🛹","🤖","👾","🎤","🏆","🪐","🍿"];

/** Deterministic banner gradient from a user id (so each profile has its own). */
function bannerFor(id: string): string {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 48) % 360;
  return `linear-gradient(120deg, hsl(${a} 58% 20%), hsl(${b} 60% 32%))`;
}

// ───────────────────────── edit profile modal ─────────────────────────
function EditProfile({ me, onClose, onSaved, onError }: { me: DemoUser; onClose: () => void; onSaved: (u: DemoUser) => void; onError: (e: string) => void }) {
  const [name, setName] = useState(me.name);
  const [handle, setHandle] = useState(me.handle);
  const [bio, setBio] = useState(me.bio ?? "");
  const [avatar, setAvatar] = useState(me.avatar);
  const [price, setPrice] = useState(me.followPrice ?? "0.05");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickFile(f: File | null) { setFile(f); setPreview(f ? URL.createObjectURL(f) : null); }
  async function save() {
    setBusy(true);
    try {
      let u = await updateProfile(me.id, { name: name.trim() || me.name, handle: handle.trim() || me.handle, bio, avatar, followPrice: price });
      if (file) u = await uploadProfilePic(me.id, file);
      onSaved({ ...me, ...u });
      onClose();
    } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Edit profile</h3><button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button></div>
        <div className="edit-pic">
          <div className="av av-ring" style={{ width: 76, height: 76, fontSize: 38 }}>
            {(preview || me.pic) ? <img src={preview ?? picSrc(me.id)} alt="" /> : <span>{avatar}</span>}
          </div>
          <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
            📷 Upload photo<input type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>
          {(preview || me.pic) && <button className="btn btn-ghost btn-sm" onClick={() => pickFile(null)}>use symbol instead</button>}
        </div>
        {!preview && (
          <div className="emoji-picker">
            {EMOJI_PRESETS.map((em) => (
              <button key={em} className={"emoji-opt" + (avatar === em ? " sel" : "")} onClick={() => setAvatar(em)}>{em}</button>
            ))}
          </div>
        )}
        <label className="fld">Display name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="fld">Handle<input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} /></label>
        <label className="fld">Bio<textarea className="input" rows={3} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people what you create…" /></label>
        <label className="fld">Super-follow price — what supporters pay to follow you<input className="input" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>{busy ? "saving…" : "Save profile"}</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── profile page ─────────────────────────
function ProfileView({ id, me, onBack, onOpenProfile, onWatch, onError, onMeUpdate, onBalance, onLogout }: {
  id: string; me: DemoUser; onBack: () => void; onOpenProfile: (id: string) => void; onWatch: (c: Clip) => void;
  onError: (e: string) => void; onMeUpdate: (u: DemoUser) => void; onBalance: () => void; onLogout: () => void;
}) {
  const [p, setP] = useState<ProfileData | null>(null);
  const [tab, setTab] = useState<"videos" | "supporters" | "following">("videos");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() { try { setP(await fetchProfile(id, me.id)); } catch (e: any) { onError(e?.message ?? String(e)); } }
  useEffect(() => { setP(null); setTab("videos"); setToast(null); load(); /* eslint-disable-next-line */ }, [id]);

  const isMe = id === me.id;
  async function follow() {
    if (!p) return; setBusy(true); setToast(null);
    try {
      const r = await followCreator(me, { id: p.user.id, address: p.user.address, followPrice: p.user.followPrice });
      setToast(Number(r.amountUsd) > 0 ? `★ You're now supporting ${p.user.name} — paid ${usd(Number(r.amountUsd))}` : `Now following ${p.user.name}`);
      await load(); onBalance();
    } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  async function unfollow() {
    if (!p) return; setBusy(true);
    try { await unfollowCreator(me.id, p.user.id); setToast(null); await load(); } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }

  if (!p) return (
    <div className="page"><div className="backbar"><button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button></div><div className="muted">loading profile…</div></div>
  );
  const u = p.user;
  const price = Number(u.followPrice ?? "0");
  const list = tab === "supporters" ? p.supporters : tab === "following" ? p.following : [];

  return (
    <div className="page profile-page">
      <div className="backbar"><button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button><span className="muted">profile</span></div>
      <div className="pbanner" style={{ background: bannerFor(u.id) }} />
      <div className="phead">
        <Avatar user={u} size={104} ring />
        <div className="phead-main">
          <div className="pname">{u.name}<span className="role-chip2">{u.role}</span></div>
          <div className="muted phandle">@{u.handle} · <span className="tx" title="copy address" onClick={() => copy(u.address)}>{u.address.slice(0, 8)}…{u.address.slice(-4)}</span></div>
          {u.bio && <div className="pbio">{u.bio}</div>}
          <div className="pstats">
            <button className={"pstat" + (tab === "supporters" ? " on" : "")} onClick={() => setTab("supporters")}><b>{compact.format(p.followerCount)}</b> supporters</button>
            <button className={"pstat" + (tab === "following" ? " on" : "")} onClick={() => setTab("following")}><b>{compact.format(p.followingCount)}</b> following</button>
            <span className="pstat"><b style={{ color: "var(--in)" }}>{usd(p.followEarnings)}</b> from fans</span>
            <span className="pill" title="app balance">{fmtBal(p.balance)} <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>credit</span></span>
          </div>
        </div>
        <div className="phead-cta">
          {isMe ? (<>
            <button className="btn" onClick={() => setEditing(true)}>✎ Edit profile</button>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>Log out</button>
          </>) : p.viewerFollows ? (
            <button className="btn btn-ghost supporting" onClick={unfollow} disabled={busy} title="click to unfollow">{busy ? "…" : "✓ Supporting"}</button>
          ) : (
            <button className="btn btn-follow" onClick={follow} disabled={busy}>{busy ? "paying…" : price > 0 ? `★ Super-follow · ${usd(price)}` : "＋ Follow"}</button>
          )}
        </div>
      </div>

      {toast && <div className="receipt" style={{ marginTop: 14 }}>{toast}</div>}

      {(() => {
        const goals = p.goals ?? [];
        const active = goals.find((g) => g.status === "active");
        const recent = active ?? goals[0];
        return (
          <div className="profile-extra">
            <AskCreatorBox creator={u} me={me} onBalance={onBalance} />
            {recent && <GoalCard goal={recent} me={me} isMe={isMe} onChanged={() => { load(); onBalance(); }} onError={onError} />}
            {isMe && !active && <CreateGoalForm me={me} onCreated={load} onError={onError} />}
          </div>
        );
      })()}

      <div className="ptabs">
        {(["videos", "supporters", "following"] as const).map((t) => (
          <button key={t} className={"ptab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
            {t === "videos" ? `Videos (${p.clips.length})` : t === "supporters" ? `Supporters (${p.followerCount})` : `Following (${p.followingCount})`}
          </button>
        ))}
      </div>

      {tab === "videos" ? (
        p.clips.length
          ? <div className="grid">{p.clips.map((c) => <VideoCard key={c.id} clip={c} onOpen={() => onWatch(c)} />)}</div>
          : <div className="muted">{isMe ? "You haven't posted any videos yet." : "No videos yet."}</div>
      ) : (
        list.length
          ? <div className="people">{list.map((s) => (
              <div key={s.id} className="person" onClick={() => onOpenProfile(s.id)}>
                <Avatar user={s} size={44} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="pname2">{s.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>@{s.handle}</div>
                </div>
                {Number(s.amountUsd) > 0 && <span className="supporter-badge">★ {usd(Number(s.amountUsd))}</span>}
              </div>
            ))}</div>
          : <div className="muted">{tab === "supporters" ? "No supporters yet — be the first to super-follow." : "Not following anyone yet."}</div>
      )}

      {editing && <EditProfile me={me} onClose={() => setEditing(false)} onSaved={(uu) => { onMeUpdate(uu); load(); }} onError={onError} />}
    </div>
  );
}

// ───────────────────────── app ─────────────────────────
// ───────────────────────── account menu (profile + logout) ─────────────────────────
const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

function AccountMenu({ me, balance, onProfile, onTopup, onLogout }: { me: DemoUser; balance: number | null; onProfile: () => void; onTopup: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"" | "addr" | "key">("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState(false);
  const [keyErr, setKeyErr] = useState("");
  const copy = async (text: string, what: "addr" | "key") => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 1400); } catch { /* clipboard blocked */ }
  };
  async function revealKey() {
    if (revealed) { setRevealed(null); return; }
    setLoadingKey(true); setKeyErr("");
    try { const r = await exportPrivateKey(me.id); setRevealed(r.key); }
    catch (e: any) { setKeyErr(e?.message ?? "could not load key"); }
    setLoadingKey(false);
  }
  return (
    <div className="acct">
      <Avatar user={me} size={34} onClick={() => setOpen((o) => !o)} />
      {open && (
        <>
          <div className="acct-backdrop" onClick={() => { setOpen(false); setRevealed(null); }} />
          <div className="acct-menu">
            <div className="acct-head">
              <Avatar user={me} size={42} />
              <div style={{ minWidth: 0 }}>
                <div className="acct-name">{me.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>@{me.handle}</div>
              </div>
            </div>
            <div className="acct-row"><span className="k">on-chain balance</span><span><b>{balance != null ? fmtBal(balance) : "…"}</b> <span className="muted" style={{ fontSize: 11 }}>pathUSD</span></span></div>
            <div className="acct-row">
              <span className="k">wallet</span>
              <button className="linkbtn mono" title="copy full address" onClick={() => copy(me.address, "addr")}>{copied === "addr" ? "✓ copied" : shortAddr(me.address)}</button>
            </div>
            <div className="acct-sep" />
            <a className="acct-item" href={explorerAddressUrl(me.address)} target="_blank" rel="noreferrer">🔎 View wallet on Tempo explorer ↗</a>
            <a className="acct-item" href={tempoAppUrl} target="_blank" rel="noreferrer">⚡ Open the Tempo app ↗</a>
            <button className="acct-item" onClick={() => { setOpen(false); onProfile(); }}>👤 View profile</button>
            <button className="acct-item" onClick={() => { setOpen(false); onTopup(); }}>＋ Add test funds</button>
            <div className="acct-sep" />
            <button className="acct-item" onClick={revealKey} disabled={loadingKey}>{loadingKey ? "…" : revealed ? "🙈 Hide private key" : "🔑 Export private key"}</button>
            {keyErr && <div className="muted" style={{ fontSize: 11, color: "var(--out)", padding: "0 12px 6px" }}>{keyErr}</div>}
            {revealed && (
              <div style={{ padding: "0 12px 10px" }}>
                <div className="mono" style={{ fontSize: 10.5, wordBreak: "break-all", background: "#0003", padding: "7px 8px", borderRadius: 7, lineHeight: 1.5 }}>{revealed}</div>
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button className="btn btn-sm" onClick={() => copy(revealed, "key")}>{copied === "key" ? "✓ copied" : "Copy key"}</button>
                  <span className="muted" style={{ fontSize: 10.5, lineHeight: 1.35 }}>⚠️ TESTNET key — import it into a Tempo wallet. Never share a mainnet key.</span>
                </div>
              </div>
            )}
            <div className="acct-sep" />
            <button className="acct-item danger" onClick={() => { setOpen(false); onLogout(); }}>⎋ Log out</button>
          </div>
        </>
      )}
    </div>
  );
}

function GlobalSearch({
  query,
  users,
  clips,
  userById,
  onQuery,
  onOpenProfile,
  onOpenClip,
}: {
  query: string;
  users: DemoUser[];
  clips: Clip[];
  userById: (uid: string) => DemoUser | undefined;
  onQuery: (q: string) => void;
  onOpenProfile: (id: string) => void;
  onOpenClip: (clip: Clip) => void;
}) {
  const q = query.trim().toLowerCase();
  const profiles = q
    ? users
        .filter((u) => [u.name, u.handle, u.role, u.bio ?? ""].join(" ").toLowerCase().includes(q))
        .slice(0, 5)
    : [];
  const videos = q
    ? clips
        .filter((c) => [c.title, c.creator, ...c.tags].join(" ").toLowerCase().includes(q))
        .slice(0, 6)
    : [];
  const hasResults = profiles.length > 0 || videos.length > 0;
  const openProfile = (id: string) => { onQuery(""); onOpenProfile(id); };
  const openClip = (clip: Clip) => { onQuery(""); onOpenClip(clip); };

  return (
    <div className="global-search">
      <input
        className="search-input"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search profiles or videos"
        aria-label="Search profiles or videos"
      />
      {q && (
        <div className="search-panel">
          {hasResults ? (
            <>
              {profiles.length > 0 && (
                <div className="search-section">
                  <div className="search-label">Profiles</div>
                  {profiles.map((u) => (
                    <button key={u.id} className="search-row" onClick={() => openProfile(u.id)}>
                      <Avatar user={u} size={34} />
                      <span className="search-copy">
                        <b>{u.name}</b>
                        <small>@{u.handle} · {u.role}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {videos.length > 0 && (
                <div className="search-section">
                  <div className="search-label">Videos</div>
                  {videos.map((clip) => {
                    const owner = userById(clip.ownerId);
                    return (
                      <button key={clip.id} className="search-row" onClick={() => openClip(clip)}>
                        <span className="search-thumb">
                          {clip.hasVideo ? <video src={videoSrc(clip.id) + "#t=0.1"} preload="metadata" muted playsInline /> : <span>{clip.thumb ?? "🎬"}</span>}
                        </span>
                        <span className="search-copy">
                          <b>{clip.title}</b>
                          <small>@{owner?.handle ?? clip.creator} · {usd(Number(clip.pricePerSec))}/sec</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="search-empty">No profiles or videos found.</div>
          )}
        </div>
      )}
    </div>
  );
}

function TopupModal({ me, onClose, onError, onFunded }: { me: DemoUser; onClose: () => void; onError: (e: string) => void; onFunded: (message: string) => void }) {
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  async function addTestFunds() {
    setBusy(true);
    try {
      const rounds = Math.max(1, Math.round(amount / 5));
      for (let i = 0; i < rounds; i++) await fundUser(me.id);
      onFunded(`✓ Added ${usd(rounds * 5)} test funds. No real card payment was made.`);
      onClose();
    } catch (e: any) {
      onError(e?.message ?? String(e));
    }
    setBusy(false);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Add test funds</h3><button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button></div>
        <div className="muted" style={{ marginBottom: 12 }}>Demo mode uses test funds instead of Stripe Checkout. This adds spendable app credit and best-effort testnet pathUSD, without charging real money.</div>
        <div className="topup-grid">
          {[5, 10, 25].map((v) => (
            <button key={v} className={"topup-choice" + (amount === v ? " on" : "")} onClick={() => setAmount(v)}>${v}</button>
          ))}
        </div>
        <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={addTestFunds} disabled={busy}>{busy ? "adding test funds…" : `Add ${usd(amount)} test funds`}</button>
        <div className="muted" style={{ marginTop: 10, fontSize: 11.5, textAlign: "center" }}>Testnet only · no real card payment · no Stripe checkout</div>
      </div>
    </div>
  );
}

// ───────────────────────── §3 transparency: glass ledger ─────────────────────
function LedgerRow({ k, v, dir, note, big }: { k: string; v: number; dir: "in" | "out" | "fee" | "net"; note?: string; big?: boolean }) {
  const color = dir === "in" ? "var(--in)" : dir === "out" ? "var(--out)" : dir === "fee" ? "var(--accent2)" : v >= 0 ? "var(--in)" : "var(--out)";
  const sign = dir === "in" ? "+" : dir === "out" ? "−" : dir === "fee" ? "•" : v >= 0 ? "+" : "−";
  return (
    <div className={"ledger-row" + (big ? " big" : "")}>
      <div><div className="ledger-k">{k}</div>{note && <div className="muted" style={{ fontSize: 11.5 }}>{note}</div>}</div>
      <div className="ledger-v" style={{ color }}>{sign} {usd(Math.abs(v))}</div>
    </div>
  );
}
/** The "we replace the blackbox middleman" view: a glass ledger over the REAL on-chain
 *  flows for this wallet, with the platform margin shown (not hidden) and every figure
 *  verifiable in the Tempo explorer. */
function TransparencyView({ me, onBack }: { me: DemoUser; onBack: () => void }) {
  const [net, setNet] = useState<NetSnapshot | null>(null);
  useEffect(() => {
    let on = true;
    const tick = () => fetchNet(me.id).then((n) => { if (on) setNet(n); }).catch(() => {});
    tick(); const id = setInterval(tick, 2000); return () => { on = false; clearInterval(id); };
  }, [me.id]);
  const out = net?.outUsd ?? 0;
  const inUsd = net?.inUsd ?? 0;
  const margin = +(out * PLATFORM_FEE).toFixed(6);
  const creatorGot = +(out - margin).toFixed(6);
  const netUsd = +(inUsd - out).toFixed(6);
  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back</button><span className="muted">Open ledger · no blackbox middleman</span></div>
      <div className="section-title">Glass ledger — every euro on-chain</div>
      <div className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 13, maxWidth: 640 }}>
        FLOW replaces the opaque platform middleman with an open protocol. Every figure below is a real on-chain pathUSD flow on Tempo testnet, settled in MPP payment channels and verifiable in the explorer. The platform margin is <b>shown, not hidden</b>.
      </div>
      <div className="ledger">
        <LedgerRow k="Viewer paid (you → creators)" v={out} dir="out" note="per-second watchtime" />
        <LedgerRow k="Creator received" v={creatorGot} dir="out" note={`${Math.round((1 - PLATFORM_FEE) * 100)}% of watch spend`} />
        <LedgerRow k={`Platform margin (${(PLATFORM_FEE * 100).toFixed(0)}%)`} v={margin} dir="fee" note="transparent · configurable · not hidden" />
        <div className="ledger-sep" />
        <LedgerRow k="Advertiser paid (→ you)" v={inUsd} dir="in" note="per verified second of attention" />
        <div className="ledger-sep" />
        <LedgerRow k="Your net cost to watch" v={netUsd} dir="net" note="ads finance the creators you watch" big />
      </div>
      <div className="receipt" style={{ marginTop: 16, maxWidth: 640 }}>
        <div className="statline"><span className="k">your wallet (all txs)</span><a className="mono" href={explorerAddressUrl(me.address)} target="_blank" rel="noreferrer">{me.address.slice(0, 14)}…↗</a></div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Per-second micro-payments settle off-chain as signed channel vouchers and finalize on-chain at session end — thousands of sub-cent transfers that are only economical on Tempo.</div>
      </div>
      {net && net.events.length > 0 && (
        <div className="feed-events" style={{ marginTop: 16, maxWidth: 640 }}>
          <div className="role-chip">recent on-chain flows</div>
          {net.events.slice(0, 12).map((e) => (
            <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
              <span style={{ color: e.direction === "in" ? "var(--in)" : "var(--out)" }}>{e.direction === "in" ? "▲ from" : "▼ to"} {e.counterparty}</span>
              <span className="muted">{usd(Number(e.amount))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── §2 Live-Saldo + §5 agent + §A dynamic pricing ─────
/** Big animated money counter (sub-cent precision so it's obvious this needs Tempo). */
function FlowCounter({ label, amount, dir, sub }: { label: string; amount: number; dir: "in" | "out" | "net"; sub?: ReactNode }) {
  const color = dir === "in" ? "var(--in)" : dir === "out" ? "var(--out)" : amount >= 0 ? "var(--in)" : "var(--out)";
  const sign = dir === "out" ? "−" : dir === "in" ? "+" : amount >= 0 ? "+" : "−";
  return (
    <div className={"flow-counter flow-" + dir}>
      <div className="flow-counter-label">{label}</div>
      <div className="flow-counter-num" style={{ color }}>{sign} ${Math.abs(amount).toFixed(4)}</div>
      {sub && <div className="flow-counter-sub">{sub}</div>}
    </div>
  );
}

/**
 * THE pitch screen. A creator video plays (money streams OUT per second) WHILE an ad
 * runs alongside and pays the viewer per VERIFIED second (money IN) — the net balance
 * hovers around zero. Both are real on-chain MPP. The right (IN) side is driven by an
 * autonomous advertiser agent whose per-second price is the live CLEARING PRICE of a
 * per-second second-price auction between competing advertiser agents (§5 + §A).
 *
 * GUARDRAIL (§A2): the price floats ONLY on the demand side (competing advertiser
 * bids). The viewer's attention is a BINARY GATE — it unlocks payment but never sets
 * the amount — so optimizing the (fakeable) attention signal can't raise the price.
 */
function FlowSession({ clip, me, onBack, onError }: { clip: Clip; me: DemoUser; onBack: () => void; onError: (e: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "starting" | "running" | "settling" | "done">("idle");
  const [out, setOut] = useState(0);          // paid to creator this session (watch tick)
  const [inUsd, setInUsd] = useState(0);       // earned from the ad (on-chain /net delta)
  const [clearing, setClearing] = useState(0); // live market price €/s (auction clearing)
  const [bidders, setBidders] = useState(0);   // active advertiser agents bidding
  const [ad, setAd] = useState<Campaign | null>(null);
  const [attention, setAttention] = useState(true); // manual look-away
  const [visible, setVisible] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [challenge, setChallenge] = useState<AttentionChallenge | null>(null);
  const [settlement, setSettlement] = useState<{ paid: number; earned: number; refund: number; txHash?: string } | null>(null);

  const handle = useRef<WatchHandle | null>(null);
  const token = useRef<string | undefined>(undefined);
  const inBaseline = useRef<number | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const adBox = useRef<HTMLDivElement | null>(null);
  const attRef = useRef(attention); attRef.current = attention;
  const visRef = useRef(visible); visRef.current = visible;
  const scrRef = useRef(onScreen); scrRef.current = onScreen;
  const adRef = useRef<Campaign | null>(null); adRef.current = ad;
  const activeRef = useRef(false); // true between start() and stop()/unmount — guards async setters
  const running = phase === "running";
  // Freeze the net at settlement so it doesn't flicker after the streams stop.
  const net = settlement ? +(settlement.earned - settlement.paid).toFixed(6) : +(inUsd - out).toFixed(6);
  // The ad reward only ACCRUES while attention is verified (binary gate). The PRICE
  // (clearing) is independent of this — see §A2.
  const gateOpen = running && attention && visible && onScreen;

  // Layer 1a: tab visibility. Layer 1b: ad box on-screen.
  useEffect(() => {
    const f = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", f); f();
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  useEffect(() => {
    const el = adBox.current; if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e && e.isIntersecting && e.intersectionRatio > 0.3), { threshold: [0, 0.3, 1] });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => () => { activeRef.current = false; handle.current?.stop().catch(() => {}); const a = adRef.current; if (a) stopAd(a.id, me.id); }, [me.id]);

  /** Re-clear the per-second attention auction: real funded-campaign bids + a couple of
   *  simulated competing advertiser agents so the market visibly moves. Second-price.
   *  §A2: the price depends ONLY on advertiser bids + time — never on viewer attention. */
  async function refreshMarket() {
    try {
      const a = await runAuction(me.id);
      const realBids = a.bids.filter((b) => b.funded).map((b) => b.bidUsd);
      // MOCK: simulated competing advertiser agents (1–3) so the clearing price moves on
      // screen. Their bids oscillate over TIME — never on the viewer's attention (§A2).
      const t = performance.now() / 1000;
      const simCount = 1 + Math.round(1 + Math.sin(t / 6));
      const base = a.winner ? Number(a.winner.pricePerSec) : a.reserveUsd || 0.0006;
      const sims = Array.from({ length: simCount }, (_, i) => +(base * (0.55 + 0.8 * Math.abs(Math.sin(t / 2.5 + i * 1.7)))).toFixed(6));
      const all = [...realBids, ...sims].sort((x, y) => y - x);
      const clear = (all.length >= 2 ? all[1] : all[0]) ?? a.reserveUsd ?? 0.0006; // second-price clearing
      if (activeRef.current) { setClearing(+clear.toFixed(6)); setBidders(all.length); if (a.winner && !adRef.current) setAd(a.winner); }
      return a.winner ?? null;
    } catch { return adRef.current; }
  }

  async function start() {
    if (phase === "running" || phase === "starting") return;
    activeRef.current = true;
    setPhase("starting"); setOut(0); setInUsd(0); setSettlement(null); setChallenge(null); setAttention(true);
    inBaseline.current = null; token.current = undefined;
    const winner = await refreshMarket();
    if (!activeRef.current) return; // stopped/unmounted mid-await
    const theAd = winner ?? adRef.current;
    if (!theAd) { onError("No funded ad is bidding right now — fund an ad in the Ad Studio first."); activeRef.current = false; setPhase("idle"); return; }
    setAd(theAd);
    // OUT — pay the creator per second (real on-chain MPP).
    try {
      handle.current = await watchClip(clip, me,
        (tk: Tick) => { setOut(tk.spentUsd); video.current?.play().catch(() => {}); },
        () => {});
    } catch (e: any) { onError(e?.message ?? String(e)); activeRef.current = false; setPhase("idle"); return; }
    if (!activeRef.current) { handle.current?.stop().catch(() => {}); handle.current = null; return; }
    // IN — open the attention session; the advertiser agent pays per verified second.
    token.current = await openAttentionSession(theAd.id, me.id, clearing || undefined);
    runAd(theAd.id, me.id);
    if (!activeRef.current) return;
    setPhase("running"); // heartbeat/net/auction effects start ONLY now — channel + token ready
  }

  // Heartbeat (attention proof) + keep the advertiser agent alive, while running.
  useEffect(() => {
    if (!running || !ad || !handle.current) return;
    let alive = true;
    const beat = async () => {
      const v = video.current;
      const playing = !!v && !v.paused && !v.ended;
      const res = await sendHeartbeat(ad.id, me.id, token.current, { visible: visRef.current && attRef.current, playing, onScreen: scrRef.current });
      if (alive) setChallenge(res?.challenge ?? null);
    };
    beat(); const beatId = setInterval(beat, 1000);
    const pumpId = setInterval(() => { if (attRef.current && visRef.current && scrRef.current) runAd(ad.id, me.id); }, 4000);
    return () => { alive = false; clearInterval(beatId); clearInterval(pumpId); };
  }, [running, ad?.id, me.id]);

  // Poll on-chain net → IN delta since the session started (authoritative, on-chain).
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const n = await fetchNet(me.id);
        if (inBaseline.current == null) inBaseline.current = n.inUsd;
        if (alive) setInUsd(+(n.inUsd - (inBaseline.current ?? 0)).toFixed(6));
      } catch { /* keep last */ }
    }, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [running, me.id]);

  // §A: re-clear the auction every ~3s so the price visibly moves with competition.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => { void refreshMarket(); }, 3000);
    return () => clearInterval(id);
  }, [running, me.id]);

  // Play the ad only while the gate is open (verified attention).
  useEffect(() => {
    const v = video.current; if (!v) return;
    if (gateOpen) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  }, [gateOpen]);

  async function stop() {
    if (phase !== "running" && phase !== "starting") return;
    activeRef.current = false;
    setPhase("settling");
    let txHash: string | undefined, refund = 0;
    try {
      const sum = await handle.current?.stop();      // settle viewer→creator channel on-chain
      txHash = sum?.txHash; refund = Math.max(0, 0.5 - (sum?.spentUsd ?? out)); // unused viewer deposit
    } catch (e: any) { onError(e?.message ?? String(e)); }
    handle.current = null;
    const a = adRef.current; if (a) await stopAd(a.id, me.id); // close ad channel → advertiser refunded
    token.current = undefined; inBaseline.current = null;
    setSettlement({ paid: out, earned: inUsd, refund, txHash });
    setPhase("done");
  }

  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back</button><span className="muted">Live balance · the self-financing feed</span></div>

      {/* THE money line: three live counters, net hovers around zero */}
      <div className="flow-saldo">
        <FlowCounter label="↘ to creator / sec" dir="out" amount={out} sub={<span className="muted">{usd(Number(clip.pricePerSec))}/s · watchtime</span>} />
        <div className="flow-net">
          <div className="flow-counter-label">net balance</div>
          <div className="flow-net-num" style={{ color: net >= 0 ? "var(--in)" : "var(--out)" }}>{net >= 0 ? "+" : "−"} ${Math.abs(net).toFixed(4)}</div>
          <div className="flow-counter-sub muted">{running ? "watching costs ≈ €0 net" : phase === "starting" ? "opening channels…" : phase === "settling" ? "settling on-chain…" : phase === "done" ? "session settled on-chain" : "press start"}</div>
        </div>
        <FlowCounter label="↗ from advertiser / sec" dir="in" amount={inUsd} sub={
          <span className="agent-overlay">🤖 {bidders || 1} agents bidding <span style={{ opacity: .65 }}>(real + simulated)</span> · clearing <b style={{ color: "var(--in)" }}>{usd(clearing)}/s</b> {gateOpen ? "→ settled" : ""}</span>
        } />
      </div>

      <div className="flow-stage">
        {/* creator video — money OUT */}
        <div className="flow-pane">
          <div className="player">
            {clip.hasVideo ? <video ref={video} src={videoSrc(clip.id)} preload="metadata" loop playsInline muted={false} /> : <span className="emoji">{clip.thumb ?? "🎬"}</span>}
            <span className="badge" style={{ background: "var(--out)" }}>↘ paying creator</span>
          </div>
          <div className="w-title" style={{ fontSize: 15 }}>{clip.title}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>@{clip.creator}</div>
        </div>

        {/* ad — money IN, gated on verified attention */}
        <div className="flow-pane" ref={adBox}>
          <div className="player ad" style={{ opacity: gateOpen ? 1 : 0.5 }}>
            {ad?.hasVideo ? <video src={videoSrc(ad.id)} loop muted playsInline autoPlay /> : <span className="emoji">{ad?.thumb ?? "📣"}</span>}
            <span className="adtag">● AD</span>
            {running && !gateOpen && <div className="ov" style={{ fontSize: 13 }}>{!visible ? "🛑 tab hidden — paused" : !onScreen ? "⬆️ scroll ad into view" : "🙈 paused — click to resume"}</div>}
            {challenge && gateOpen && (
              <button className="att-challenge" style={{ left: challenge.x + "%", top: challenge.y + "%" }} onClick={(e) => { e.stopPropagation(); setChallenge(null); void answerChallenge(ad!.id, me.id, token.current, challenge.id); }}>👀 tap to keep earning</button>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            attention = <b>binary gate</b> (verified ✓/✗) · price = <b>live market</b> (real + simulated advertiser bids){" "}
            <button className="linkbtn" onClick={() => setAttention((a) => !a)}>{attention ? "look away" : "look back"}</button>
          </div>
        </div>
      </div>

      <div className="flow-controls">
        {phase === "idle" || phase === "done"
          ? <button className="btn btn-lg" onClick={start}>▶ Start flow session</button>
          : phase === "starting"
          ? <button className="btn btn-lg" disabled>opening channels…</button>
          : <button className="btn btn-lg btn-ghost" onClick={stop} disabled={phase === "settling"}>{phase === "settling" ? "settling on-chain…" : "■ Stop & settle"}</button>}
      </div>

      {settlement && (
        <div className="receipt" style={{ marginTop: 16, maxWidth: 560, marginInline: "auto" }}>
          <div className="receipt-head">✓ Session settled on-chain (Tempo)</div>
          <div className="statline"><span className="k">paid to creator</span><span style={{ color: "var(--out)" }}>− {usd(settlement.paid)}</span></div>
          <div className="statline"><span className="k">earned from ads</span><span style={{ color: "var(--in)" }}>+ {usd(settlement.earned)}</span></div>
          <div className="statline"><span className="k">net cost to watch</span><span><b>{settlement.earned - settlement.paid >= 0 ? "+" : "−"} {usd(Math.abs(settlement.earned - settlement.paid))}</b></span></div>
          <div className="statline"><span className="k">unused deposit refunded</span><span style={{ color: "var(--in)" }}>↩ {usd(settlement.refund)}</span></div>
          {settlement.txHash && <div className="statline"><span className="k">settlement tx</span><a className="mono" href={explorerTxUrl(settlement.txHash)} target="_blank" rel="noreferrer">{settlement.txHash.slice(0, 12)}…↗</a></div>}
        </div>
      )}
    </div>
  );
}

/** Explains the whole concept in one glance, at the top of Home. The thesis in three
 *  steps + a CTA into the Live-Saldo demo — so a first-time visitor "gets it" instantly. */
function ConceptHero({ onTry }: { onTry: () => void }) {
  return (
    <div className="concept">
      <div className="concept-title">Watching that <span style={{ color: "var(--in)" }}>pays for itself</span></div>
      <div className="muted concept-sub">Money flows both ways in real time, on-chain — no subscription, no blackbox middleman.</div>
      <div className="concept-steps">
        <div className="concept-step">
          <div className="concept-ico" style={{ color: "var(--out)" }}>▼</div>
          <b>You watch → you pay</b>
          <span className="muted">creators are paid <b>per second</b> you watch — sub-cent, on-chain (≈ $0.0003/s)</span>
        </div>
        <div className="concept-step">
          <div className="concept-ico" style={{ color: "var(--in)" }}>▲</div>
          <b>Ads pay you</b>
          <span className="muted">earn <b>per verified second</b> of attention — priced live by autonomous advertiser agents</span>
        </div>
        <div className="concept-step">
          <div className="concept-ico">⚖</div>
          <b>Net ≈ €0</b>
          <span className="muted">“20 min watched, ~€0 net.” Every cent is traceable in the open ledger</span>
        </div>
      </div>
      <div className="concept-cta">
        <button className="btn btn-lg" onClick={onTry}>▶ See the live balance</button>
        <span className="muted" style={{ fontSize: 12 }}>Powered by Tempo + MPP — thousands of sub-cent payments per second, settled on-chain. ⚠️ Testnet.</span>
      </div>
    </div>
  );
}

function App() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [me, setMe] = useState<DemoUser | null>(null);
  const [feed, setFeed] = useState<Clip[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [net, setNet] = useState<NetSnapshot | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [view, setView] = useState("home");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const toggleTheme = () => setTheme((t) => { const next: Theme = t === "dark" ? "light" : "dark"; applyTheme(next); return next; });
  const [current, setCurrent] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [search, setSearch] = useState("");
  // ad (earn)
  const [adCampaign, setAdCampaign] = useState<string | null>(null);
  const [auctionRate, setAuctionRate] = useState<number | null>(null); // auction clearing price for AdWatch
  // go-live (creator)
  const [liveTitle, setLiveTitle] = useState(""); const [goingLive, setGoingLive] = useState(false);
  // studio (creator upload)
  const [title, setTitle] = useState(""); const [tags, setTags] = useState(""); const [file, setFile] = useState<File | null>(null); const [uploading, setUploading] = useState(false);
  const [price, setPrice] = useState("0.002"); // creator-set price ($/sec) for new uploads
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({}); const [savingPrice, setSavingPrice] = useState<string | null>(null);
  const [editingClip, setEditingClip] = useState<string | null>(null);
  const [titleEdit, setTitleEdit] = useState(""); const [tagEdit, setTagEdit] = useState("");
  const [savingMeta, setSavingMeta] = useState(false); const [deletingClip, setDeletingClip] = useState<string | null>(null);
  // ad studio (advertiser upload)
  const [adTitle, setAdTitle] = useState(""); const [adTags, setAdTags] = useState(""); const [adFile, setAdFile] = useState<File | null>(null); const [adBudget, setAdBudget] = useState("0.20"); const [publishingAd, setPublishingAd] = useState(false); const [fundingAd, setFundingAd] = useState<string | null>(null);
  const [stoppingAd, setStoppingAd] = useState<string | null>(null);
  const [fundAmt, setFundAmt] = useState<Record<string, string>>({});
  const [adTx, setAdTx] = useState<Record<string, { kind: "escrow" | "refund"; tx?: string; amountUsd?: number }>>({});
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    if (!SERVER_CONFIGURED) return;
    fetchUsers().then(setUsers).catch((e) => setError(e.message));
    refreshFeed();
    fetchCampaigns().then(setCampaigns).catch(() => {});
    try {
      const saved = localStorage.getItem("tempoflow-me");
      if (saved) {
        const u = JSON.parse(saved) as DemoUser;
        setMe(u); // optimistic; hydrate the signing key if missing (app accounts)
        if (!isValidKey(u.key)) ensureKey(u).then((hu) => { setMe(hu); localStorage.setItem("tempoflow-me", JSON.stringify(hu)); }).catch(() => {});
      }
    } catch {}
    const payment = new URLSearchParams(window.location.search).get("payment");
    if (payment === "success") setPaymentNotice("Payment received. Your balance will refresh after confirmation.");
    if (payment === "cancel") setPaymentNotice("Payment canceled. No credit was added.");
  }, []);
  function refreshFeed() { if (SERVER_CONFIGURED) fetchFeed().then(setFeed).catch((e) => setError(e.message)); }

  useEffect(() => {
    if (!me) return;
    setView("home");
    const tick = () => {
      fetchNet(me.id).then(setNet).catch(() => {});
      fetchBalance(me.id).then(setBalance).catch(() => {});
      fetchCampaigns().then(setCampaigns).catch(() => {}); // live funding status
    };
    tick(); const id = setInterval(tick, 3000); return () => clearInterval(id);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("payment") !== "success" || !sessionId) return;
    syncCheckoutSession(me.id, sessionId)
      .then(async () => {
        setPaymentNotice("✓ Payment confirmed — settled as ◎ pathUSD on Tempo and added to your balance.");
        setBalance(await fetchBalance(me.id));
      })
      .catch(() => setPaymentNotice("Payment received. Waiting for confirmation."));
  }, [me]);

  async function login(u: DemoUser) { const hu = await ensureKey(u); localStorage.setItem("tempoflow-me", JSON.stringify(hu)); setMe(hu); setError(null); }
  function logout() { localStorage.removeItem("tempoflow-me"); setMe(null); setAdCampaign(null); setProfileId(null); setView("home"); }
  function openProfile(id: string) { setProfileId(id); setCurrent(null); setAdCampaign(null); setError(null); setView("profile"); }
  function onMeUpdate(u: Partial<DemoUser>) { setMe((m) => { if (!m) return m; const merged = { ...m, ...u }; localStorage.setItem("tempoflow-me", JSON.stringify(merged)); return merged; }); }
  async function submitAd() {
    if (!me || !adTitle.trim()) return; setPublishingAd(true);
    try {
      // Create the ad UNFUNDED (no phantom budget), then escrow the initial amount
      // on-chain so its committed budget reflects real, refundable deposited funds.
      const ad = await uploadAd(me.id, adTitle.trim(), adTags.split(",").map((t) => t.trim()).filter(Boolean), adFile, 0);
      const initial = Number(adBudget);
      if (initial > 0) {
        const r = await fundCampaign(me, ad.id, initial);
        setAdTx((m) => ({ ...m, [ad.id]: { kind: "escrow", tx: r.escrowTx, amountUsd: initial } }));
      }
      setAdTitle(""); setAdTags(""); setAdFile(null); setAdBudget("0.20"); setCampaigns(await fetchCampaigns()); setBalance(await fetchBalance(me.id));
    }
    catch (e: any) { setError(e?.message ?? String(e)); } setPublishingAd(false);
  }
  async function doFundAd(id: string) {
    if (!me) return;
    const amt = Number(fundAmt[id] ?? "0.20");
    if (!(amt > 0)) { setError("enter an amount greater than 0 to escrow"); return; }
    setFundingAd(id);
    try {
      const r = await fundCampaign(me, id, amt);
      setAdTx((m) => ({ ...m, [id]: { kind: "escrow", tx: r.escrowTx, amountUsd: amt } }));
      setCampaigns(await fetchCampaigns());
      setBalance(await fetchBalance(me.id));
    } catch (e: any) { setError(e?.message ?? String(e)); }
    setFundingAd(null);
  }
  async function doStopAd(id: string) {
    if (!me) return;
    if (!confirm("Stop this campaign and refund the unspent escrow to your wallet?")) return;
    setStoppingAd(id);
    try {
      const r = await stopCampaign(me, id);
      setAdTx((m) => ({ ...m, [id]: { kind: "refund", tx: r.refundTx, amountUsd: r.refundedUsd } }));
      setCampaigns(await fetchCampaigns());
      setBalance(await fetchBalance(me.id));
    } catch (e: any) { setError(e?.message ?? String(e)); }
    setStoppingAd(null);
  }
  async function getFunds() { if (!me) return; setFunding(true); try { await fundUser(me.id); setBalance(await fetchBalance(me.id)); } catch (e: any) { setError(e?.message); } setFunding(false); }
  async function submitUpload() {
    if (!me || !file || !title.trim()) return; setUploading(true);
    try { await uploadClip(me.id, title.trim(), tags.split(",").map((t) => t.trim()).filter(Boolean), file, 60, price); setTitle(""); setTags(""); setFile(null); refreshFeed(); }
    catch (e: any) { setError(e?.message ?? String(e)); } setUploading(false);
  }
  async function startGoLive() {
    if (!me) return; setGoingLive(true);
    try {
      const clip = await goLive(me.id, liveTitle.trim() || `${me.name} — LIVE`, ["live"]);
      setLiveTitle(""); refreshFeed();
      setCurrent(clip); setAdCampaign(null); setProfileId(null); setView("watch"); // jump into your own stream
    } catch (e: any) { setError(e?.message ?? String(e)); }
    setGoingLive(false);
  }
  async function savePrice(id: string) {
    if (!me) return; const v = priceEdits[id]; if (v == null) return; setSavingPrice(id);
    try { const updated = await setClipPrice(id, me.id, v); setFeed((fd) => fd.map((c) => (c.id === id ? updated : c))); setPriceEdits((p) => { const nx = { ...p }; delete nx[id]; return nx; }); }
    catch (e: any) { setError(e?.message ?? String(e)); } setSavingPrice(null);
  }
  function startEditClip(c: Clip) { setEditingClip(c.id); setTitleEdit(c.title); setTagEdit(c.tags.join(", ")); }
  async function saveClipMeta(id: string) {
    if (!me) return; setSavingMeta(true);
    try { const updated = await updateClipMeta(id, me.id, titleEdit.trim(), tagEdit.split(",").map((t) => t.trim()).filter(Boolean)); setFeed((fd) => fd.map((c) => (c.id === id ? updated : c))); setEditingClip(null); }
    catch (e: any) { setError(e?.message ?? String(e)); } setSavingMeta(false);
  }
  async function doDeleteClip(id: string) {
    if (!me) return; if (!confirm("Delete this video? This can’t be undone.")) return; setDeletingClip(id);
    try { await deleteClip(id, me.id); setFeed((fd) => fd.filter((c) => c.id !== id)); if (current?.id === id) setCurrent(null); }
    catch (e: any) { setError(e?.message ?? String(e)); } setDeletingClip(null);
  }

  if (!SERVER_CONFIGURED) return <BackendSetup error={error} />;
  if (!me) return users.length ? <><Login users={users} onLogin={login} onError={setError} />{error && <div className="login"><div className="toast-err">{error}<button className="btn-ghost btn btn-sm" onClick={() => setError(null)}>×</button></div></div>}</> : <div className="login"><div className="muted" style={{ padding: 40, textAlign: "center" }}>{error ?? "loading TempoFlow…"}</div></div>;

  const myClips = feed.filter((c) => c.ownerId === me.id);
  const myAds = campaigns.filter((c) => c.ownerId === me.id);
  const activeAd = adCampaign ? campaigns.find((c) => c.id === adCampaign) ?? null : null;
  // Every logged-in wallet is full-access: watch, create + upload, advertise, earn.
  const nav: [string, string][] = [
    ["home", "Watch"],
    ["studio", "Creator Studio"],
    ["campaigns", "Advertise"],
    ["ledger", "Ledger"],
  ];
  const go = (v: string) => { setView(v); setCurrent(null); setSearch(""); };
  const userById = (uid: string) => users.find((u) => u.id === uid);

  return (
    <>
      <SparklesCore
        background="transparent"
        minSize={0.5}
        maxSize={1.3}
        particleDensity={70}
        speed={0.8}
        particleColor="#9147ff"
        className="app-sparkles"
      />
      <div className="app-sparkles-mask" />
      <div className="nav">
        <div className="brand"><BrandMark size={24} />Tempo<b>Flow</b></div>
        <div className="nav-links">{nav.map(([v, l]) => <button key={v} className={"nav-link" + (view === v ? " active" : "")} onClick={() => go(v)}>{l}</button>)}</div>
        <GlobalSearch
          query={search}
          users={users}
          clips={feed}
          userById={userById}
          onQuery={setSearch}
          onOpenProfile={openProfile}
          onOpenClip={(clip) => { setCurrent(clip); setAdCampaign(null); setProfileId(null); setView("watch"); }}
        />
        <div className="nav-right">
          <span className="pill" title="your real on-chain pathUSD balance">{balance != null ? fmtBal(balance) : "$…"} <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>pathUSD</span></span>
          <span className="pill" title="net this session">net <b style={{ color: (net?.netUsd ?? 0) >= 0 ? "var(--in)" : "var(--out)" }}>{(net?.netUsd ?? 0) >= 0 ? "+" : "−"}{usd(Math.abs(net?.netUsd ?? 0))}</b></span>
          <a className="pill mono addr-pill" href={explorerAddressUrl(me.address)} target="_blank" rel="noreferrer" title={`${me.address} — view your wallet on the Tempo explorer`} style={{ textDecoration: "none" }}>{shortAddr(me.address)} ↗</a>
          <button className="btn btn-sm" onClick={() => setTopupOpen(true)}>＋ Test funds</button>
          <button className="theme-toggle" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle theme">{theme === "dark" ? "☀" : "☾"}</button>
          <AccountMenu me={me} balance={balance} onProfile={() => openProfile(me.id)} onTopup={() => setTopupOpen(true)} onLogout={logout} />
        </div>
      </div>

      {error && <div className="page" style={{ paddingBottom: 0 }}><div className="toast-err">⚠ {error}<button className="btn-ghost btn btn-sm" onClick={() => setError(null)}>×</button></div></div>}
      {paymentNotice && <div className="page" style={{ paddingBottom: 0 }}><div className="receipt">{paymentNotice}<button className="btn-ghost btn btn-sm" onClick={() => setPaymentNotice(null)}>×</button></div></div>}
      {topupOpen && <TopupModal me={me} onClose={() => setTopupOpen(false)} onError={setError} onFunded={(message) => {
        setPaymentNotice(message);
        fetchBalance(me.id).then(setBalance).catch(() => {});
        fetchNet(me.id).then(setNet).catch(() => {});
      }} />}

      {view === "ledger"
        ? <TransparencyView me={me} onBack={() => go("home")} />
        : view === "profile" && profileId
        ? <ProfileView key={profileId} id={profileId} me={me} onBack={() => go("home")} onOpenProfile={openProfile} onWatch={(c) => { setCurrent(c); setView("watch"); }} onError={setError} onMeUpdate={onMeUpdate} onBalance={() => fetchBalance(me.id).then(setBalance).catch(() => {})} onLogout={logout} />
        : view === "watch" && current
        ? (current.live && current.ownerId === me.id
            ? <HostLiveView key={current.id} clip={current} me={me} onBack={() => go("home")} onEnded={() => { go("home"); refreshFeed(); }} />
            : <WatchView key={current.id} clip={current} me={me} balance={balance} onTopup={() => setTopupOpen(true)} onBack={() => go("home")} onProfile={openProfile} onError={setError} onSettled={() => { fetchNet(me.id).then(setNet).catch(() => {}); fetchBalance(me.id).then(setBalance).catch(() => {}); }} />)
        : (
          <div className="page">
            {view === "home" && (<>
              <ConceptHero onTry={() => { const c = feed.find((x) => x.hasVideo && !x.live) ?? feed[0]; if (c) { setCurrent(c); setView("watch"); } }} />
              <div className="section-title">Browse creators — you pay per second only while watching</div>
              {feed.length ? <div className="grid">{feed.map((c) => <VideoCard key={c.id} clip={c} owner={userById(c.ownerId)} onProfile={openProfile} onOpen={() => { setCurrent(c); setView("watch"); }} />)}</div> : <div className="muted">loading feed…</div>}
            </>)}

            {view === "studio" && (<>
              <div className="section-title">Creator Studio</div>
              <div className="login-card golive-card" style={{ marginTop: 0, marginBottom: 18 }}>
                <h3 style={{ marginTop: 0 }}>🔴 Go live</h3>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Start a live stream — every viewer pays per second, and a shared real-time meter shows concurrent watchers, combined $/sec, and 👏 cheers.</div>
                <div className="row" style={{ alignItems: "center", gap: 8 }}>
                  <input className="input" placeholder="Stream title (e.g. Live coding on Tempo)" value={liveTitle} onChange={(e) => setLiveTitle(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn" onClick={startGoLive} disabled={goingLive}>{goingLive ? "going live…" : "🔴 Go live"}</button>
                </div>
              </div>
              <div className="login-card" style={{ marginTop: 0, marginBottom: 18 }}>
                <h3 style={{ marginTop: 0 }}>Upload a video</h3>
                <div className="row" style={{ flexDirection: "column", gap: 9 }}>
                  <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <input className="input" placeholder="tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
                  <input className="input" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span className="muted" style={{ fontSize: 13 }}>Your price</span>
                    <span className="muted">$</span>
                    <input className="input" type="number" step="0.001" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 110 }} title="price per second" />
                    <span className="muted" style={{ fontSize: 13 }}>/ second</span>
                  </div>
                  <button className="btn" onClick={submitUpload} disabled={!file || !title.trim() || uploading}>{uploading ? "uploading…" : "⬆ Publish"}</button>
                  <div className="muted" style={{ fontSize: 12 }}>You set the price — viewers pay <b>{usd(Number(price) || 0)}/sec</b> from their app balance while they watch. You can change it anytime below.</div>
                </div>
              </div>
              <div className="section-title">Your channel ({myClips.length}) · <span className="chan-link" onClick={() => openProfile(me.id)}>view your profile →</span></div>
              {myClips.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {myClips.map((c) => {
                    const edited = priceEdits[c.id] ?? c.pricePerSec;
                    const isEditing = editingClip === c.id;
                    return (
                      <div key={c.id} className="adrow" style={{ borderLeftColor: c.live ? "var(--out)" : "var(--accent)" }}>
                        <div className="adrow-thumb" style={{ cursor: "pointer", position: "relative" }} onClick={() => { setCurrent(c); setView("watch"); }}>
                          {c.hasVideo ? <video src={videoSrc(c.id) + "#t=0.1"} preload="metadata" muted playsInline /> : <span style={{ fontSize: 30 }}>{c.thumb ?? "🎬"}</span>}
                          {c.live && <span className="live-badge" style={{ position: "absolute", top: 4, left: 4 }}>● LIVE</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {isEditing ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <input className="input" value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)} placeholder="title" />
                              <input className="input" value={tagEdit} onChange={(e) => setTagEdit(e.target.value)} placeholder="tags (comma separated)" />
                            </div>
                          ) : (<>
                            <div style={{ fontWeight: 700 }}>{c.live ? "🔴 " : ""}{c.title}</div>
                            <div className="muted" style={{ fontSize: 12 }}>{c.tags.join(", ") || "untagged"}{c.live ? " · live now" : ` · ${c.durationSec}s`}</div>
                            {!c.live && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>viewers pay <b style={{ color: "var(--out)" }}>{usd(Number(c.pricePerSec))}/sec</b> · ≈ {usd(Number(c.pricePerSec) * c.durationSec)} for the full clip</div>}
                          </>)}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {c.live ? (
                            <button className="btn btn-sm" onClick={() => { setCurrent(c); setView("watch"); }} title="open your live stream">open live ↗</button>
                          ) : isEditing ? (<>
                            <button className="btn btn-sm" onClick={() => saveClipMeta(c.id)} disabled={savingMeta || !titleEdit.trim()}>{savingMeta ? "…" : "Save"}</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditingClip(null)}>Cancel</button>
                          </>) : (<>
                            <span className="muted" style={{ fontSize: 12 }}>$</span>
                            <input className="input" type="number" step="0.001" min="0" style={{ width: 76 }} value={edited} onChange={(e) => setPriceEdits((p) => ({ ...p, [c.id]: e.target.value }))} />
                            <button className="btn btn-sm" onClick={() => savePrice(c.id)} disabled={savingPrice === c.id || edited === c.pricePerSec || !(Number(edited) > 0)}>{savingPrice === c.id ? "…" : "Save price"}</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => startEditClip(c)} title="edit title & tags">✎ Edit</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => doDeleteClip(c.id)} disabled={deletingClip === c.id} title="delete video" style={{ color: "var(--out)" }}>{deletingClip === c.id ? "…" : "🗑"}</button>
                          </>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <div className="muted">No clips yet — upload one above.</div>}
            </>)}

            {view === "earn" && (<>
              <div className="section-title">Earn — watch ads, get paid for your attention</div>
              <div className="muted" style={{ margin: "-8px 2px 14px", fontSize: 13 }}>Each ad pays per second while attention is verified. Ads with no funding can’t pay.</div>
              <AuctionPanel me={me} onStart={(id, clearing) => { setAuctionRate(clearing); setAdCampaign(id); }} />
              <div className="section-title" style={{ marginTop: 22 }}>Or pick an ad yourself</div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
                {campaigns.map((c) => {
                  const spent = c.spentUsd ?? 0, budget = Number(c.maxBudget);
                  const funded = c.funded ?? budget - spent >= Number(c.pricePerSec);
                  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                  return (
                    <div key={c.id} className="vcard" onClick={() => funded && (setAuctionRate(null), setAdCampaign(c.id))} style={{ cursor: funded ? "pointer" : "default" }}>
                      <div className="vthumb ad">
                        {c.hasVideo ? <video src={videoSrc(c.id) + "#t=0.1"} preload="metadata" muted playsInline /> : <span className="emoji">{c.thumb ?? "📣"}</span>}
                        <span className="adtag">● AD</span>
                        <span className="badge in-badge">+{usd(Number(c.pricePerSec))}/s</span>
                        {funded ? <div className="play">▶</div> : <div className="ov" style={{ fontSize: 13 }}>⛔ needs funding</div>}
                      </div>
                      <div className="vmeta">
                        <div className="a">{c.thumb ?? "📣"}</div>
                        <div style={{ flex: 1 }}>
                          <div className="vtitle">{c.title ?? c.advertiser}</div>
                          <div className="vchan">{c.advertiser} · sponsored</div>
                          <div className="bar" style={{ marginTop: 7 }}><i style={{ width: pct + "%", background: "linear-gradient(90deg,var(--out),#ff9356)" }} /></div>
                          <div className="vchan" style={{ marginTop: 4 }}>{funded ? <>funded · {usd(Math.max(0, budget - spent))} left</> : <span style={{ color: "var(--out)" }}>out of funding</span>}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>)}

            {view === "campaigns" && (<>
              <div className="section-title">Ad Studio</div>
              <div className="login-card" style={{ marginTop: 0, marginBottom: 18 }}>
                <h3 style={{ marginTop: 0 }}>Upload an ad</h3>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Your ad pays viewers per second of proven attention from your funded campaign budget. When the budget runs out, the ad stops paying.</div>
                <div className="row" style={{ flexDirection: "column", gap: 9 }}>
                  <input className="input" placeholder="Ad title" value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
                  <input className="input" placeholder="tags (comma separated)" value={adTags} onChange={(e) => setAdTags(e.target.value)} />
                  <input className="input" type="file" accept="video/*" onChange={(e) => setAdFile(e.target.files?.[0] ?? null)} />
                  <div className="row">
                    <input className="input" type="number" step="0.05" min="0" placeholder="escrow $" value={adBudget} onChange={(e) => setAdBudget(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn" onClick={submitAd} disabled={!adTitle.trim() || publishingAd}>{publishingAd ? "escrowing…" : "⬆ Publish + escrow"}</button>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>Publishing escrows that amount of <b>pathUSD</b> from your wallet on-chain into the platform vault. It pays viewers per second of proven attention; whatever isn’t spent is refunded to you when you stop the campaign.</div>
                </div>
              </div>
              <div className="section-title">Your ads ({myAds.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {myAds.map((c) => {
                  const spent = c.spentUsd ?? 0, budget = Number(c.maxBudget), left = Math.max(0, budget - spent);
                  const funded = c.funded ?? left >= Number(c.pricePerSec);
                  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                  const stopped = !!c.stopped;
                  const tx = adTx[c.id];
                  return (
                    <div key={c.id} className="adrow">
                      <div className="adrow-thumb ad">
                        {c.hasVideo ? <video src={videoSrc(c.id) + "#t=0.1"} preload="metadata" muted playsInline /> : <span style={{ fontSize: 30 }}>{c.thumb ?? "📣"}</span>}
                        <span className="adtag">● AD</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{c.title ?? c.id}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{usd(Number(c.pricePerSec))}/sec · {c.tags.join(", ") || "untargeted"}</div>
                        <div className="bar" style={{ marginTop: 7 }}><i style={{ width: pct + "%", background: "linear-gradient(90deg,var(--out),#ff9356)" }} /></div>
                        <div className="statline" style={{ marginTop: 5 }}><span className="k">escrowed on-chain</span><span><b>{usd(budget)}</b></span></div>
                        <div className="statline"><span className="k">paid to viewers</span><span>{usd(spent)}</span></div>
                        <div className="statline"><span className="k">refundable</span><span style={{ color: "var(--in)" }}>{usd(left)}</span></div>
                        {c.escrowTx && <div className="statline"><span className="k">escrow tx</span><a href={explorerTxUrl(c.escrowTx)} target="_blank" rel="noreferrer" className="mono">{c.escrowTx.slice(0, 10)}…↗</a></div>}
                        {c.refundTx && <div className="statline"><span className="k">refund tx</span><a href={explorerTxUrl(c.refundTx)} target="_blank" rel="noreferrer" className="mono">{c.refundTx.slice(0, 10)}…↗</a></div>}
                        {tx?.tx && !c.escrowTx && !c.refundTx && <div className="statline"><span className="k">{tx.kind === "refund" ? "refund tx" : "escrow tx"}</span><a href={explorerTxUrl(tx.tx)} target="_blank" rel="noreferrer" className="mono">{tx.tx.slice(0, 10)}…↗</a></div>}
                      </div>
                      <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", minWidth: 150 }}>
                        <span className={"chip " + (stopped ? "chip-bad" : funded ? "chip-ok" : "chip-bad")}>{stopped ? "■ stopped" : funded ? "✓ live · paying" : "⛔ unfunded"}</span>
                        <div className="row" style={{ gap: 4 }}>
                          <input className="input" type="number" step="0.05" min="0" placeholder="0.20" value={fundAmt[c.id] ?? ""} onChange={(e) => setFundAmt((m) => ({ ...m, [c.id]: e.target.value }))} style={{ width: 64, padding: "5px 7px" }} />
                          <button className="btn btn-faucet btn-sm" onClick={() => doFundAd(c.id)} disabled={fundingAd === c.id}>{fundingAd === c.id ? "escrowing…" : "＋ Escrow"}</button>
                        </div>
                        <button className="btn btn-sm" onClick={() => doStopAd(c.id)} disabled={stoppingAd === c.id || left <= 0} title={left <= 0 ? "nothing left to refund" : "stop paying + refund the unspent escrow to your wallet"}>{stoppingAd === c.id ? "refunding…" : "■ Stop + refund"}</button>
                      </div>
                    </div>
                  );
                })}
                {!myAds.length && <div className="muted">No ads yet — upload one above.</div>}
              </div>
              <div className="receipt" style={{ marginTop: 12 }}>paid to viewers this session: <b>{usd(net?.outUsd ?? 0)}</b></div>
            </>)}

            {/* live receipts */}
            {net && net.events.length > 0 && (
              <div className="feed-events" style={{ marginTop: 20 }}>
                <div className="role-chip">your live receipts</div>
                {net.events.slice(0, 8).map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: e.direction === "in" ? "var(--in)" : "var(--out)" }}>{e.direction === "in" ? "▲ from" : "▼ to"} {e.counterparty}</span>
                    <span className="muted">{usd(Number(e.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
