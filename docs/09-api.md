# 09 — API Reference

> Status: **scaffold** — filled in as endpoints land (Phases 1–3). Discovery doc at
> `GET /openapi.json` is the machine-readable source of truth.

## Endpoints

| Path | Method | Price / Intent | Recipient role | 402 behavior | Discovery |
|---|---|---|---|---|---|
| `/health` | GET | free | — | none | no |
| `/watch/:contentId` | GET (SSE) + POST | `$0.002`/sec (`tempo` session) | **Creator** | 402 challenge → channel open → per-sec vouchers. GET streams; POST = voucher/open management (same path, forwarded body-less) | yes (`x-payment-info`) |
| `/watch/:contentId/stop` | POST | free | — | graceful stop: ends the stream so the final receipt is emitted (enables clean close + refund) | no |
| `/attention/:campaignId/:viewerId` | GET (SSE) + POST | `$0.004`/sec (`tempo` session) | **Viewer** | 402 → channel open (server = operator, recipient = viewer in PATH so it survives voucher-POST query-strip) → per-sec vouchers, **charged only while heartbeat is fresh (TTL 2.5s)** | yes (`x-payment-info`) |
| `/attention/:campaignId/:viewerId/stop` | POST | free | — | graceful stop (final receipt → clean close) | no |
| `/heartbeat` | POST | free | — | `{campaignId, viewer}` → marks that viewer's attention fresh (gate input) | no |
| `/feed` | GET | free | — | list clips (all channels) | no |
| `/campaigns` | GET | free | — | list ad campaigns | no |
| `/users` | GET | free | — | public user list (no keys) — roles: viewer/creator/advertiser/admin | no |
| `/demo/users` | GET | free | — | **TESTNET demo only**: users incl. keys (login) | no |
| `/clips` | POST | free | — | JSON `{as,title,tags}` OR **multipart** (`as,title,tags,durationSec,video`=file) → creator posts/uploads a clip | no |
| `/video/:clipId` | GET | free | — | streams the uploaded video file with **HTTP range** support (for `<video>`) | no |
| `/demo/fund` | POST | free | — | `{userId}` → faucet test funds to that user's wallet (returns balance) | no |
| `/admin/users` | GET | free | — | all users + live on-chain pathUSD balances (admin dashboard) | no |
| `/campaigns` | POST | free | — | `{as, tags}` → company creates a campaign | no |
| `/demo/run-ad` | POST | free | — | `{campaignId, viewerId}` → spawns the advertiser agent to pay that viewer (in-browser ad demo) | no |
| `/net` | GET | free | — | `?as=<userId>` or `?address=` → that wallet's `{inUsd,outUsd,netUsd,events[]}` | no |
| `/reset` | POST | free | — | clear the in-memory net ledger (demo) | no |
| `/openapi.json` | GET | free | — | discovery doc (validated) | self |

**Multi-user model:** persistence is local **SQLite** (`node:sqlite`, `server/flow.db`) — no
Supabase. Roles: viewer/creator/advertiser/admin. The server settles every channel as the
**operator**, so it pays out to any creator/viewer wallet. `/watch/:id?as=<viewerId>` pays the
clip's creator; `/attention/:campaignId/:viewerId` pays that viewer (company = payer). Uploaded
videos are stored on disk (`server/uploads/`) + path in SQLite, served at `/video/:clipId`.
The web `<video>` is **payment-gated**: it pauses if the per-second payment stops. The
Home tab has a **"Low-funds demo"** toggle that caps the channel (`maxDeposit≈0.012`) so
payment runs out after ~6s — the video then stops with an "out of funds" overlay, making
the funding↔playback link one-click visible.

## Heartbeat payload
```jsonc
// POST /heartbeat
{ "viewer": "alice", "campaignId": "camp-tempo", "visible": true, "inViewport": true, "ts": 1750000000000 }
```

## Discovery doc shape (target)
```jsonc
{
  "paths": {
    "/watch/{contentId}": { "x-payment-info": { "offers": [
      { "currency": "0x20c0…0000", "amount": "0.002", "unitType": "second", "recipientRole": "creator" }
    ]}},
    "/attention/{campaignId}": { "x-payment-info": { "offers": [
      { "currency": "0x20c0…0000", "amount": "0.004", "unitType": "second", "recipientRole": "viewer" }
    ]}}
  },
  "x-service-info": { "name": "FLOW", "version": "0.1.0" }
}
```
