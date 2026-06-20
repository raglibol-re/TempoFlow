/**
 * FLOW feed + attention service (MPP server) — multi-user (YouTube/Twitch-style).
 *
 *  - People watch clips (pay the creator per second) and post their own clips.
 *  - Companies run ad campaigns that pay viewers per second of proven attention.
 *  - The server settles every channel as the OPERATOR, so it can pay out to any
 *    creator/viewer wallet without holding their key.
 *
 * See docs/01-architecture.md and docs/09-api.md.
 */

import "./env.js"; // must be first — loads .env before config/shared
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { generate } from "mppx/discovery";
import { parseUnits, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { FLOW_CURRENCY, TOKEN_DECIMALS, TEMPO_CHAIN_ID, TEMPO_RPC_URL, PRICES, createWallet, fundWallet, pathUsdBalance, type Campaign } from "@flow/shared";
import { mppx, operatorAddress, settlementClient } from "./config.js";
import { tempoTestnet } from "@flow/shared";

/** Minimal ERC-20 transfer ABI for on-chain pathUSD refunds from the operator escrow. */
const ERC20_TRANSFER_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
import { initUsers, users, getUser, publicUser, reloadUsers } from "./users.js";
import {
  initContent,
  getClips,
  getCampaigns,
  getClip,
  getCampaign,
  addClip,
  setClipPrice,
  updateClipMeta,
  deleteClip,
  addCampaign,
} from "./content.js";
import * as ledger from "./ledger.js";
import { chargeForStreamingSeconds, creditAdReward, getAppBalance, getLedgerSnapshot, appCredit, appDebit } from "./app-ledger.js";
import { createTopupCheckoutSession, handleStripeWebhook, resolveTopupAmount, syncCheckoutSession } from "./stripe.js";
import { confirmWatchRange, quoteWatchRange } from "./dynamic-pricing.js";
import {
  userInsert, userUpdateProfile, type CampaignRow,
  followInsert, followRemove, isFollowing, followersOf, followingOf,
  followerCount, followingCount, followEarnings,
  goalInsert, goalById, goalsByCreator, goalSetStatus,
  pledgeInsert, pledgesForGoal, pledgeSetStatus, goalPledgedUsd, goalBackerCount, viewerPledgedUsd,
  campaignAddEscrow, campaignStop,
  clipLikeToggle, clipLikeCount, clipLikedBy, commentInsert, commentsForClip,
  chatInsert, chatForClip, clipIncViews, clipViews, videoPathOf,
  clipSecondWatchCounts,
  type GoalRow,
} from "./db.js";
import { runAd, isAdRunning } from "./adrunner.js";
import * as attention from "./attention.js";
import { runAuction } from "./auction.js";
import { streamAnswer, hasClaudeKey, charsToTokens } from "./ask.js";
import * as live from "./live.js";

const uploadsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../uploads");
const MIME: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogg: "video/ogg", m4v: "video/mp4" };
const IMG_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
const isRemoteVideo = (path: string) => /^https?:\/\//i.test(path);

/** Locate an ffmpeg binary: FFMPEG_PATH env, else the bundled `ffmpeg-static` if it's
 *  installed. Returns null if none is available (transcoding is then skipped). */
async function ffmpegBin(): Promise<string | null> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const spec = "ffmpeg-static"; const m: any = await import(spec); return (m?.default ?? m) || null; } catch { return null; }
}
/** Transcode `input` → a small, fast-start web MP4 at `outPath` (≤720p, H.264 CRF 28,
 *  AAC, +faststart). Returns true on success. ~30× smaller than typical phone uploads,
 *  which is the difference between instant playback and a multi-second stall over a
 *  tunnel. Falls back (returns false) if no ffmpeg is available. */
async function transcodeToWebMp4(input: string, outPath: string): Promise<boolean> {
  const bin = await ffmpegBin();
  if (!bin) return false;
  return await new Promise<boolean>((res) => {
    const p = spawn(bin, [
      "-y", "-i", input,
      "-vf", "scale=-2:'min(720,ih)'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart", outPath,
    ], { stdio: "ignore" });
    p.on("error", () => res(false));
    p.on("exit", (code) => res(code === 0));
  });
}

/** Persist an uploaded video file → returns its on-disk filename. Transcodes to a
 *  small fast-start web MP4 so it streams quickly (the raw upload is often 20–25 MB,
 *  which is painfully slow over a tunnel). Keeps the original if ffmpeg is unavailable. */
async function saveUploadedVideo(file: File): Promise<string> {
  mkdirSync(uploadsDir, { recursive: true });
  const ext = (file.name.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rawName = `${base}.${ext}`;
  const rawPath = join(uploadsDir, rawName);
  writeFileSync(rawPath, Buffer.from(await file.arrayBuffer()));
  const webName = `${base}.web.mp4`;
  const ok = await transcodeToWebMp4(rawPath, join(uploadsDir, webName)).catch(() => false);
  if (ok) { try { unlinkSync(rawPath); } catch { /* ignore */ } return webName; }
  return rawName; // ffmpeg unavailable → serve the original (still range-streamed + cached)
}

/** Persist an uploaded profile image → returns its on-disk filename (pfp-*). */
async function saveUploadedImage(file: File): Promise<string> {
  mkdirSync(uploadsDir, { recursive: true });
  let ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!IMG_MIME[ext]) ext = "png";
  const name = `pfp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  writeFileSync(join(uploadsDir, name), Buffer.from(await file.arrayBuffer()));
  return name;
}

/** Remaining funded budget for an ad (committed budget − already paid out). */
const campaignRemaining = (camp: CampaignRow) => +(Number(camp.maxBudget) - ledger.spentOn(camp.id)).toFixed(6);

/** Enrich an ad with funding status for the API. `spentUsd` is summed from the
 *  on-chain payout ledger and `maxBudget` is the on-chain escrowed budget, so
 *  remaining = refundable escrow. An ad can pay iff it has unspent escrow AND is
 *  not stopped. No app-ledger / demo balances — all figures are real on-chain. */
async function enrichCampaign(camp: CampaignRow): Promise<Campaign> {
  const spentUsd = ledger.spentOn(camp.id);
  const remainingUsd = +(Number(camp.maxBudget) - spentUsd).toFixed(6);
  const { videoPath, ...pub } = camp;
  return { ...pub, spentUsd, remainingUsd, funded: remainingUsd >= Number(camp.pricePerSec) && !camp.stopped };
}

const app = new Hono();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// MPP sends custom request headers (Accept-Payment, Payment, …) which trigger a
// CORS preflight. Rather than enumerate them, REFLECT whatever the client asks
// for — bulletproof against any mppx header. (DEV-M: "accept-payment not allowed")
const EXPOSE = "Payment-Receipt, WWW-Authenticate, Accept-Payment, Payment-Required";
app.use("*", async (c, next) => {
  const origin = c.req.header("origin") ?? "*";
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": c.req.header("access-control-request-headers") ?? "*",
        "Access-Control-Expose-Headers": EXPOSE,
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }
  await next();
  try {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Access-Control-Expose-Headers", EXPOSE);
    c.res.headers.set("Vary", "Origin");
  } catch {
    /* immutable (streamed) responses are handled by corsify() */
  }
});

/** mppx returns raw Response objects (402/SSE/204) whose headers we set directly. */
function corsify(origin: string | undefined, res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", origin ?? "*");
  res.headers.set("Access-Control-Expose-Headers", EXPOSE);
  res.headers.set("Vary", "Origin");
  return res;
}

/** Body-less request for management POSTs so mppx classifies them as management
 * (no spurious charge). See docs/06 DEV-I. */
function sessionRequest(c: any): Request {
  const raw = c.req.raw as Request;
  if (c.req.method !== "POST") return raw;
  const auth = c.req.header("authorization");
  return new Request(raw.url, { method: "POST", headers: auth ? { authorization: auth } : {} });
}

app.use("*", async (c, next) => {
  console.log(`[req] ${c.req.method} ${c.req.path}`);
  await next();
  console.log(`[req] ${c.req.method} ${c.req.path} -> ${c.res.status}`);
});

// ── Read endpoints ──────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ ok: true, service: "flow-server" }));
/** The wallet's REAL on-chain pathUSD balance — single source of truth for money. */
app.get("/onchain-balance", async (c) => {
  const user = getUser(c.req.query("as") ?? "");
  if (!user) return c.json({ error: "unknown user" }, 400);
  return c.json({ balance: await pathUsdBalance(user.address), currency: "pathUSD" });
});
/** The on-chain escrow address advertisers fund their ads into (the operator
 *  wallet). It pays viewers and refunds the unspent budget on stop. */
app.get("/escrow-address", (c) => c.json({ address: operatorAddress, balance: undefined }));
/** TESTNET ONLY: export the requesting user's own Tempo private key so they can
 *  take their wallet out of the app (import it into a Tempo wallet / explorer). The
 *  app holds testnet keys to auto-pay ads; this just hands the user back their own. */
app.get("/wallet/export", (c) => {
  const user = getUser(c.req.query("as") ?? "");
  if (!user) return c.json({ error: "unknown user" }, 400);
  if (!user.key) return c.json({ error: "no key on file for this account" }, 404);
  return c.json({ address: user.address, key: user.key });
});
app.get("/users", (c) => c.json({ users: users.map(publicUser) }));
/** TESTNET ONLY: keys for the local account switcher. */
app.get("/demo/users", (c) => c.json({ users }));
app.get("/feed", (c) => c.json({ clips: getClips() }));
app.get("/campaigns", async (c) => c.json({ campaigns: await Promise.all(getCampaigns().map(enrichCampaign)) }));
app.get("/net", (c) => {
  const as = c.req.query("as");
  const address = c.req.query("address") ?? (as ? getUser(as)?.address : undefined);
  return c.json(ledger.snapshot(address));
});
app.get("/api/balance", (c) => {
  const user = getUser(String(c.req.query("as") ?? ""));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json(getLedgerSnapshot(user.id));
});
app.post("/reset", (c) => {
  ledger.reset();
  return c.json({ ok: true });
});
/** Browser self-diagnostics sink (logs to server console so we can see what the
 *  browser can/can't reach). */
app.post("/debug", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  console.log("[browser-debug]", JSON.stringify(b));
  return c.json({ ok: true });
});

/**
 * JSON-RPC proxy. The browser routes ALL chain calls through here instead of
 * hitting the public Tempo RPC directly — this avoids browser CORS fragility and,
 * crucially, retries the public RPC's 429 rate-limits server-side (a throttled
 * 429 reaches the browser without CORS headers → "Failed to fetch"). (DEV-L)
 */
app.post("/rpc", async (c) => {
  const origin = c.req.header("origin");
  const body = await c.req.text();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(TEMPO_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (r.status === 429 || r.status === 503) {
        await sleep(200 * (attempt + 1) + Math.floor(Math.random() * 150));
        continue;
      }
      const text = await r.text();
      return corsify(origin, new Response(text, { status: r.status, headers: { "content-type": "application/json" } }));
    } catch {
      await sleep(200 * (attempt + 1));
    }
  }
  return corsify(origin, new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32005, message: "rpc proxy: rate-limited, try again" } }), { status: 200, headers: { "content-type": "application/json" } }));
});

// ── Test funds (faucet) + admin add-funds ───────────────────────────────────
app.post("/demo/fund", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const user = getUser(String(b?.userId ?? ""));
  if (!user) return c.json({ error: "unknown user" }, 400);
  // Credit the SPENDABLE app balance (this is what watch/tip/ask/pledge debit) — do
  // this first so funding always works even if the testnet faucet is slow/down.
  const { balance } = appCredit(user.id, 5, "demo_faucet");
  // Best-effort: also top up the real on-chain pathUSD wallet (so MPP channels +
  // on-chain settlement have funds). Never fail the request if the faucet hiccups.
  let tx: string | null = null;
  try { tx = await fundWallet(user.address, "5"); } catch { /* faucet busy — app credit still applied */ }
  return c.json({ ok: true, tx, balance });
});

app.post("/api/stripe/create-topup-checkout-session", async (c) => {
  try {
    const b = await c.req.json().catch(() => ({}));
    const user = getUser(String(b?.as ?? ""));
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const amount = resolveTopupAmount(b);
    const session = await createTopupCheckoutSession(user.id, amount);
    return c.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    const message = (e as Error).message;
    const status = message.includes("STRIPE_SECRET_KEY") ? 503 : 400;
    console.error("[stripe] create checkout failed:", message);
    return c.json({ error: message }, status as any);
  }
});

app.post("/api/stripe/sync-checkout-session", async (c) => {
  try {
    const b = await c.req.json().catch(() => ({}));
    const user = getUser(String(b?.as ?? ""));
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const sessionId = String(b?.sessionId ?? "");
    return c.json(await syncCheckoutSession(sessionId, user.id));
  } catch (e) {
    console.error("[stripe] sync checkout failed:", (e as Error).message);
    return c.json({ error: "checkout sync failed" }, 400);
  }
});

app.post("/api/stripe/webhook", async (c) => {
  try {
    const signature = c.req.header("stripe-signature");
    const rawBody = Buffer.from(await c.req.arrayBuffer());
    const result = await handleStripeWebhook(rawBody, signature);
    return c.json(result);
  } catch (e) {
    console.error("[stripe] webhook failed:", (e as Error).message);
    return c.json({ error: "webhook verification failed" }, 400);
  }
});
/** Register a connected Tempo account (login with your own wallet).
 *  Every connected wallet is FULL-ACCESS — it can watch, create + upload, launch
 *  ads, and earn from ads. Launching ads needs the app to pay viewers FROM the
 *  wallet automatically (a server-spawned payer), so the wallet's TESTNET key is
 *  stored server-side for that purpose. ⚠️ TESTNET ONLY — never a mainnet key. */
app.post("/users", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const providedAddress = String(b?.address ?? "");
  const generated = providedAddress ? undefined : createWallet();
  const address = providedAddress || generated!.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: "bad address" }, 400);
  // Idempotent login: the same wallet address ALWAYS maps to the same account, so
  // logging back in with your private key returns your original account (clips,
  // profile, balance) instead of creating a duplicate.
  const existing = users.find((u) => u.address.toLowerCase() === address.toLowerCase());
  if (existing) return c.json({ user: publicUser(existing) });
  const role = ["viewer", "creator", "advertiser", "admin"].includes(b?.role) ? b.role : "creator";
  // Derive a UNIQUE id from the handle so a duplicate handle never overwrites another
  // person's account (everyone can create their own user).
  const base = b?.handle ? `me-${String(b.handle).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32)}` : `me-${address.slice(2, 10).toLowerCase()}`;
  let id = base, n = 1;
  while (users.some((u) => u.id === id)) id = `${base}-${++n}`;
  // Store the key whenever a valid one is provided (enables wallet-funded ad payouts).
  const key = (typeof b?.key === "string" && /^0x[0-9a-fA-F]{64}$/.test(b.key)) ? b.key : (generated?.privateKey ?? "");
  const user = {
    id, name: String(b?.name ?? "My Account"), role: role as any, handle: String(b?.handle ?? `you-${address.slice(2, 6)}`), avatar: "🪪",
    address: address as `0x${string}`, key: key as `0x${string}`,
    internalWalletId: `iw_${id}`, tempoWalletId: address,
  };
  userInsert(user);
  reloadUsers();
  return c.json({ user: publicUser(user) });
});

/** App balance from confirmed internal ledger transactions. */
app.get("/balance", async (c) => {
  const as = c.req.query("as");
  const user = as ? getUser(as) : undefined;
  if (!user) return c.json({ error: "no user" }, 400);
  return c.json({ balance: getAppBalance(user.id), currency: "usd" });
});

/** Admin: list all users with live on-chain balances. */
app.get("/admin/users", async (c) => {
  const rows = users.map((u) => ({ ...publicUser(u), balance: getAppBalance(u.id) }));
  return c.json({ users: rows });
});

// ── Profiles + pay-to-follow (creator-platform) ──────────────────────────────
/** A creator/user profile: identity + bio + live on-chain balance + the
 *  super-follow graph (supporters + who they support) + their clips. */
app.get("/users/:id/profile", async (c) => {
  const user = getUser(c.req.param("id"));
  if (!user) return c.json({ error: "user not found" }, 404);
  const viewer = c.req.query("viewer");
  const supRows = followersOf(user.id);
  const folRows = followingOf(user.id);
  const supporters = supRows.map((f) => { const u = getUser(f.follower); return u ? { ...publicUser(u), amountUsd: f.amountUsd, since: f.createdAt } : null; }).filter(Boolean);
  const following = folRows.map((f) => { const u = getUser(f.creator); return u ? { ...publicUser(u), amountUsd: f.amountUsd, since: f.createdAt } : null; }).filter(Boolean);
  const balance = getAppBalance(user.id);
  return c.json({
    user: publicUser(user),
    balance,
    followerCount: followerCount(user.id),
    followingCount: followingCount(user.id),
    followEarnings: +followEarnings(user.id).toFixed(6),
    supporters,
    following,
    clips: getClips().filter((cl) => cl.ownerId === user.id),
    viewerFollows: viewer ? isFollowing(viewer, user.id) : false,
    goals: goalsByCreator(user.id).map((g) => enrichGoal(g, viewer)),
  });
});

/** Update your own profile (bio / symbol / display name / handle / follow price). */
app.post("/profile", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const id = String(b?.as ?? "");
  if (!getUser(id)) return c.json({ error: "unknown user" }, 400);
  const patch: any = {};
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 60);
  if (typeof b.handle === "string" && b.handle.trim()) patch.handle = b.handle.trim().replace(/^@/, "").slice(0, 40);
  if (typeof b.avatar === "string" && b.avatar.trim()) patch.avatar = [...b.avatar.trim()][0] ?? b.avatar.trim(); // first glyph
  if (typeof b.bio === "string") patch.bio = b.bio.slice(0, 280);
  if (b.followPrice != null && !Number.isNaN(Number(b.followPrice))) patch.followPrice = String(Math.max(0, Number(b.followPrice)));
  userUpdateProfile(id, patch);
  reloadUsers();
  return c.json({ user: publicUser(getUser(id)!) });
});

/** Upload a profile picture (multipart). Replaces the symbol as the avatar. */
app.post("/profile/pic", async (c) => {
  const body = await c.req.parseBody();
  const id = String(body.as ?? "");
  if (!getUser(id)) return c.json({ error: "unknown user" }, 400);
  const file = body.image as File | undefined;
  if (!file || typeof file === "string") return c.json({ error: "no image" }, 400);
  const pic = await saveUploadedImage(file);
  userUpdateProfile(id, { pic });
  reloadUsers();
  return c.json({ ok: true, pic, user: publicUser(getUser(id)!) });
});

/** Serve a user's uploaded profile picture (falls back to 404 → UI shows symbol). */
app.get("/pic/:id", (c) => {
  const user = getUser(c.req.param("id"));
  if (!user?.pic) return c.json({ error: "no pic" }, 404);
  const path = join(uploadsDir, user.pic);
  if (!existsSync(path)) return c.json({ error: "missing" }, 404);
  const ext = user.pic.split(".").pop()?.toLowerCase() ?? "png";
  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: { "Content-Type": IMG_MIME[ext] ?? "image/png", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": c.req.header("origin") ?? "*" },
  });
});

/** Record a super-follow. The on-chain pathUSD payment (follower → creator) is
 *  made by the BROWSER (it holds the follower's key); we just verify + record the
 *  bond here. amountUsd/txHash come from that transfer. */
app.post("/follow", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const follower = getUser(String(b?.follower ?? ""));
  const creator = getUser(String(b?.creator ?? ""));
  if (!follower || !creator) return c.json({ error: "unknown follower/creator" }, 400);
  if (follower.id === creator.id) return c.json({ error: "can't follow yourself" }, 400);
  followInsert({ follower: follower.id, creator: creator.id, amountUsd: String(b?.amountUsd ?? creator.followPrice ?? "0"), txHash: String(b?.txHash ?? ""), createdAt: Date.now() });
  return c.json({ ok: true, followerCount: followerCount(creator.id) });
});

/** Drop a super-follow (no refund — the payment already settled on-chain). */
app.post("/unfollow", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const follower = String(b?.follower ?? "");
  const creator = String(b?.creator ?? "");
  followRemove(follower, creator);
  return c.json({ ok: true, followerCount: followerCount(creator) });
});

// ── Creator content management (video upload) ───────────────────────────────
/** Sanitize a creator-supplied price ($/sec): finite, > 0, capped to a sane range. */
function normalizePrice(v: unknown): string | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return String(Math.min(1, Math.max(0.0001, +n.toFixed(6))));
}

app.post("/clips", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const as = String(body.as ?? "");
    if (!getUser(as)) return c.json({ error: "unknown user" }, 400);
    const file = body.video as File | undefined;
    let hasVideo = false;
    let videoPath: string | undefined;
    if (file && typeof file !== "string") {
      videoPath = await saveUploadedVideo(file);
      hasVideo = true;
    }
    const clip = addClip({
      ownerId: as,
      title: String(body.title ?? file?.name ?? "Untitled"),
      tags: String(body.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      durationSec: body.durationSec ? Number(body.durationSec) : undefined,
      pricePerSec: normalizePrice(body.pricePerSec),
      hasVideo,
      videoPath,
    });
    return c.json({ clip });
  }
  const b = await c.req.json().catch(() => ({}));
  if (!getUser(b?.as)) return c.json({ error: "unknown user" }, 400);
  const clip = addClip({
    ownerId: b.as,
    title: String(b.title ?? "Untitled"),
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    durationSec: b.durationSec ? Number(b.durationSec) : undefined,
    pricePerSec: normalizePrice(b.pricePerSec),
  });
  return c.json({ clip });
});

/** Re-price a clip — the OWNER can change what viewers pay per second, anytime. */
app.post("/clips/:id/price", async (c) => {
  const id = c.req.param("id");
  const clip = getClip(id);
  if (!clip) return c.json({ error: "clip not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (String(b?.as ?? "") !== clip.ownerId) return c.json({ error: "not your clip" }, 403);
  const price = normalizePrice(b?.pricePerSec);
  if (!price) return c.json({ error: "bad price" }, 400);
  return c.json({ clip: setClipPrice(id, price) });
});

/** Creator dashboard: edit a clip's title + tags (owner only). */
app.post("/clips/:id/edit", async (c) => {
  const id = c.req.param("id");
  const clip = getClip(id);
  if (!clip) return c.json({ error: "clip not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (String(b?.as ?? "") !== clip.ownerId) return c.json({ error: "not your clip" }, 403);
  const title = String(b?.title ?? clip.title).trim().slice(0, 140) || clip.title;
  const tags = Array.isArray(b?.tags) ? b.tags.map((t: any) => String(t).trim()).filter(Boolean)
    : String(b?.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return c.json({ clip: updateClipMeta(id, title, tags) });
});

/** Creator dashboard: delete a clip (owner only). Ends any live session + removes
 *  the uploaded video file. */
app.post("/clips/:id/delete", async (c) => {
  const id = c.req.param("id");
  const clip = getClip(id);
  if (!clip) return c.json({ error: "clip not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (String(b?.as ?? "") !== clip.ownerId) return c.json({ error: "not your clip" }, 403);
  if (clip.live) live.liveReset(id);
  const videoPath = deleteClip(id);
  if (videoPath && !isRemoteVideo(videoPath)) {
    try { unlinkSync(join(uploadsDir, videoPath)); } catch { /* file already gone */ }
  }
  return c.json({ ok: true, id });
});

// ── Social: likes, comments, views, live chat (regular streaming features) ───
/** Count a view (called once when a watch session starts). */
app.post("/clips/:id/view", (c) => {
  const id = c.req.param("id");
  if (!getClip(id)) return c.json({ error: "clip not found" }, 404);
  return c.json({ views: clipIncViews(id) });
});
/** Toggle the requesting user's like on a clip. */
app.post("/clips/:id/like", async (c) => {
  const id = c.req.param("id");
  if (!getClip(id)) return c.json({ error: "clip not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  const user = getUser(String(b?.as ?? ""));
  if (!user) return c.json({ error: "unknown user" }, 400);
  return c.json(clipLikeToggle(id, user.id));
});
/** Social snapshot for a clip's watch page: views, likes, whether the viewer liked
 *  it, and the comment thread. */
app.get("/clips/:id/social", (c) => {
  const id = c.req.param("id");
  if (!getClip(id)) return c.json({ error: "clip not found" }, 404);
  const viewer = c.req.query("viewer");
  return c.json({
    views: clipViews(id),
    likeCount: clipLikeCount(id),
    liked: clipLikedBy(id, viewer),
    comments: commentsForClip(id),
  });
});
app.get("/videos/:id/popularity", (c) => {
  const clip = getClip(c.req.param("id"));
  if (!clip) return c.json({ error: "clip not found" }, 404);
  const duration = Math.max(0, Math.floor(Number(clip.durationSec) || 0));
  const counts = clipSecondWatchCounts(clip.id, 0, duration);
  const popularity = Array.from({ length: duration }, (_, second) => ({
    second,
    watchCount: counts.get(second) ?? 0,
  }));
  return c.json({ videoId: clip.id, duration, popularity });
});
/** Post a comment on a clip. */
app.post("/clips/:id/comments", async (c) => {
  const id = c.req.param("id");
  if (!getClip(id)) return c.json({ error: "clip not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  const user = getUser(String(b?.as ?? ""));
  if (!user) return c.json({ error: "unknown user" }, 400);
  const body = String(b?.body ?? "").trim().slice(0, 600);
  if (!body) return c.json({ error: "empty comment" }, 400);
  return c.json({ comment: commentInsert(id, user.id, body) });
});
/** Live chat: fetch messages since a timestamp (poll), and post a message. */
app.get("/live/:id/chat", (c) => {
  const id = c.req.param("id");
  const since = Number(c.req.query("since") ?? 0) || 0;
  return c.json({ messages: chatForClip(id, since) });
});
app.post("/live/:id/chat", async (c) => {
  const id = c.req.param("id");
  const clip = getClip(id);
  if (!clip) return c.json({ error: "stream not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  const user = getUser(String(b?.as ?? ""));
  if (!user) return c.json({ error: "unknown user" }, 400);
  const body = String(b?.body ?? "").trim().slice(0, 300);
  if (!body) return c.json({ error: "empty message" }, 400);
  return c.json({ message: chatInsert(id, user.id, body) });
});

// ── Serve uploaded video (HTTP range streaming for <video>) — clips AND ads ──
// Perf: immutable cache (video for an id never changes → no re-download on reload/
// seek/re-open), chunk-capped range responses (first frames arrive fast and the
// tunnel isn't asked for the whole file at once), clamped range (a Content-Length ↔
// body mismatch otherwise stalls playback → "video won't load"), cheap path lookup.
const VIDEO_CACHE = "public, max-age=604800, immutable";
const VIDEO_CHUNK = 2 * 1024 * 1024; // 2 MB per range response
app.on(["GET", "HEAD"], "/video/:id", (c) => {
  const id = c.req.param("id");
  const videoPath = videoPathOf(id);
  if (!videoPath) return c.json({ error: "no video for this id" }, 404);
  const origin = c.req.header("origin") ?? "*";
  if (isRemoteVideo(videoPath)) return c.redirect(videoPath, 302);
  const path = join(uploadsDir, videoPath);
  if (!existsSync(path)) return c.json({ error: "file missing" }, 404);
  const total = statSync(path).size;
  const ext = videoPath.split(".").pop()?.toLowerCase() ?? "mp4";
  const ctype = MIME[ext] ?? "application/octet-stream";
  const base: Record<string, string> = {
    "Content-Type": ctype, "Accept-Ranges": "bytes", "Cache-Control": VIDEO_CACHE,
    "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
  };
  if (c.req.method === "HEAD") return new Response(null, { headers: { ...base, "Content-Length": String(total) } });
  const range = c.req.header("range");
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    let start = m ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : total - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end > total - 1) end = total - 1;
    if (start > end) start = 0;
    if (end - start + 1 > VIDEO_CHUNK) end = start + VIDEO_CHUNK - 1; // cap → fast first paint + paced over the tunnel
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(stream, { headers: { ...base, "Content-Length": String(total) } });
});
// ── Advertiser: create an ad (with uploaded video) + fund it ─────────────────
app.post("/campaigns", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const as = String(body.as ?? "");
    if (!getUser(as)) return c.json({ error: "unknown user" }, 400);
    const file = body.video as File | undefined;
    let hasVideo = false;
    let videoPath: string | undefined;
    if (file && typeof file !== "string") { videoPath = await saveUploadedVideo(file); hasVideo = true; }
    const campaign = addCampaign({
      ownerId: as,
      title: String(body.title ?? (typeof file !== "string" ? file?.name : "") ?? "Sponsored"),
      tags: String(body.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      pricePerSec: body.pricePerSec ? String(body.pricePerSec) : undefined,
      maxBudget: body.budget != null ? String(body.budget) : undefined,
      hasVideo, videoPath,
    });
    return c.json({ campaign });
  }
  const b = await c.req.json().catch(() => ({}));
  if (!getUser(b?.as)) return c.json({ error: "unknown user" }, 400);
  const campaign = addCampaign({
    ownerId: b.as,
    title: b.title,
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    pricePerSec: b.pricePerSec,
    maxBudget: b.maxBudget != null ? String(b.maxBudget) : undefined,
  });
  return c.json({ campaign });
});

/** Record an advertiser's ON-CHAIN escrow deposit into an ad's budget. The web app
 *  has ALREADY transferred `amountUsd` pathUSD from the advertiser's wallet to the
 *  platform escrow (the operator address, see GET /escrow-address) and passes the
 *  resulting `txHash`. Here we credit the committed budget and store that tx so the
 *  unspent remainder can be refunded on stop. Real money, escrowed on-chain. */
app.post("/campaigns/:id/fund", async (c) => {
  const id = c.req.param("id");
  const camp = getCampaign(id);
  if (!camp) return c.json({ error: "campaign not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (String(b?.as ?? "") !== camp.ownerId) return c.json({ error: "not your ad" }, 403);
  const addUsd = Number(b?.amountUsd);
  if (!Number.isFinite(addUsd) || addUsd <= 0) return c.json({ error: "amount must be > 0" }, 400);
  const escrowTx = typeof b?.txHash === "string" ? b.txHash : "";
  const newMax = (+(Number(camp.maxBudget) + addUsd).toFixed(6)).toString();
  campaignAddEscrow(id, newMax, escrowTx);
  console.log(`[escrow] ${camp.advertiser} funded ${id} +$${addUsd} → budget $${newMax} (tx ${escrowTx || "?"})`);
  const balance = await pathUsdBalance(operatorAddress); // escrow holdings
  return c.json({ ok: true, id, maxBudget: newMax, escrowTx, escrowBalance: balance });
});

/** Stop a campaign and REFUND the unspent escrow to the advertiser, ON-CHAIN. The
 *  operator (escrow holder) transfers the remaining budget (committed − spent) back
 *  to the advertiser's wallet, caps the budget at what was spent (so no further
 *  payouts can occur), and marks the campaign stopped. Real on-chain refund. */
app.post("/campaigns/:id/stop", async (c) => {
  const id = c.req.param("id");
  const camp = getCampaign(id);
  if (!camp) return c.json({ error: "campaign not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  if (String(b?.as ?? "") !== camp.ownerId) return c.json({ error: "not your ad" }, 403);
  const advertiser = getUser(camp.ownerId);
  const spent = +ledger.spentOn(id).toFixed(6);
  const refund = +(Number(camp.maxBudget) - spent).toFixed(6);
  let refundTx: string | null = null;
  if (refund > 0 && advertiser) {
    try {
      refundTx = await settlementClient.writeContract({
        address: FLOW_CURRENCY,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [advertiser.address, parseUnits(refund.toFixed(6), TOKEN_DECIMALS)],
        chain: tempoTestnet as any,
      });
      console.log(`[escrow] refunded $${refund} to ${advertiser.name} (${advertiser.address}) tx ${refundTx}`);
    } catch (e) {
      console.error(`[escrow] refund FAILED for ${id}:`, (e as Error).message);
      return c.json({ error: "refund failed: " + (e as Error).message }, 500);
    }
  }
  campaignStop(id, spent.toFixed(6), refundTx);
  return c.json({ ok: true, id, spentUsd: spent, refundedUsd: refund, refundTx });
});

// ── Attention proofing (gate input) ─────────────────────────────────────────
// Open a session → returns the token every heartbeat must carry (L3 binding).
// ── Server-driven ad payout (the autonomous agent pays the viewer) ───────────
// While the viewer's attention is VERIFIED (their heartbeats pass the gate), the
// operator pays them on behalf of the matched advertiser. We record each fresh second
// instantly (so earnings show live + the campaign budget/refund track) and batch-settle
// the accrued amount on-chain (operator → viewer) every few seconds. No spawned process
// → reliable. This replaces the fragile spawn-an-agent-per-watch path for earning.
interface Earning { campaignId: string; viewerId: string; viewerAddr: `0x${string}`; advertiser: string; viewerName: string; owedRaw: bigint; settledRaw: bigint; lastTs: number }
const earnings = new Map<string, Earning>();
const adReceipts = new Map<string, { txHash: string; amountUsd: number; ts: number }[]>(); // viewerId → settlement receipts
const eKey = (c: string, v: string) => `${c}:${v}`;

/** Accrue one fresh second of ad reward for (campaign, viewer): records it to the
 *  ledger (live + budget) and queues it for on-chain settlement. */
function accrueEarning(campaignId: string, viewerId: string) {
  const camp = getCampaign(campaignId); const viewer = getUser(viewerId);
  if (!camp || !viewer) return;
  if (campaignRemaining(camp) <= 0) return; // funded budget exhausted → stop paying
  const rate = attention.getRewardRate(campaignId, viewerId) ?? Number(camp.pricePerSec);
  const k = eKey(campaignId, viewerId);
  const now = Date.now();
  let e = earnings.get(k);
  if (!e) { earnings.set(k, { campaignId, viewerId, viewerAddr: viewer.address, advertiser: camp.advertiser, viewerName: viewer.name, owedRaw: 0n, settledRaw: 0n, lastTs: now }); return; }
  const elapsed = Math.min(2, (now - e.lastTs) / 1000); e.lastTs = now;
  const amt = +(rate * elapsed).toFixed(6);
  if (amt <= 0) return;
  ledger.record({ fromAddr: operatorAddress, toAddr: viewer.address, fromLabel: camp.advertiser, toLabel: viewer.name, amount: amt, contentId: campaignId });
  e.owedRaw += parseUnits(amt.toFixed(6), TOKEN_DECIMALS);
}

let settling = false;
/** Batch-settle accrued ad rewards on-chain (operator → viewer). minUsd=0 flushes. */
async function settleEarnings(minUsd = 0.003) {
  if (settling) return; settling = true;
  const min = parseUnits(minUsd.toFixed(6), TOKEN_DECIMALS);
  try {
    for (const e of earnings.values()) {
      const delta = e.owedRaw - e.settledRaw;
      if (delta <= 0n || delta < min) continue;
      e.settledRaw = e.owedRaw; // optimistic: avoid double-paying if the tx is slow
      try {
        const tx = await settlementClient.writeContract({ address: FLOW_CURRENCY, abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [e.viewerAddr, delta], chain: tempoTestnet as any });
        const list = adReceipts.get(e.viewerId) ?? []; list.unshift({ txHash: tx as string, amountUsd: Number(delta) / 10 ** TOKEN_DECIMALS, ts: Date.now() });
        adReceipts.set(e.viewerId, list.slice(0, 25));
        console.log(`[ad-payout] operator → ${e.viewerName} +${Number(delta) / 10 ** TOKEN_DECIMALS} pathUSD tx ${tx}`);
      } catch (err) { e.settledRaw -= delta; console.error("[ad-payout] settle failed:", (err as Error).message); }
    }
  } finally { settling = false; }
}
setInterval(() => { void settleEarnings(); }, 7000).unref?.();

/** Recent on-chain ad-payout receipts for a viewer (for receipt links in the UI). */
app.get("/agent/receipts", (c) => c.json({ receipts: adReceipts.get(c.req.query("as") ?? "") ?? [] }));

// ── Server-driven WATCH payout (viewer → creator) ────────────────────────────
// The browser just plays the video and pings /watch-tick each second; the server
// charges the viewer for that second (records live so the counter moves) and batch-
// settles on-chain by signing a transfer from the viewer's stored testnet key
// (custodial demo). Mirrors the ad payout → both directions are reliable + on-chain,
// no in-browser MPP channel that can stall.
interface WatchPay { clipId: string; viewerId: string; creatorAddr: `0x${string}`; viewerKey: `0x${string}`; viewerName: string; creatorName: string; owedRaw: bigint; settledRaw: bigint; lastTs: number }
const watchPays = new Map<string, WatchPay>();
const watchReceipts = new Map<string, { txHash: string; amountUsd: number; ts: number }[]>();
const wKey = (c: string, v: string) => `${c}:${v}`;

function accrueWatch(clipId: string, viewerId: string): number {
  const clip = getClip(clipId); const viewer = getUser(viewerId);
  if (!clip || !viewer || !viewer.key) return 0;
  const k = wKey(clipId, viewerId); const now = Date.now();
  let w = watchPays.get(k);
  if (!w) { watchPays.set(k, { clipId, viewerId, creatorAddr: clip.recipients[0]!.recipient, viewerKey: viewer.key, viewerName: viewer.name, creatorName: clip.creator, owedRaw: 0n, settledRaw: 0n, lastTs: now }); return 0; }
  const elapsed = Math.min(2, (now - w.lastTs) / 1000); w.lastTs = now;
  const amt = +(Number(clip.pricePerSec) * elapsed).toFixed(6);
  if (amt > 0) {
    ledger.record({ fromAddr: viewer.address, toAddr: w.creatorAddr, fromLabel: viewer.name, toLabel: clip.creator, amount: amt, contentId: clipId });
    w.owedRaw += parseUnits(amt.toFixed(6), TOKEN_DECIMALS);
  }
  return Number(w.owedRaw) / 10 ** TOKEN_DECIMALS;
}

let settlingW = false;
async function settleWatch(minUsd = 0.003) {
  if (settlingW) return; settlingW = true;
  const min = parseUnits(minUsd.toFixed(6), TOKEN_DECIMALS);
  try {
    for (const w of watchPays.values()) {
      const delta = w.owedRaw - w.settledRaw;
      if (delta <= 0n || delta < min) continue;
      w.settledRaw = w.owedRaw;
      try {
        const wallet = createWalletClient({ account: privateKeyToAccount(w.viewerKey), chain: tempoTestnet as any, transport: http(TEMPO_RPC_URL) });
        const tx = await wallet.writeContract({ address: FLOW_CURRENCY, abi: ERC20_TRANSFER_ABI, functionName: "transfer", args: [w.creatorAddr, delta], chain: tempoTestnet as any });
        const list = watchReceipts.get(w.viewerId) ?? []; list.unshift({ txHash: tx as string, amountUsd: Number(delta) / 10 ** TOKEN_DECIMALS, ts: Date.now() });
        watchReceipts.set(w.viewerId, list.slice(0, 25));
        console.log(`[watch-pay] ${w.viewerName} → ${w.creatorName} +${Number(delta) / 10 ** TOKEN_DECIMALS} pathUSD tx ${tx}`);
      } catch (err) { w.settledRaw -= delta; console.error("[watch-pay] settle failed:", (err as Error).message); }
    }
  } finally { settlingW = false; }
}
setInterval(() => { void settleWatch(); }, 7000).unref?.();

// Cheap, cached on-chain balance (so we don't hit the RPC every tick).
const balCache = new Map<string, { bal: number; ts: number }>();
async function viewerBalanceCached(id: string, addr: `0x${string}`): Promise<number> {
  const cached = balCache.get(id);
  if (cached && Date.now() - cached.ts < 4000) return cached.bal;
  const bal = await pathUsdBalance(addr).catch(() => cached?.bal ?? Number.MAX_SAFE_INTEGER);
  balCache.set(id, { bal, ts: Date.now() });
  return bal;
}
/** One watched second → charge the viewer for the creator. Returns the live spent. */
app.post("/watch-tick", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const clipId = String(b?.clipId ?? ""); const viewerId = String(b?.as ?? "");
  const clip = getClip(clipId); const viewer = getUser(viewerId);
  if (!clip || !viewer) return c.json({ ok: false }, 400);
  if (viewer.id === clip.ownerId) return c.json({ ok: true, free: true, spentUsd: 0 }); // creators preview free
  if (b?.visible === false) return c.json({ ok: true, paused: true });
  // Out of funds → the UI blurs the video + the agent's ad takes over (earn it back).
  if (await viewerBalanceCached(viewer.id, viewer.address) < Number(clip.pricePerSec)) return c.json({ ok: true, outOfFunds: true });
  const spentUsd = accrueWatch(clipId, viewerId);
  return c.json({ ok: true, spentUsd });
});
app.post("/watch-tick/stop", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const k = wKey(String(b?.clipId ?? ""), String(b?.as ?? ""));
  await settleWatch(0);
  watchPays.delete(k);
  return c.json({ ok: true });
});
app.get("/watch/receipts", (c) => c.json({ receipts: watchReceipts.get(c.req.query("as") ?? "") ?? [] }));

app.post("/attention/session", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = String(b?.campaignId ?? "");
  const viewer = String(b?.viewer ?? "");
  if (!getCampaign(campaignId) || !getUser(viewer)) return c.json({ error: "bad campaignId/viewer" }, 400);
  // rewardRate (optional): auction clearing price the viewer should EARN — overrides
  // the campaign's own rate for crediting. Only honored if it doesn't exceed the
  // campaign's bid (you can't earn more than the advertiser committed to pay).
  const camp = getCampaign(campaignId)!;
  const reward = Number(b?.rewardRate);
  const rewardRate = Number.isFinite(reward) && reward > 0 ? Math.min(reward, Number(camp.pricePerSec)) : undefined;
  return c.json(attention.openSession(campaignId, viewer, rewardRate));
});

// Heartbeat: carries the session token (L3) + live attention signals (L1). The
// response may hand back a CHALLENGE (L2) the client must render and answer.
app.post("/heartbeat", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = b?.campaignId ?? c.req.query("campaignId");
  const viewer = b?.viewer ?? c.req.query("viewer");
  if (!campaignId || !viewer) return c.json({ ok: false, reason: "no-session", challenge: null });
  const res = attention.heartbeat(String(campaignId), String(viewer), b?.token, {
    visible: b?.visible,
    playing: b?.playing,
    onScreen: b?.onScreen,
  });
  // Verified attention → the operator pays the viewer for this second (the agent's payout).
  if (res.ok && !res.paused) accrueEarning(String(campaignId), String(viewer));
  return c.json(res);
});

// Answer the outstanding challenge → payment resumes immediately.
app.post("/attention/answer", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = String(b?.campaignId ?? "");
  const viewer = String(b?.viewer ?? "");
  return c.json(attention.answer(campaignId, viewer, b?.token, String(b?.challengeId ?? "")));
});

/** Demo convenience: have the campaign's company pay this viewer in-browser
 *  (server acts as the advertiser). Gated by the viewer's heartbeats. */
app.post("/demo/run-ad", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = String(b?.campaignId ?? "");
  const viewerId = String(b?.viewerId ?? "");
  const campaign = getCampaign(campaignId);
  if (!campaign || !getUser(viewerId)) return c.json({ error: "bad campaignId/viewerId" }, 400);
  // No funding → no payout. Don't even spawn the payer for an unfunded ad.
  if (campaignRemaining(campaign) < Number(campaign.pricePerSec)) return c.json({ ok: false, reason: "unfunded" });
  if (!isAdRunning(campaignId, viewerId)) void runAd(campaignId, viewerId); // background
  return c.json({ ok: true, running: true });
});

// graceful-stop flags (shared by /watch and /attention)
const stopRequested = new Set<string>();
app.post("/watch/:id/stop", (c) => (stopRequested.add(c.req.param("id")), c.json({ ok: true })));
app.post("/attention/:campaignId/:viewerId/stop", async (c) => {
  const cid = c.req.param("campaignId"), vid = c.req.param("viewerId");
  stopRequested.add(`${cid}:${vid}`);
  await settleEarnings(0); // flush any accrued reward on-chain before clearing
  attention.endSession(cid, vid);
  earnings.delete(eKey(cid, vid));
  return c.json({ ok: true });
});

app.get("/api/watch/:id", async (c) => {
  const clip = getClip(c.req.param("id"));
  if (!clip) return c.json({ error: "not found" }, 404);
  const viewer = getUser(c.req.query("as") ?? "");
  if (!viewer) return c.json({ error: "unauthorized" }, 401);
  const origin = c.req.header("origin") ?? "*";
  stopRequested.delete(`app:${clip.id}:${viewer.id}`);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        let spentUsd = 0;
        for (let second = 1; second <= clip.durationSec; second++) {
          if (stopRequested.has(`app:${clip.id}:${viewer.id}`) || stopRequested.has(clip.id)) {
            stopRequested.delete(`app:${clip.id}:${viewer.id}`);
            stopRequested.delete(clip.id);
            controller.close();
            return;
          }
          const isOwner = viewer.id === clip.ownerId; // creators preview their own clips/streams free
          const startSecond = second - 1;
          const quote = quoteWatchRange(clip.id, startSecond, startSecond + 1, undefined, clip.durationSec);
          if (!isOwner) {
            const charged = await chargeForStreamingSeconds(viewer.id, quote.seconds, {
              clipId: clip.id,
              amount: quote.total,
              creatorId: clip.ownerId,
              startSecond: quote.startSecond,
              endSecond: quote.endSecond,
              pricedSeconds: quote.pricedSeconds,
            });
            if (!charged.ok) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: "out-of-balance", clipId: clip.id, reason: charged.reason, balance: charged.balance }) + "\n"));
              controller.close();
              return;
            }
            confirmWatchRange(clip.id, quote.startSecond, quote.endSecond, clip.durationSec);
            spentUsd = +(spentUsd + quote.total).toFixed(6);
            appCredit(clip.ownerId, quote.total, "watch_earning", { clipId: clip.id, viewerId: viewer.id, startSecond: quote.startSecond, endSecond: quote.endSecond }); // creator earns
            ledger.record({ fromAddr: viewer.address, toAddr: clip.recipients[0]!.recipient, fromLabel: viewer.name, toLabel: clip.creator, amount: quote.total, contentId: clip.id });
            if (clip.live) live.liveAddPaid(clip.id, quote.total);
          }
          if (clip.live && !isOwner) live.liveBeat(clip.id, viewer.id); // count paying viewers in the shared meter
          controller.enqueue(encoder.encode(JSON.stringify({ type: "tick", clipId: clip.id, second, priceUsd: isOwner ? 0 : quote.total, spentUsd, creator: clip.creator }) + "\n"));
          await sleep(1000);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache",
      "access-control-allow-origin": origin,
    },
  });
});

// ── Direction A: watch a creator clip (Viewer → Creator) ────────────────────
app.on(["GET", "POST"], "/watch/:id", async (c) => {
  const clip = getClip(c.req.param("id"));
  if (!clip) return c.json({ error: "not found" }, 404);
  const origin = c.req.header("origin");
  const creatorAddr = clip.recipients[0]!.recipient;

  const result = await mppx.session({
    amount: clip.pricePerSec,
    currency: FLOW_CURRENCY,
    decimals: TOKEN_DECIMALS,
    unitType: "second",
    chainId: TEMPO_CHAIN_ID,
    recipient: creatorAddr, // pay the clip's creator wallet
    operator: operatorAddress, // server settles on their behalf
    suggestedDeposit: "0.5",
  })(sessionRequest(c));

  if (result.status === 402) return corsify(origin, result.challenge);
  if (c.req.method === "POST") return corsify(origin, result.withReceipt(c.body(null, 204)));

  const viewer = getUser(c.req.query("as") ?? "");
  const fromAddr = viewer?.address ?? "0xviewer";
  const fromLabel = viewer?.name ?? "viewer";
  stopRequested.delete(clip.id);
  return corsify(
    origin,
    result.withReceipt(async function* (stream) {
      let spentUsd = 0;
      for (let second = 1; second <= clip.durationSec; second++) {
        if (stopRequested.has(clip.id)) {
          stopRequested.delete(clip.id);
          return;
        }
        // A LIVE stream only pays while the creator is present. If they've left
        // (host beats lapsed), the stream has ended — stop charging the viewer.
        if (clip.live && !live.hostPresent(clip.id)) return;
        const startSecond = second - 1;
        const quote = quoteWatchRange(clip.id, startSecond, startSecond + 1, undefined, clip.durationSec);
        await stream.charge(); // REAL on-chain pathUSD: viewer's channel → creator (operator-settled, refunded on close)
        confirmWatchRange(clip.id, quote.startSecond, quote.endSecond, clip.durationSec);
        spentUsd = +(spentUsd + quote.total).toFixed(6);
        ledger.record({ fromAddr, toAddr: creatorAddr, fromLabel, toLabel: clip.creator, amount: quote.total, contentId: clip.id });
        if (clip.live) { live.liveBeat(clip.id, viewer?.id ?? fromLabel); live.liveAddPaid(clip.id, quote.total); }
        yield JSON.stringify({ type: "tick", clipId: clip.id, second, priceUsd: quote.total, spentUsd, creator: clip.creator });
        await sleep(1000);
      }
    }),
  );
});

// ── Direction B: advertiser pays a viewer for proven attention ──────────────
app.on(["GET", "POST"], "/attention/:campaignId/:viewerId", async (c) => {
  const campaign = getCampaign(c.req.param("campaignId"));
  if (!campaign) return c.json({ error: "campaign not found" }, 404);
  // Viewer is in the PATH (not query) so it survives mppx's voucher-POST URL
  // (managementInput strips the query string). recipient must stay consistent.
  const viewer = getUser(c.req.param("viewerId"));
  if (!viewer) return c.json({ error: "viewer not found" }, 404);
  const origin = c.req.header("origin");
  const stopKey = `${campaign.id}:${viewer.id}`;

  const result = await mppx.session({
    amount: campaign.pricePerSec,
    currency: FLOW_CURRENCY,
    decimals: TOKEN_DECIMALS,
    unitType: "second",
    chainId: TEMPO_CHAIN_ID,
    recipient: viewer.address, // money flows IN to the viewer
    operator: operatorAddress,
    suggestedDeposit: "2", // escrow generously — one channel spans the whole watch
                           // (pauses/resumes across look-aways); unspent is refunded on close
  })(sessionRequest(c));

  if (result.status === 402) return corsify(origin, result.challenge);
  if (c.req.method === "POST") return corsify(origin, result.withReceipt(c.body(null, 204)));

  const company = getUser(campaign.ownerId);
  const fromAddr = company?.address ?? "0xadvertiser";
  stopRequested.delete(stopKey);
  const pricePerSec = Number(campaign.pricePerSec);
  // Auction win → the viewer EARNS the clearing (second) price; the advertiser still
  // pays their own bid into the channel, so the spread is the platform's.
  const rewardRate = attention.getRewardRate(campaign.id, viewer.id) ?? pricePerSec;
  const budget = Number(campaign.maxBudget);
  return corsify(
    origin,
    result.withReceipt(async function* (stream) {
      // ── Funding gate ──────────────────────────────────────────────────────
      // The ad pays the viewer FROM THE ADVERTISER'S WALLET. It can only pay if
      // (a) there's committed budget left, and (b) the advertiser wallet holds
      // enough pathUSD. Either failing → pay nothing (channel refunds in full).
      if (campaignRemaining(campaign) < rewardRate) {
        yield JSON.stringify({ type: "unfunded", campaignId: campaign.id, reason: "budget" });
        return;
      }
      const advBalance = company ? getAppBalance(company.id) : 0;
      if (advBalance < rewardRate) {
        yield JSON.stringify({ type: "unfunded", campaignId: campaign.id, reason: "wallet" });
        return;
      }

      let paid = 0;
      for (;;) {
        if (stopRequested.has(stopKey)) {
          stopRequested.delete(stopKey);
          attention.endSession(campaign.id, viewer.id);
          return; // explicit Stop → close channel → Tempo refunds unspent deposit
        }
        // Viewer truly LEFT (no heartbeats for a while). A look-away keeps beating,
        // so this stays open and resumes; only a real departure ends it here, which
        // closes the channel and refunds the advertiser's unspent deposit.
        if (attention.isGone(campaign.id, viewer.id)) {
          yield JSON.stringify({ type: "left", campaignId: campaign.id, paidUsd: paid });
          return;
        }
        // Cumulative funded-budget cap (shared across all viewers/sessions).
        if (campaignRemaining(campaign) < rewardRate) {
          yield JSON.stringify({ type: "budget-exhausted", campaignId: campaign.id, paidUsd: paid });
          return;
        }
        if (attention.isAttentionFresh(campaign.id, viewer.id)) {
          await stream.charge(); // pulls pathUSD from the advertiser's channel/wallet
          paid = +(paid + rewardRate).toFixed(6);
          await creditAdReward(viewer.id, 1, `${campaign.id}:${viewer.id}:${Math.floor(Date.now() / 1000)}`, { campaignId: campaign.id, rewardPerSecond: rewardRate, advertiserId: company?.id });
          ledger.record({ fromAddr, toAddr: viewer.address, fromLabel: campaign.advertiser, toLabel: viewer.name, amount: rewardRate, contentId: campaign.id });
          yield JSON.stringify({ type: "paid", campaignId: campaign.id, paidUsd: paid, remainingUsd: campaignRemaining(campaign), advertiser: campaign.advertiser, viewer: viewer.id });
        } else {
          // Present but looked away → keep the channel OPEN (no reopen cost), just
          // don't charge. Resumes the instant attention returns.
          yield JSON.stringify({ type: "paused", campaignId: campaign.id });
        }
        await sleep(1000);
      }
    }),
  );
});

// ── Feature 1: live tip "boost" (Viewer → Creator, on top of watchtime) ──────
app.post("/tip", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const viewer = getUser(String(b?.as ?? ""));
  const clip = getClip(String(b?.clipId ?? ""));
  if (!viewer || !clip) return c.json({ error: "bad as/clipId" }, 400);
  const amount = Math.min(1, Math.max(0, Number(b?.amountUsd)));
  if (!(amount > 0)) return c.json({ error: "bad amount" }, 400);
  const debit = appDebit(viewer.id, amount, "tip", { clipId: clip.id, creatorId: clip.ownerId });
  if (!debit.ok) return c.json({ ok: false, reason: "insufficient_balance", balance: debit.balance }, 200);
  appCredit(clip.ownerId, amount, "tip_earning", { clipId: clip.id, fromViewer: viewer.id });
  const creator = getUser(clip.ownerId);
  ledger.record({ fromAddr: viewer.address, toAddr: creator?.address ?? clip.recipients[0]!.recipient, fromLabel: viewer.name, toLabel: clip.creator, amount, contentId: clip.id });
  return c.json({ ok: true, balance: debit.balance, creator: clip.creator });
});

// ── Feature 2: real-time second-price attention auction ──────────────────────
app.post("/auction/run", async (c) => {
  const enriched = await Promise.all(getCampaigns().map(enrichCampaign));
  return c.json(runAuction(enriched));
});

// ── Autonomous interest-matching ad agent (DETERMINISTIC — no API key) ────────
// The agent's decision step: it reads what the viewer is into (the tags of the
// content they're watching) and the funded ad inventory, then picks the ad whose
// targeting best overlaps. The existing attention flow then settles the payout to
// the viewer on-chain. Pure policy (tag overlap + budget) → a real autonomous agent
// with NO LLM/API key required.
app.get("/agent/match-ad", async (c) => {
  const interest = String(c.req.query("tags") ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  const exclude = new Set(String(c.req.query("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const ads = (await Promise.all(getCampaigns().map(enrichCampaign))).filter((a) => a.funded && !exclude.has(a.id));
  if (!ads.length) return c.json({ match: null, reason: "no funded ads are bidding right now", interest });
  const scored = ads.map((a) => {
    const tags = (a.tags ?? []).map((t) => t.toLowerCase());
    const overlap = tags.filter((t) => interest.includes(t));
    return { ad: a, overlap, score: overlap.length };
  }).sort((x, y) => y.score - x.score || Number(y.ad.remainingUsd ?? 0) - Number(x.ad.remainingUsd ?? 0));
  const best = scored[0]!;
  const reason = best.score > 0
    ? `matched your interest in ${best.overlap.map((t) => "#" + t).join(" ")}`
    : "no exact interest match — picked the best-funded ad";
  return c.json({ match: best.ad, reason, matchedTags: best.overlap, interest });
});

// ── Feature 3: "Ask this creator's AI" — pay-per-token, split to the creator ──
app.post("/ask/:creatorId", async (c) => {
  const creator = getUser(c.req.param("creatorId"));
  const b = await c.req.json().catch(() => ({}));
  const viewer = getUser(String(b?.as ?? ""));
  const question = String(b?.question ?? "").slice(0, 500).trim();
  if (!creator || !viewer || !question) return c.json({ error: "bad creatorId/as/question" }, 400);
  const origin = c.req.header("origin") ?? "*";
  const price = Number(PRICES.askPerToken);
  const enc = new TextEncoder();
  const send = (ctrl: ReadableStreamDefaultController, o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));

  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        if (getAppBalance(viewer.id) < price) { send(ctrl, { type: "out-of-balance", balance: getAppBalance(viewer.id) }); ctrl.close(); return; }
        send(ctrl, { type: "start", via: hasClaudeKey() ? "claude" : "canned", pricePerToken: price, creator: creator.name });
        let chars = 0, billed = 0, costUsd = 0;
        for await (const chunk of streamAnswer(creator.name, creator.bio, question)) {
          chars += chunk.length;
          const due = charsToTokens(chars) - billed;
          if (due > 0) {
            const cost = +(due * price).toFixed(6);
            const debit = appDebit(viewer.id, cost, "ask", { creatorId: creator.id, tokens: due });
            if (!debit.ok) { send(ctrl, { type: "out-of-balance", tokens: billed, costUsd, balance: debit.balance }); ctrl.close(); return; }
            billed += due; costUsd = +(costUsd + cost).toFixed(6);
            appCredit(creator.id, cost, "ask_earning", { viewerId: viewer.id });
            ledger.record({ fromAddr: viewer.address, toAddr: creator.address, fromLabel: viewer.name, toLabel: creator.name, amount: cost, contentId: `ask:${creator.id}` });
          }
          send(ctrl, { type: "token", text: chunk });
        }
        send(ctrl, { type: "done", tokens: billed, costUsd, balance: getAppBalance(viewer.id) });
        ctrl.close();
      } catch (e) { try { send(ctrl, { type: "error", error: (e as Error).message }); } catch { /* closed */ } ctrl.close(); }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache", "access-control-allow-origin": origin } });
});

// ── Feature 5: go-live (simulated) — a looping source + shared audience meter ─
const LIVE_SOURCE = process.env.LIVE_SOURCE_URL ?? "https://media.w3.org/2010/05/bunny/trailer.mp4";
/** End a live stream: a live clip is EPHEMERAL (it loops a source while the creator
 *  is present), so ending it removes it from the feed entirely rather than leaving a
 *  dead "video". Clears the shared room too. */
function endLive(clipId: string) {
  live.liveReset(clipId);
  deleteClip(clipId);
}
app.post("/live/start", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const owner = getUser(String(b?.as ?? ""));
  if (!owner) return c.json({ error: "unknown user" }, 400);
  const tags = Array.isArray(b?.tags) ? b.tags : String(b?.tags ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!tags.includes("live")) tags.push("live");
  const clip = addClip({
    ownerId: owner.id, title: String(b?.title ?? `${owner.name} — LIVE`), tags,
    pricePerSec: normalizePrice(b?.pricePerSec), durationSec: 100000, // effectively endless
    hasVideo: true, videoPath: LIVE_SOURCE, thumb: "🔴", live: true,
  });
  live.liveReset(clip.id);
  live.hostBeat(clip.id); // creator is present from the moment they go live
  return c.json({ clip });
});
/** Host presence pulse — the creator's browser sends this every few seconds while
 *  they're in their own stream. The stream stays live only as long as these arrive. */
app.post("/live/:id/host-beat", async (c) => {
  const id = c.req.param("id");
  const clip = getClip(id);
  if (!clip) return c.json({ ok: false, live: false, ended: true });
  const b = await c.req.json().catch(() => ({}));
  if (String(b?.as ?? "") !== clip.ownerId) return c.json({ error: "not your stream" }, 403);
  live.hostBeat(id);
  return c.json({ ok: true, live: true });
});
app.post("/live/:id/stop", async (c) => {
  const id = c.req.param("id");
  const clip = getClip(id);
  const b = await c.req.json().catch(() => ({}));
  if (!clip) return c.json({ ok: true }); // already gone
  if (String(b?.as ?? "") !== clip.ownerId) return c.json({ error: "not your stream" }, 403);
  endLive(id);
  return c.json({ ok: true });
});
app.post("/live/:id/cheer", (c) => c.json({ applause: live.liveCheer(c.req.param("id")) }));
app.get("/live/:id/stats", (c) => {
  const clip = getClip(c.req.param("id"));
  // Stream gone (deleted) OR the creator has left → report ended so viewers stop.
  if (!clip || !clip.live) return c.json({ live: false, ended: true, viewers: 0, perSecUsd: 0, totalUsd: 0, applause: 0 });
  if (!live.hostPresent(clip.id)) {
    endLive(clip.id);
    return c.json({ live: false, ended: true, viewers: 0, perSecUsd: 0, totalUsd: 0, applause: 0 });
  }
  return c.json({ ...live.liveStats(clip.id, Number(clip.pricePerSec)), live: true });
});
// Background sweep: a live stream only exists while its host is present. End (remove)
// any live clip whose creator has left — even with no viewers polling — so stale live
// clips never linger (also clears leftovers after a server restart).
setInterval(() => {
  for (const clip of getClips()) {
    if (clip.live && !live.hostPresent(clip.id)) {
      console.log(`[live] ${clip.id} — host gone, ending stream`);
      endLive(clip.id);
    }
  }
}, 8000).unref?.();

// ── Feature 4: creator funding goals (crowdfund with escrow + refund) ─────────
/** Lazily resolve a goal: capture all escrowed pledges to the creator once the
 *  target is met, or refund them all once the deadline passes. */
function resolveGoal(g: GoalRow): GoalRow {
  if (g.status !== "active") return g;
  const pledged = goalPledgedUsd(g.id);
  if (pledged + 1e-9 >= Number(g.targetUsd)) {
    for (const p of pledgesForGoal(g.id)) {
      if (p.status !== "escrowed") continue;
      appCredit(g.creatorId, Number(p.amountUsd), "pledge_capture", { goalId: g.id, backerId: p.backerId });
      const backer = getUser(p.backerId); const creator = getUser(g.creatorId);
      if (backer && creator) ledger.record({ fromAddr: backer.address, toAddr: creator.address, fromLabel: backer.name, toLabel: creator.name, amount: Number(p.amountUsd), contentId: `goal:${g.id}` });
      pledgeSetStatus(p.id, "captured");
    }
    goalSetStatus(g.id, "funded");
    return { ...g, status: "funded" };
  }
  if (Date.now() > g.deadline) {
    for (const p of pledgesForGoal(g.id)) {
      if (p.status !== "escrowed") continue;
      appCredit(p.backerId, Number(p.amountUsd), "pledge_refund", { goalId: g.id }); // escrow returns to the backer
      pledgeSetStatus(p.id, "refunded");
    }
    goalSetStatus(g.id, "expired");
    return { ...g, status: "expired" };
  }
  return g;
}
function enrichGoal(g: GoalRow, viewerId?: string) {
  const r = resolveGoal(g);
  return { ...r, pledgedUsd: goalPledgedUsd(r.id), backers: goalBackerCount(r.id), viewerPledgedUsd: viewerId ? viewerPledgedUsd(r.id, viewerId) : 0 };
}
app.get("/goals", (c) => {
  const creator = c.req.query("creator");
  const viewer = c.req.query("viewer") ?? undefined;
  const rows = creator ? goalsByCreator(creator) : [];
  return c.json({ goals: rows.map((g) => enrichGoal(g, viewer)) });
});
app.post("/goals", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const owner = getUser(String(b?.as ?? ""));
  if (!owner) return c.json({ error: "unknown user" }, 400);
  const target = Math.max(0.01, Number(b?.targetUsd) || 0);
  const days = Math.max(0, Number(b?.days) || 0);
  // Demo-friendly: 0 days → a short minute-scale deadline so the refund path is showable.
  const ms = days > 0 ? days * 86_400_000 : Math.max(1, Number(b?.minutes) || 10) * 60_000;
  const g: GoalRow = { id: `goal-${owner.id}-${Date.now().toString(36)}`, creatorId: owner.id, creator: owner.name, title: String(b?.title ?? "Funding goal").slice(0, 120), targetUsd: String(+target.toFixed(6)), deadline: Date.now() + ms, status: "active", createdAt: Date.now() };
  goalInsert(g);
  return c.json({ goal: enrichGoal(g, owner.id) });
});
app.post("/goals/:id/pledge", async (c) => {
  const g = goalById(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const backer = getUser(String(b?.as ?? ""));
  if (!g || !backer) return c.json({ error: "bad goal/as" }, 400);
  const resolved = resolveGoal(g);
  if (resolved.status !== "active") return c.json({ ok: false, reason: resolved.status, goal: enrichGoal(resolved, backer.id) });
  const amount = Math.min(1000, Math.max(0, Number(b?.amountUsd)));
  if (!(amount > 0)) return c.json({ error: "bad amount" }, 400);
  const debit = appDebit(backer.id, amount, "pledge", { goalId: g.id }); // funds held in escrow
  if (!debit.ok) return c.json({ ok: false, reason: "insufficient_balance", balance: debit.balance });
  pledgeInsert({ id: `pl-${backer.id}-${Date.now().toString(36)}`, goalId: g.id, backerId: backer.id, amountUsd: String(amount), status: "escrowed", createdAt: Date.now() });
  return c.json({ ok: true, balance: debit.balance, goal: enrichGoal(g, backer.id) });
});

async function start() {
  await initUsers();
  initContent();

  // Discovery doc (after content exists). recipient is per-content, so omitted.
  const raw = (usd: string) => parseUnits(usd, TOKEN_DECIMALS).toString();
  const doc = generate(mppx as any, {
    info: { title: "FLOW", version: "0.2.0" },
    serviceInfo: { categories: ["media", "attention", "creator-economy"], docs: { homepage: "https://github.com/raglibol-re/TempoFlow" } } as any,
    routes: [
      { intent: "tempo/session", method: "get", path: "/watch/{contentId}", summary: "Watch a creator clip; viewer pays per second (recipient = that clip's creator).", options: { amount: raw(PRICES.creatorPerSecond), currency: FLOW_CURRENCY, decimals: TOKEN_DECIMALS, unitType: "second" } },
      { intent: "tempo/session", method: "get", path: "/attention/{campaignId}", summary: "Sell attention; advertiser pays the viewer (?to) per second (recipient = viewer).", options: { amount: raw(PRICES.attentionPerSecond), currency: FLOW_CURRENCY, decimals: TOKEN_DECIMALS, unitType: "second" } },
      { intent: "tempo/session", method: "post", path: "/ask/{creatorId}", summary: "Chat a creator's AI; viewer pays PER TOKEN, revenue split to the creator (recipient = creator).", options: { amount: raw(PRICES.askPerToken), currency: FLOW_CURRENCY, decimals: TOKEN_DECIMALS, unitType: "token" } },
    ],
  });
  app.get("/openapi.json", (c) => c.json(doc));

  // PORT is what most hosts inject (Render/Fly/Heroku); SERVER_PORT is our local
  // default. Bind 0.0.0.0 so the container is reachable from outside (not just
  // localhost) → the Vercel frontend can hit it from any device.
  const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 3000);
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  console.log(`[flow-server] listening on 0.0.0.0:${port} — ${users.length} users, ${getClips().length} clips`);
}

start();
