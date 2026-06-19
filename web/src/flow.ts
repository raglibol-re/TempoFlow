/**
 * Browser-side FLOW client (multi-user, role-based). Acts as the logged-in user,
 * paying from that user's wallet. ⚠️ TESTNET ONLY — demo keys come from the
 * server's /demo/users. Every network step is labeled so failures are precise.
 */

import { sessionManager } from "mppx/client";
import { createPublicClient, createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEMPO_RPC_URL, TOKEN_DECIMALS, ESCROW_CONTRACT, FLOW_CURRENCY, tempoTestnet,
  type Clip, type Campaign, type Role, type Goal, type AuctionResult, type LiveStats,
} from "@flow/shared";

/**
 * Resolve the backend URL at RUNTIME so a single Vercel build can target any
 * backend (e.g. a local machine exposed via an ngrok/cloudflared tunnel) without
 * rebuilding. Precedence: `?server=<url>` query param (remembered in
 * localStorage) → previously saved value → build-time VITE_SERVER_URL → localhost.
 */
function resolveServerUrl(): string {
  try {
    const qp = new URLSearchParams(window.location.search).get("server");
    if (qp) { localStorage.setItem("flow.serverUrl", qp); return qp.replace(/\/+$/, ""); }
    const saved = localStorage.getItem("flow.serverUrl");
    if (saved) return saved.replace(/\/+$/, "");
  } catch { /* non-browser context — fall through */ }
  return ((import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export const SERVER_URL = resolveServerUrl();

export interface DemoUser {
  id: string; name: string; role: Role; handle: string; avatar: string;
  address: `0x${string}`; key: `0x${string}`;
  // profile (creator-platform)
  bio?: string; pic?: string; followPrice?: string;
}
export interface AdminUser extends Omit<DemoUser, "key"> { balance: number }
export type PublicUser = Omit<DemoUser, "key">;
export interface Supporter extends PublicUser { amountUsd: string; since: number }
export interface Profile {
  user: PublicUser;
  balance: number;
  followerCount: number;
  followingCount: number;
  followEarnings: number;
  supporters: Supporter[];
  following: Supporter[];
  clips: Clip[];
  viewerFollows: boolean;
  goals?: Goal[];
}
export type { Goal, AuctionResult, LiveStats };

async function jget(path: string, label: string): Promise<any> {
  try {
    const r = await fetch(`${SERVER_URL}${path}`);
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
    return await r.json();
  } catch (e: any) { throw new Error(`${label} (${SERVER_URL}${path}): ${e?.message ?? e}`); }
}
async function jpost(path: string, body: any, label: string): Promise<any> {
  try {
    const r = await fetch(`${SERVER_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
    return await r.json();
  } catch (e: any) { throw new Error(`${label} (${SERVER_URL}${path}): ${e?.message ?? e}`); }
}

export const fetchUsers = () => jget("/demo/users", "load users").then((j) => j.users as DemoUser[]);
export const fetchFeed = () => jget("/feed", "load feed").then((j) => (j.clips ?? []) as Clip[]);
export const fetchCampaigns = () => jget("/campaigns", "load campaigns").then((j) => (j.campaigns ?? []) as Campaign[]);
export const fetchAdminUsers = () => jget("/admin/users", "load admin users").then((j) => (j.users ?? []) as AdminUser[]);
export const fundUser = (userId: string) => jpost("/demo/fund", { userId }, "get test funds");
export const createCampaign = (as: string, tags: string[]) => jpost("/campaigns", { as, tags }, "create campaign").then((j) => j.campaign as Campaign);
/** Fund an ad: tops up the advertiser wallet (faucet) + raises the budget cap. */
export const fundCampaign = (campaignId: string, amountUsd = 0.2) => jpost(`/campaigns/${campaignId}/fund`, { amountUsd }, "fund ad");
export const resetNet = () => jpost("/reset", {}, "reset").catch(() => {});
/** A challenge the viewer must answer to prove they're watching (Layer 2). */
export interface AttentionChallenge { id: string; x: number; y: number; answerMs: number }
export interface HeartbeatResult { ok: boolean; paused?: boolean; reason?: string; challenge: AttentionChallenge | null }
/** Open an attention session → token every heartbeat must carry (Layer 3). */
export const openAttentionSession = (campaignId: string, viewer: string, rewardRate?: number) =>
  jpost("/attention/session", { campaignId, viewer, rewardRate }, "open attention session").then((j) => j.token as string).catch(() => undefined);
/** Send a heartbeat with the session token + live attention signals (Layer 1).
 *  Returns the server's verdict, including any challenge to render (Layer 2). */
export const sendHeartbeat = (
  campaignId: string, viewer: string,
  token: string | undefined, signals: { visible: boolean; playing: boolean; onScreen: boolean },
) => jpost("/heartbeat", { campaignId, viewer, token, ...signals }, "heartbeat").catch(() => ({ ok: false, challenge: null })) as Promise<HeartbeatResult>;
/** Tap the challenge target → echoes its id back so payment resumes. */
export const answerChallenge = (campaignId: string, viewer: string, token: string | undefined, challengeId: string) =>
  jpost("/attention/answer", { campaignId, viewer, token, challengeId }, "answer challenge").catch(() => ({ ok: false }));
/** Tell the server you LEFT the ad → it closes the channel and Tempo refunds the
 *  advertiser the unspent deposit. (A look-away does NOT call this — the channel
 *  stays open so payment resumes instantly.) */
export const stopAd = (campaignId: string, viewer: string) =>
  jpost(`/attention/${campaignId}/${viewer}/stop`, {}, "stop ad").catch(() => {});
export const runAd = (campaignId: string, viewerId: string) => jpost("/demo/run-ad", { campaignId, viewerId }, "start advertiser").catch(() => {});

// ── Feature 1: live tip boost ────────────────────────────────────────────────
export const sendTip = (as: string, clipId: string, amountUsd: number) =>
  jpost("/tip", { as, clipId, amountUsd }, "send tip") as Promise<{ ok: boolean; balance: number; reason?: string }>;

// ── Feature 2: real-time attention auction ───────────────────────────────────
export const runAuction = (viewer: string) =>
  jpost("/auction/run", { viewer }, "run auction") as Promise<AuctionResult>;

// ── Feature 3: pay-per-token creator AI (NDJSON stream) ──────────────────────
export interface AskEvent { type: "start" | "token" | "done" | "out-of-balance" | "error"; text?: string; tokens?: number; costUsd?: number; balance?: number; via?: string; pricePerToken?: number; creator?: string; error?: string }
/** Stream a creator-AI answer, billing per token. Calls `onEvent` for each NDJSON
 *  line. Returns an abort function. */
export function askCreator(creatorId: string, as: string, question: string, onEvent: (e: AskEvent) => void): () => void {
  const ctl = new AbortController();
  (async () => {
    try {
      const r = await fetch(`${SERVER_URL}/ask/${creatorId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ as, question }), signal: ctl.signal,
      });
      if (!r.ok || !r.body) { onEvent({ type: "error", error: `HTTP ${r.status}` }); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) { const t = line.trim(); if (!t) continue; try { onEvent(JSON.parse(t) as AskEvent); } catch { /* partial */ } }
      }
    } catch (e: any) { if (e?.name !== "AbortError") onEvent({ type: "error", error: e?.message ?? String(e) }); }
  })();
  return () => ctl.abort();
}

// ── Feature 4: crowdfund goals ───────────────────────────────────────────────
export const fetchGoals = (creatorId: string, viewer?: string) =>
  jget(`/goals?creator=${creatorId}${viewer ? `&viewer=${viewer}` : ""}`, "load goals").then((j) => (j.goals ?? []) as Goal[]);
export const createGoal = (as: string, title: string, targetUsd: number, minutes?: number) =>
  jpost("/goals", { as, title, targetUsd, minutes }, "create goal").then((j) => j.goal as Goal);
export const pledgeGoal = (goalId: string, as: string, amountUsd: number) =>
  jpost(`/goals/${goalId}/pledge`, { as, amountUsd }, "pledge") as Promise<{ ok: boolean; balance?: number; reason?: string; goal: Goal }>;

// ── Feature 5: go-live streaming ─────────────────────────────────────────────
export const goLive = (as: string, title: string, tags: string[], pricePerSec?: string) =>
  jpost("/live/start", { as, title, tags, pricePerSec }, "go live").then((j) => j.clip as Clip);
export const stopLive = (id: string, as: string) => jpost(`/live/${id}/stop`, { as }, "end live").catch(() => {});
export const cheerLive = (id: string) => jpost(`/live/${id}/cheer`, {}, "cheer").then((j) => j.applause as number).catch(() => 0);
export const fetchLiveStats = (id: string) => jget(`/live/${id}/stats`, "live stats") as Promise<LiveStats>;

export const videoSrc = (clipId: string) => `${SERVER_URL}/video/${clipId}`;

/** Trace every fetch (RPC + server) so we can see exactly which request fails
 *  during channel open. Reports each RPC/watch call + any throw to /debug. */
let traced = false;
export function enableFetchTracing() {
  if (traced || typeof window === "undefined") return;
  traced = true;
  const orig = window.fetch.bind(window);
  const report = (o: any) => orig(`${SERVER_URL}/debug`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ context: "fetch-trace", ...o }) }).catch(() => {});
  window.fetch = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    const method = init?.method ?? (input?.method) ?? "GET";
    const interesting = url.includes("moderato.tempo") || url.includes("/watch/") || url.includes("/attention/");
    try {
      const r = await orig(input, init);
      if (interesting) report({ url, method, status: r.status });
      return r;
    } catch (e: any) {
      report({ url, method, error: String(e?.name) + ": " + String(e?.message ?? e) });
      throw e;
    }
  };
}

/** Browser-side reachability self-test → reported to the server log (/debug). */
export async function diagnose(context: string, extra: Record<string, unknown> = {}) {
  const probe = async (label: string, fn: () => Promise<any>) => {
    try { return { label, ok: true, ...(await fn()) }; }
    catch (e: any) { return { label, ok: false, error: String(e?.name ?? "") + ": " + String(e?.message ?? e) }; }
  };
  const server = await probe("server-health", async () => ({ status: (await fetch(`${SERVER_URL}/health`)).status }));
  const rpc = await probe("rpc-chainId(browser→RPC)", async () => {
    const r = await fetch(TEMPO_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }) });
    return { status: r.status, chainId: (await r.json())?.result };
  });
  const report = { context, extra, href: location.href, serverUrl: SERVER_URL, rpcUrl: TEMPO_RPC_URL, server, rpc };
  fetch(`${SERVER_URL}/debug`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) }).catch(() => {});
  return report;
}

export interface NetSnapshot {
  inUsd: number; outUsd: number; netUsd: number;
  events: { id: string; direction: "in" | "out"; amount: string; counterparty: string; contentId: string }[];
}
export const fetchNet = (as: string) => jget(`/net?as=${as}`, "load balance") as Promise<NetSnapshot>;
export interface AppBalance {
  balance: number;
  currency: string;
  transactions: Array<{ id: string; type: string; amount: string; direction: "credit" | "debit"; status: string; createdAt: number }>;
}
export const fetchAppBalance = (as: string) => jget(`/api/balance?as=${as}`, "load app balance") as Promise<AppBalance>;
export const fetchBalance = (as: string) => jget(`/onchain-balance?as=${as}`, "load balance").then((j) => (j.balance ?? 0) as number);
export const createTopupCheckoutSession = (as: string, amount: number) =>
  jpost("/api/stripe/create-topup-checkout-session", { as, amount }, "create checkout session") as Promise<{ url?: string; sessionId?: string }>;
export const syncCheckoutSession = (as: string, sessionId: string) =>
  jpost("/api/stripe/sync-checkout-session", { as, sessionId }, "sync checkout session") as Promise<{ ok: boolean; credited?: boolean; paymentStatus?: string }>;

// ── Profiles + pay-to-follow (super-follow) ──────────────────────────────────
/** URL for a user's uploaded profile picture (404s → caller falls back to symbol). */
export const picSrc = (id: string) => `${SERVER_URL}/pic/${id}`;
export const fetchProfile = (id: string, viewer?: string) =>
  jget(`/users/${id}/profile${viewer ? `?viewer=${viewer}` : ""}`, "load profile") as Promise<Profile>;
/** Update your own profile fields (only the keys you pass). */
export const updateProfile = (
  as: string,
  patch: { name?: string; handle?: string; avatar?: string; bio?: string; followPrice?: string },
) => jpost("/profile", { as, ...patch }, "save profile").then((j) => j.user as PublicUser);
/** Upload a profile picture (replaces the symbol). */
export async function uploadProfilePic(as: string, file: File): Promise<PublicUser> {
  const fd = new FormData(); fd.append("as", as); fd.append("image", file);
  const r = await fetch(`${SERVER_URL}/profile/pic`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload picture: HTTP ${r.status}`);
  return (await r.json()).user as PublicUser;
}
export const unfollowCreator = (follower: string, creator: string) =>
  jpost("/unfollow", { follower, creator }, "unfollow").then((j) => j.followerCount as number);

const ERC20_TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

/** Super-follow a creator: pay their follow price in pathUSD ON-CHAIN (straight
 *  from the follower's wallet to the creator's), then record the bond. A price of
 *  0 is a free follow (no transaction). ⚠️ TESTNET ONLY. */
export async function followCreator(
  me: DemoUser,
  creator: { id: string; address: `0x${string}`; followPrice?: string },
): Promise<{ txHash?: string; amountUsd: string }> {
  const price = Math.max(0, Number(creator.followPrice ?? "0"));
  let txHash: string | undefined;
  if (price > 0) {
    if (!me.key) throw new Error("your wallet key isn't available to pay");
    const account = privateKeyToAccount(me.key);
    const wallet = createWalletClient({ account, chain: tempoTestnet as any, transport: http(`${SERVER_URL}/rpc`) });
    try {
      txHash = await wallet.writeContract({
        address: FLOW_CURRENCY, abi: ERC20_TRANSFER_ABI, functionName: "transfer",
        args: [creator.address, parseUnits(String(price), TOKEN_DECIMALS)], chain: tempoTestnet as any,
      });
    } catch (e: any) {
      throw new Error(`super-follow payment failed: ${e?.shortMessage ?? e?.message ?? e}`);
    }
  }
  await jpost("/follow", { follower: me.id, creator: creator.id, txHash, amountUsd: String(price) }, "record follow");
  return { txHash, amountUsd: String(price) };
}

/** Log in with your own Tempo wallet (testnet private key → registered + usable).
 *  Full access: watch, create + upload, launch ads, earn. The key is kept in the
 *  browser (to pay creators) AND stored server-side (so the app can auto-pay your
 *  ads from your wallet). ⚠️ TESTNET ONLY. */
export async function connectTempoAccount(privateKey: string): Promise<DemoUser> {
  const key = (privateKey.trim().startsWith("0x") ? privateKey.trim() : "0x" + privateKey.trim()) as `0x${string}`;
  let address: `0x${string}`;
  try { address = privateKeyToAccount(key).address; } catch { throw new Error("invalid private key"); }
  const reg = await jpost("/users", { address, key, name: "My Wallet", handle: `you-${address.slice(2, 6)}` }, "register account");
  const u = reg.user;
  return { id: u.id, name: u.name, role: u.role, handle: u.handle, avatar: u.avatar ?? "🪪", address, key };
}

export async function registerAppAccount(name: string, handle: string): Promise<DemoUser> {
  const reg = await jpost("/users", { name, handle, role: "creator" }, "create account");
  const u = reg.user;
  return { id: u.id, name: u.name, role: u.role, handle: u.handle, avatar: u.avatar ?? "🪪", address: u.address, key: "" as `0x${string}` };
}

/** Advertiser uploads an ad (video + funded budget). */
export async function uploadAd(as: string, title: string, tags: string[], file: File | null, budgetUsd: number): Promise<Campaign> {
  const fd = new FormData();
  fd.append("as", as); fd.append("title", title); fd.append("tags", tags.join(",")); fd.append("budget", String(budgetUsd));
  if (file) fd.append("video", file);
  try {
    const r = await fetch(`${SERVER_URL}/campaigns`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).campaign as Campaign;
  } catch (e: any) { throw new Error(`upload ad: ${e?.message ?? e}`); }
}

/** Upload a clip with a real video file (multipart). */
export async function uploadClip(as: string, title: string, tags: string[], file: File, durationSec: number, pricePerSec?: string): Promise<Clip> {
  const fd = new FormData();
  fd.append("as", as); fd.append("title", title); fd.append("tags", tags.join(",")); fd.append("durationSec", String(durationSec));
  if (pricePerSec) fd.append("pricePerSec", pricePerSec);
  fd.append("video", file);
  try {
    const r = await fetch(`${SERVER_URL}/clips`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).clip as Clip;
  } catch (e: any) { throw new Error(`upload clip: ${e?.message ?? e}`); }
}

/** Re-price one of your clips (creator only) — viewers pay this $/sec. Returns the updated clip. */
export const setClipPrice = (clipId: string, as: string, pricePerSec: string) =>
  jpost(`/clips/${clipId}/price`, { as, pricePerSec }, "update price").then((j) => j.clip as Clip);

export interface Tick { second: number; spentUsd: number; creator: string; clipId: string }
/** Result of settling (closing) a payment channel — straight from the on-chain
 *  receipt. `refundUsd` is computed by the caller against the deposit it showed. */
export interface CloseSummary { spentUsd?: number; seconds?: number; txHash?: string; channelId?: string }
export interface WatchHandle { stop: () => Promise<CloseSummary | undefined> }

// Route browser chain calls through our server's RPC proxy (CORS-clean + 429 retry).
const RPC_PROXY = `${SERVER_URL}/rpc`;
function manager(user: DemoUser, maxDeposit = "0.5") {
  const account = privateKeyToAccount(user.key);
  const client = createPublicClient({ chain: tempoTestnet as any, transport: http(RPC_PROXY) });
  return sessionManager({ account, client, decimals: TOKEN_DECIMALS, maxDeposit, escrow: ESCROW_CONTRACT });
}
const rawToUsd = (raw?: string) => (raw == null ? undefined : Number(raw) / 10 ** TOKEN_DECIMALS);

/** Watch a clip as `me`, paying its creator per second. onTick each paid second;
 *  onEnd when the stream ends (funding stopped / closed). `maxDeposit` caps how
 *  much the channel can fund — a small value makes payment stop early (demo). */
export async function watchClip(
  clip: Clip, me: DemoUser, onTick: (t: Tick) => void,
  onEnd: (reason: "ended" | "out-of-funds") => void, maxDeposit = "0.5",
): Promise<WatchHandle> {
  void maxDeposit;
  const controller = new AbortController();
  const res = await fetch(`${SERVER_URL}/api/watch/${clip.id}?as=${me.id}`, { signal: controller.signal });
  if (!res.ok || !res.body) throw new Error(`start stream for "${clip.title}" failed: HTTP ${res.status}`);
  const drained = (async () => {
    try {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const t = JSON.parse(line);
            if (t?.type === "out-of-balance") { onEnd("out-of-funds"); controller.abort(); return; }
            if (t?.second) onTick(t as Tick);
          } catch { /* keep-alive */ }
        }
      }
      onEnd("ended");
    } catch {
      // mid-stream failure (e.g. funds/voucher cap reached) → funding stopped
      onEnd("out-of-funds");
    }
  })();
  return {
    async stop() {
      controller.abort();
      try { await fetch(`${SERVER_URL}/watch/${clip.id}/stop`, { method: "POST" }); }
      catch (e: any) { throw new Error(`stop failed: ${e?.message ?? e}`); }
      await drained;
      return {
        spentUsd: undefined,
        seconds: undefined,
      };
    },
  };
}
