# 09 — API Reference

> Status: **scaffold** — filled in as endpoints land (Phases 1–3). Discovery doc at
> `GET /openapi.json` is the machine-readable source of truth.

## Endpoints

| Path | Method | Price / Intent | Recipient role | 402 behavior | Discovery |
|---|---|---|---|---|---|
| `/health` | GET | free | — | none | no |
| `/watch/:contentId` | GET (SSE) + POST | `$0.002`/sec (`tempo` session) | **Creator** | 402 challenge → channel open → per-sec vouchers. GET streams; POST = voucher/open management (same path, forwarded body-less) | yes (`x-payment-info`) |
| `/watch/:contentId/stop` | POST | free | — | graceful stop: ends the stream so the final receipt is emitted (enables clean close + refund) | no |
| `/attention/:campaignId/:viewerId` | GET (SSE) + POST | `$0.004`/sec (`tempo` session) | **Viewer** | 402 → channel open (server = operator, recipient = viewer in PATH so it survives voucher-POST query-strip) → per-sec vouchers, **charged only while the 3-layer attention proof is fresh (TTL 2.5s)** | yes (`x-payment-info`) |
| `/attention/:campaignId/:viewerId/stop` | POST | free | — | graceful stop (final receipt → clean close) | no |
| `/attention/session` | POST | free | — | `{campaignId, viewer}` → opens an attention session, returns `{token}`. Every heartbeat must carry this token (**Layer 3** binding) | no |
| `/heartbeat` | POST | free | — | `{campaignId, viewer, token, visible, playing, onScreen}` → records a heartbeat; only refreshes attention when signals pass (**L1**: `visible` + `onScreen`; `playing` advisory) + token matches (**L3**) + no challenge overdue (**L2**). Returns `{ok, paused, reason?, challenge}` | no |
| `/attention/answer` | POST | free | — | `{campaignId, viewer, token, challengeId}` → answers the outstanding **Layer 2** challenge; resumes payment immediately | no |
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

## Attention proof (3 layers)

See [docs/01-architecture.md](01-architecture.md#the-attention-proof-gate-core-of-the-honesty-thesis)
and [ADR-010](06-decisions.md). Implemented in [`server/src/attention.ts`](../server/src/attention.ts).

```jsonc
// 1. Open a session when the ad opens → token for all later heartbeats (Layer 3)
// POST /attention/session
{ "campaignId": "camp-tempo", "viewer": "alice" }
// → { "token": "9f3a…" }

// 2. Heartbeat every ~1s with the token + live signals (Layer 1)
// POST /heartbeat
{ "campaignId": "camp-tempo", "viewer": "alice", "token": "9f3a…",
  "visible": true, "playing": true, "onScreen": true }
// → { "ok": true, "paused": false,
//     "challenge": { "id": "a1b2…", "x": 62, "y": 38, "answerMs": 6000 } | null }
//   paused:true with reason "inattentive" | "challenge" | "bad-token" | "no-session"

// 3. When a challenge is returned, render the target at (x%, y%) and tap it (Layer 2)
// POST /attention/answer
{ "campaignId": "camp-tempo", "viewer": "alice", "token": "9f3a…", "challengeId": "a1b2…" }
// → { "ok": true }
```

A beat refreshes attention **only** when all three hold: signals are attentive (L1 —
`visible` + `onScreen`; `playing` is reported but not gated, to avoid a start-up
deadlock), the token matches the session (L3), and no issued challenge is past its
`answerMs` window (L2). `isAttentionFresh` (read by the `/attention` SSE payer) is true
while the last such beat is within the 2.5s TTL.

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
