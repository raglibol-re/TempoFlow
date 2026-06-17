/**
 * FLOW feed + attention service (MPP server).
 *
 * Phase 0: placeholder bootstrap only. Endpoints land in later phases:
 *   - Phase 1: GET /watch/:contentId   (Viewer → Creator stream)
 *   - Phase 2: GET /attention/:campaignId (Advertiser → Viewer stream, heartbeat-gated)
 *   - Phase 3: GET /feed, GET /openapi.json (discovery), split payments
 *
 * See docs/01-architecture.md and docs/09-api.md.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "flow-server" }));

const port = Number(process.env.SERVER_PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`[flow-server] listening on http://localhost:${port}`);
