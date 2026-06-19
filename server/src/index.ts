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
import { parseUnits } from "viem";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { FLOW_CURRENCY, TOKEN_DECIMALS, TEMPO_CHAIN_ID, TEMPO_RPC_URL, PRICES, createWallet, fundWallet, pathUsdBalance, type Campaign } from "@flow/shared";
import { mppx, operatorAddress } from "./config.js";
import { initUsers, users, getUser, publicUser, reloadUsers } from "./users.js";
import {
  initContent,
  getClips,
  getCampaigns,
  getClip,
  getCampaign,
  addClip,
  setClipPrice,
  addCampaign,
  fundCampaign,
} from "./content.js";
import * as ledger from "./ledger.js";
import { chargeForStreamingSeconds, creditAdReward, getAppBalance, getLedgerSnapshot } from "./app-ledger.js";
import { createTopupCheckoutSession, handleStripeWebhook, resolveTopupAmount, syncCheckoutSession } from "./stripe.js";
import {
  userInsert, userUpdateProfile, type CampaignRow,
  followInsert, followRemove, isFollowing, followersOf, followingOf,
  followerCount, followingCount, followEarnings,
} from "./db.js";
import { runAd, isAdRunning } from "./adrunner.js";
import * as attention from "./attention.js";

const uploadsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../uploads");
const MIME: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogg: "video/ogg", m4v: "video/mp4" };
const IMG_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
const isRemoteVideo = (path: string) => /^https?:\/\//i.test(path);

/** Persist an uploaded video file → returns its on-disk filename. */
async function saveUploadedVideo(file: File): Promise<string> {
  mkdirSync(uploadsDir, { recursive: true });
  const ext = (file.name.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  writeFileSync(join(uploadsDir, name), Buffer.from(await file.arrayBuffer()));
  return name;
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

/** Enrich an ad with funding status for the API (spent/remaining/funded + wallet). */
async function enrichCampaign(camp: CampaignRow): Promise<Campaign> {
  const spentUsd = ledger.spentOn(camp.id);
  const remainingUsd = +(Number(camp.maxBudget) - spentUsd).toFixed(6);
  const company = getUser(camp.ownerId);
  const advertiserBalance = company ? getAppBalance(company.id) : 0;
  const { videoPath, ...pub } = camp;
  return { ...pub, spentUsd, remainingUsd, advertiserBalance, funded: remainingUsd >= Number(camp.pricePerSec) };
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
  // Demo faucet: credit spendable APP balance (so you can watch without Stripe) AND
  // top up the on-chain pathUSD wallet (so MPP channels + payouts have real funds).
  const { balance } = creditDemoFunds(user.id, 5);
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
  const role = ["viewer", "creator", "advertiser", "admin"].includes(b?.role) ? b.role : "creator";
  const id = b?.handle ? `me-${String(b.handle).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32)}` : `me-${address.slice(2, 10).toLowerCase()}`;
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

// ── Serve uploaded video (HTTP range support for <video>) — clips AND ads ────
app.get("/video/:id", (c) => {
  const id = c.req.param("id");
  const item = (getClip(id) ?? getCampaign(id)) as any;
  if (!item?.videoPath) return c.json({ error: "no video for this id" }, 404);
  const clip = item;
  if (isRemoteVideo(clip.videoPath)) {
    return c.redirect(clip.videoPath, 302);
  }
  const path = join(uploadsDir, clip.videoPath);
  if (!existsSync(path)) return c.json({ error: "file missing" }, 404);
  const total = statSync(path).size;
  const ext = clip.videoPath.split(".").pop()?.toLowerCase() ?? "mp4";
  const ctype = MIME[ext] ?? "application/octet-stream";
  const origin = c.req.header("origin") ?? "*";
  const range = c.req.header("range");
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : total - 1;
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": ctype,
        "Access-Control-Allow-Origin": origin,
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: { "Content-Length": String(total), "Content-Type": ctype, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": origin },
  });
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

/** Fund an ad: faucet the advertiser's WALLET (so it can actually pay) AND raise
 *  the committed budget cap. One click = "this ad is now funded". */
app.post("/campaigns/:id/fund", async (c) => {
  const id = c.req.param("id");
  const camp = getCampaign(id);
  if (!camp) return c.json({ error: "campaign not found" }, 404);
  const b = await c.req.json().catch(() => ({}));
  const addUsd = Number(b?.amountUsd) > 0 ? Number(b.amountUsd) : 0.2;
  const company = getUser(camp.ownerId);
  const balance = company ? getAppBalance(company.id) : 0;
  const tx: string | undefined = undefined;
  const maxBudget = fundCampaign(id, addUsd);
  return c.json({ ok: true, id, maxBudget, balance, tx });
});

// ── Attention proofing (gate input) ─────────────────────────────────────────
// Open a session → returns the token every heartbeat must carry (L3 binding).
app.post("/attention/session", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = String(b?.campaignId ?? "");
  const viewer = String(b?.viewer ?? "");
  if (!getCampaign(campaignId) || !getUser(viewer)) return c.json({ error: "bad campaignId/viewer" }, 400);
  return c.json(attention.openSession(campaignId, viewer));
});

// Heartbeat: carries the session token (L3) + live attention signals (L1). The
// response may hand back a CHALLENGE (L2) the client must render and answer.
app.post("/heartbeat", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = b?.campaignId ?? c.req.query("campaignId");
  const viewer = b?.viewer ?? c.req.query("viewer");
  if (!campaignId || !viewer) return c.json({ ok: false, reason: "no-session", challenge: null });
  return c.json(
    attention.heartbeat(String(campaignId), String(viewer), b?.token, {
      visible: b?.visible,
      playing: b?.playing,
      onScreen: b?.onScreen,
    }),
  );
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
app.post("/attention/:campaignId/:viewerId/stop", (c) =>
  (stopRequested.add(`${c.req.param("campaignId")}:${c.req.param("viewerId")}`), c.json({ ok: true })),
);

app.get("/api/watch/:id", async (c) => {
  const clip = getClip(c.req.param("id"));
  if (!clip) return c.json({ error: "not found" }, 404);
  const viewer = getUser(c.req.query("as") ?? "");
  if (!viewer) return c.json({ error: "unauthorized" }, 401);
  const origin = c.req.header("origin") ?? "*";
  stopRequested.delete(`app:${clip.id}:${viewer.id}`);
  const pricePerSec = Number(clip.pricePerSec);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for (let second = 1; second <= clip.durationSec; second++) {
          if (stopRequested.has(`app:${clip.id}:${viewer.id}`) || stopRequested.has(clip.id)) {
            stopRequested.delete(`app:${clip.id}:${viewer.id}`);
            stopRequested.delete(clip.id);
            controller.close();
            return;
          }
          const charged = await chargeForStreamingSeconds(viewer.id, 1, { clipId: clip.id, pricePerSecond: pricePerSec, creatorId: clip.ownerId });
          if (!charged.ok) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "out-of-balance", clipId: clip.id, reason: charged.reason, balance: charged.balance }) + "\n"));
            controller.close();
            return;
          }
          ledger.record({ fromAddr: viewer.address, toAddr: clip.recipients[0]!.recipient, fromLabel: viewer.name, toLabel: clip.creator, amount: pricePerSec, contentId: clip.id });
          controller.enqueue(encoder.encode(JSON.stringify({ type: "tick", clipId: clip.id, second, spentUsd: +(second * pricePerSec).toFixed(6), creator: clip.creator }) + "\n"));
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
  const pricePerSec = Number(clip.pricePerSec);
  return corsify(
    origin,
    result.withReceipt(async function* (stream) {
      for (let second = 1; second <= clip.durationSec; second++) {
        if (stopRequested.has(clip.id)) {
          stopRequested.delete(clip.id);
          return;
        }
        if (viewer) {
          const charged = await chargeForStreamingSeconds(viewer.id, 1, { clipId: clip.id, pricePerSecond: pricePerSec, creatorId: clip.ownerId });
          if (!charged.ok) {
            yield JSON.stringify({ type: "out-of-balance", clipId: clip.id, reason: charged.reason, balance: charged.balance });
            return;
          }
        }
        await stream.charge();
        ledger.record({ fromAddr, toAddr: creatorAddr, fromLabel, toLabel: clip.creator, amount: pricePerSec, contentId: clip.id });
        yield JSON.stringify({ type: "tick", clipId: clip.id, second, spentUsd: +(second * pricePerSec).toFixed(6), creator: clip.creator });
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
  const budget = Number(campaign.maxBudget);
  return corsify(
    origin,
    result.withReceipt(async function* (stream) {
      // ── Funding gate ──────────────────────────────────────────────────────
      // The ad pays the viewer FROM THE ADVERTISER'S WALLET. It can only pay if
      // (a) there's committed budget left, and (b) the advertiser wallet holds
      // enough pathUSD. Either failing → pay nothing (channel refunds in full).
      if (campaignRemaining(campaign) < pricePerSec) {
        yield JSON.stringify({ type: "unfunded", campaignId: campaign.id, reason: "budget" });
        return;
      }
      const advBalance = company ? getAppBalance(company.id) : 0;
      if (advBalance < pricePerSec) {
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
        if (campaignRemaining(campaign) < pricePerSec) {
          yield JSON.stringify({ type: "budget-exhausted", campaignId: campaign.id, paidUsd: paid });
          return;
        }
        if (attention.isAttentionFresh(campaign.id, viewer.id)) {
          await stream.charge(); // pulls pathUSD from the advertiser's channel/wallet
          paid = +(paid + pricePerSec).toFixed(6);
          await creditAdReward(viewer.id, 1, `${campaign.id}:${viewer.id}:${Math.floor(Date.now() / 1000)}`, { campaignId: campaign.id, rewardPerSecond: pricePerSec, advertiserId: company?.id });
          ledger.record({ fromAddr, toAddr: viewer.address, fromLabel: campaign.advertiser, toLabel: viewer.name, amount: pricePerSec, contentId: campaign.id });
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
