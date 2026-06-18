/**
 * FLOW feed + attention service (MPP server).
 *
 * Phase 1: Direction A (Viewer → Creator) end-to-end.
 *   - GET /feed            list clips (free)
 *   - GET /watch/:id       per-second paid SSE session, recipient = creator
 *
 * Later phases add /attention/:campaignId (Direction B), /openapi.json, splits.
 * See docs/01-architecture.md and docs/09-api.md.
 */

import "./env.js"; // must be first — loads .env before config/shared
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  FLOW_CURRENCY,
  TOKEN_DECIMALS,
  TEMPO_CHAIN_ID,
  PRICES,
} from "@flow/shared";
import { generate } from "mppx/discovery";
import { parseUnits } from "viem";
import { mppx, viewerAddress, operatorAddress, creatorAccount } from "./config.js";
import { getClip, clips, getCampaign, campaigns } from "./seed.js";
import * as ledger from "./ledger.js";

const app = new Hono();

// Allow the Vite web app (and agents) to call the MPP server cross-origin,
// including the Payment credential + Payment-Receipt / WWW-Authenticate headers.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Add CORS headers to a raw Response. The global cors() middleware only decorates
 * Hono-native responses; mppx returns plain Response objects (402 challenge, SSE
 * stream, 204 ack) that otherwise reach the browser without Access-Control-* and
 * get blocked as "failed to fetch".
 */
function corsify(origin: string | undefined, res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", origin ?? "*");
  res.headers.set("Access-Control-Expose-Headers", "Payment-Receipt, WWW-Authenticate");
  res.headers.set("Vary", "Origin");
  return res;
}

/**
 * For management POSTs, forward a body-less request (Authorization only) so mppx
 * classifies it as session management (no spurious charge). See DEV-I in docs/06.
 */
function sessionRequest(c: any): Request {
  const raw = c.req.raw as Request;
  if (c.req.method !== "POST") return raw;
  const auth = c.req.header("authorization");
  return new Request(raw.url, {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

// Request logger (diagnostics for the voucher loop).
app.use("*", async (c, next) => {
  const t = Date.now();
  console.log(`[req] ${c.req.method} ${c.req.path}`);
  await next();
  console.log(`[req] ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - t}ms)`);
});

app.get("/health", (c) => c.json({ ok: true, service: "flow-server" }));

app.get("/feed", (c) => c.json({ clips }));

/**
 * Discovery doc — lets agents auto-find FLOW's paid endpoints + their payment
 * terms (x-payment-info) and service metadata (x-service-info).
 * Validate: `npx mppx discover validate http://localhost:3000/openapi.json`.
 */
const raw = (usd: string) => parseUnits(usd, TOKEN_DECIMALS).toString();
const openapiDoc = generate(mppx as any, {
  info: { title: "FLOW", version: "0.1.0" },
  serviceInfo: {
    categories: ["media", "attention", "creator-economy"],
    docs: { homepage: "https://github.com/raglibol-re/TempoFlow" },
  } as any,
  routes: [
    {
      intent: "tempo/session",
      method: "get",
      path: "/watch/{contentId}",
      summary: "Watch a creator clip; viewer pays per second (recipient = creator).",
      options: {
        amount: raw(PRICES.creatorPerSecond),
        currency: FLOW_CURRENCY,
        decimals: TOKEN_DECIMALS,
        unitType: "second",
        recipient: creatorAccount.address,
      },
    },
    {
      intent: "tempo/session",
      method: "get",
      path: "/attention/{campaignId}",
      summary: "Sell attention; advertiser pays the viewer per second (recipient = viewer).",
      options: {
        amount: raw(PRICES.attentionPerSecond),
        currency: FLOW_CURRENCY,
        decimals: TOKEN_DECIMALS,
        unitType: "second",
        recipient: viewerAddress,
      },
    },
  ],
});
app.get("/openapi.json", (c) => c.json(openapiDoc));

/**
 * Graceful stop: the viewer "scrolls away". We end the stream generator
 * NORMALLY (not via abort) so Sse.serve emits its final `payment-receipt`,
 * which syncs the client's cumulative to `spent` so close() can settle the
 * exact amount and refund the rest. (Abort would skip the receipt → DEV-I.)
 * Free endpoint (no payment). Keyed by clip id (one active viewer/clip in the demo).
 */
const stopRequested = new Set<string>();
app.post("/watch/:id/stop", (c) => {
  stopRequested.add(c.req.param("id"));
  return c.json({ ok: true });
});

/**
 * Direction A: stream a creator clip, charging the viewer pathUSD per second.
 * The viewer is the MPP client (paying); recipient = the clip's creator.
 */
// GET streams content; POST handles session management (channel open +
// mid-stream voucher top-ups) — mppx posts vouchers to the same path.
const SESSION_OPTS = {
  amount: PRICES.creatorPerSecond,
  currency: FLOW_CURRENCY,
  decimals: TOKEN_DECIMALS,
  unitType: "second",
  chainId: TEMPO_CHAIN_ID,
  suggestedDeposit: "0.5",
} as const;

app.on(["GET", "POST"], "/watch/:id", async (c) => {
  const id = c.req.param("id");
  const clip = getClip(id);
  if (!clip) return c.json({ error: "not found" }, 404);

  const origin = c.req.header("origin");

  // Gate the request: each tick = one second of watchtime, paid to the creator.
  const result = await mppx.session(SESSION_OPTS)(sessionRequest(c));

  // No / invalid credential → 402 challenge (price terms, recipient = creator).
  if (result.status === 402) return corsify(origin, result.challenge);

  // Management POST (open / voucher top-up) → 204 ack (carries Payment-Receipt).
  if (c.req.method === "POST") {
    return corsify(origin, result.withReceipt(c.body(null, 204)));
  }

  // GET → stream content, charging one tick per emitted second.
  stopRequested.delete(clip.id); // fresh watch
  const pricePerSec = Number(clip.pricePerSec);
  return corsify(
    origin,
    result.withReceipt(async function* (stream) {
      for (let second = 1; second <= clip.durationSec; second++) {
        // Graceful stop → return normally so the final receipt is emitted.
        if (stopRequested.has(clip.id)) {
          stopRequested.delete(clip.id);
          return;
        }
        await stream.charge(); // reserve + commit one tick (auto-pauses if balance low)
        ledger.addOut(pricePerSec, clip.creator, clip.id); // money OUT → creator
        yield JSON.stringify({
          type: "tick",
          clipId: clip.id,
          second,
          spentUsd: +(second * pricePerSec).toFixed(6),
          creator: clip.creator,
        });
        await sleep(1000);
      }
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Direction B — Advertising (Advertiser → Viewer, "money IN"), the reversal.
// The advertiser is the paying client; recipient = the viewer's wallet; the
// server account acts as channel operator so it can settle to the viewer.
// Payment is GATED by attention heartbeats: no fresh heartbeat → no charge.
// ─────────────────────────────────────────────────────────────────────────

const HEARTBEAT_TTL_MS = 2500; // attention considered lost ~2.5s after last beat
const lastHeartbeat = new Map<string, number>(); // campaignId → ts

function attentionFresh(campaignId: string): boolean {
  const ts = lastHeartbeat.get(campaignId);
  return ts != null && Date.now() - ts <= HEARTBEAT_TTL_MS;
}

app.get("/campaigns", (c) => c.json({ campaigns }));
app.get("/net", (c) => c.json(ledger.snapshot()));
app.post("/reset", (c) => {
  ledger.reset();
  return c.json({ ok: true });
});

/** Viewer attention heartbeat (tab visible + ad in viewport). Free endpoint. */
app.post("/heartbeat", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const campaignId = body?.campaignId ?? c.req.query("campaignId");
  if (campaignId) lastHeartbeat.set(campaignId, Date.now());
  return c.json({ ok: true, fresh: campaignId ? attentionFresh(campaignId) : false });
});

/** Advertiser signals the campaign is done (graceful stop → final receipt). */
app.post("/attention/:campaignId/stop", (c) => {
  stopRequested.add(c.req.param("campaignId"));
  return c.json({ ok: true });
});

app.on(["GET", "POST"], "/attention/:campaignId", async (c) => {
  const id = c.req.param("id") ?? c.req.param("campaignId");
  const campaign = getCampaign(id);
  if (!campaign) return c.json({ error: "not found" }, 404);

  const origin = c.req.header("origin");

  // Advertiser pays per second of PROVEN attention; recipient = the viewer.
  const result = await mppx.session({
    amount: campaign.pricePerSec,
    currency: FLOW_CURRENCY,
    decimals: TOKEN_DECIMALS,
    unitType: "second",
    chainId: TEMPO_CHAIN_ID,
    recipient: viewerAddress, // money flows IN to the viewer
    operator: operatorAddress, // server settles on the viewer's behalf
    suggestedDeposit: "0.5",
  })(sessionRequest(c));

  if (result.status === 402) return corsify(origin, result.challenge);
  if (c.req.method === "POST") {
    return corsify(origin, result.withReceipt(c.body(null, 204)));
  }

  stopRequested.delete(campaign.id);
  const pricePerSec = Number(campaign.pricePerSec);
  const maxBudget = Number(campaign.maxBudget);
  return corsify(
    origin,
    result.withReceipt(async function* (stream) {
      let paid = 0;
      for (;;) {
        if (stopRequested.has(campaign.id) || paid >= maxBudget) {
          stopRequested.delete(campaign.id);
          return; // graceful end → final receipt
        }
        if (attentionFresh(campaign.id)) {
          // Attention proven → advertiser pays the viewer for this second.
          await stream.charge();
          paid = +(paid + pricePerSec).toFixed(6);
          ledger.addIn(pricePerSec, campaign.advertiser, campaign.id); // money IN → viewer
          yield JSON.stringify({
            type: "paid",
            campaignId: campaign.id,
            paidUsd: paid,
            advertiser: campaign.advertiser,
          });
        } else {
          // Attention lost → DO NOT charge. Nobody pays for ignored ads.
          yield JSON.stringify({ type: "paused", campaignId: campaign.id });
        }
        await sleep(1000);
      }
    }),
  );
});

const port = Number(process.env.SERVER_PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`[flow-server] listening on http://localhost:${port}`);
