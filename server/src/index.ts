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
import { cors } from "hono/cors";
import { generate } from "mppx/discovery";
import { parseUnits } from "viem";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { FLOW_CURRENCY, TOKEN_DECIMALS, TEMPO_CHAIN_ID, PRICES, fundWallet, pathUsdBalance } from "@flow/shared";
import { mppx, operatorAddress } from "./config.js";
import { initUsers, users, getUser, publicUser } from "./users.js";
import {
  initContent,
  getClips,
  getCampaigns,
  getClip,
  getCampaign,
  addClip,
  addCampaign,
} from "./content.js";
import * as ledger from "./ledger.js";
import { runAd, isAdRunning } from "./adrunner.js";

const uploadsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../uploads");
const MIME: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogg: "video/ogg", m4v: "video/mp4" };

const app = new Hono();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

app.use(
  "*",
  cors({
    origin: (o) => o ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept"],
    exposeHeaders: ["Payment-Receipt", "WWW-Authenticate"],
    credentials: true,
  }),
);

/** mppx returns raw Response objects; the cors() middleware only decorates
 * Hono-native ones. Add CORS headers so the browser doesn't see "failed to fetch". */
function corsify(origin: string | undefined, res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", origin ?? "*");
  res.headers.set("Access-Control-Expose-Headers", "Payment-Receipt, WWW-Authenticate");
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
app.get("/feed", (c) => c.json({ clips }));
app.get("/campaigns", (c) => c.json({ campaigns }));
app.get("/net", (c) => {
  const as = c.req.query("as");
  const address = c.req.query("address") ?? (as ? getUser(as)?.address : undefined);
  return c.json(ledger.snapshot(address));
});
app.post("/reset", (c) => {
  ledger.reset();
  return c.json({ ok: true });
});

// ── Creator / company content management ────────────────────────────────────
app.post("/clips", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!getUser(b?.as)) return c.json({ error: "unknown user" }, 400);
  const clip = addClip({
    ownerId: b.as,
    title: String(b.title ?? "Untitled"),
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    durationSec: b.durationSec ? Number(b.durationSec) : undefined,
  });
  return c.json({ clip });
});
app.post("/campaigns", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!getUser(b?.as)) return c.json({ error: "unknown user" }, 400);
  const campaign = addCampaign({
    ownerId: b.as,
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    pricePerSec: b.pricePerSec,
    maxBudget: b.maxBudget,
  });
  return c.json({ campaign });
});

// ── Attention heartbeats (gate input) ───────────────────────────────────────
const HEARTBEAT_TTL_MS = 2500;
const lastHeartbeat = new Map<string, number>();
const hbKey = (campaignId: string, viewer?: string) => `${campaignId}:${viewer ?? "*"}`;
function attentionFresh(campaignId: string, viewer?: string): boolean {
  const ts = lastHeartbeat.get(hbKey(campaignId, viewer)) ?? lastHeartbeat.get(hbKey(campaignId));
  return ts != null && Date.now() - ts <= HEARTBEAT_TTL_MS;
}
app.post("/heartbeat", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = b?.campaignId ?? c.req.query("campaignId");
  const viewer = b?.viewer ?? c.req.query("viewer");
  if (campaignId) lastHeartbeat.set(hbKey(campaignId, viewer), Date.now());
  return c.json({ ok: true });
});

/** Demo convenience: have the campaign's company pay this viewer in-browser
 *  (server acts as the advertiser). Gated by the viewer's heartbeats. */
app.post("/demo/run-ad", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const campaignId = String(b?.campaignId ?? "");
  const viewerId = String(b?.viewerId ?? "");
  if (!getCampaign(campaignId) || !getUser(viewerId)) return c.json({ error: "bad campaignId/viewerId" }, 400);
  if (!isAdRunning(campaignId, viewerId)) void runAd(campaignId, viewerId); // background
  return c.json({ ok: true, running: true });
});

// graceful-stop flags (shared by /watch and /attention)
const stopRequested = new Set<string>();
app.post("/watch/:id/stop", (c) => (stopRequested.add(c.req.param("id")), c.json({ ok: true })));
app.post("/attention/:campaignId/:viewerId/stop", (c) =>
  (stopRequested.add(`${c.req.param("campaignId")}:${c.req.param("viewerId")}`), c.json({ ok: true })),
);

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
    suggestedDeposit: "0.5",
  })(sessionRequest(c));

  if (result.status === 402) return corsify(origin, result.challenge);
  if (c.req.method === "POST") return corsify(origin, result.withReceipt(c.body(null, 204)));

  const company = getUser(campaign.ownerId);
  const fromAddr = company?.address ?? "0xadvertiser";
  stopRequested.delete(stopKey);
  const pricePerSec = Number(campaign.pricePerSec);
  const maxBudget = Number(campaign.maxBudget);
  return corsify(
    origin,
    result.withReceipt(async function* (stream) {
      let paid = 0;
      for (;;) {
        if (stopRequested.has(stopKey) || paid >= maxBudget) {
          stopRequested.delete(stopKey);
          return;
        }
        if (attentionFresh(campaign.id, viewer.id)) {
          await stream.charge();
          paid = +(paid + pricePerSec).toFixed(6);
          ledger.record({ fromAddr, toAddr: viewer.address, fromLabel: campaign.advertiser, toLabel: viewer.name, amount: pricePerSec, contentId: campaign.id });
          yield JSON.stringify({ type: "paid", campaignId: campaign.id, paidUsd: paid, advertiser: campaign.advertiser, viewer: viewer.id });
        } else {
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

  const port = Number(process.env.SERVER_PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`[flow-server] listening on http://localhost:${port} — ${users.length} users, ${clips.length} clips`);
}

start();
