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
| `/attention/session` *(updated)* | POST | free | — | now also accepts optional `rewardRate` — the auction **clearing price** the viewer should EARN (capped at the campaign's bid). Set by the auction flow | no |
| `/tip` | POST | free | — | **Feature 1.** `{as, clipId, amountUsd}` → debits viewer app credit, credits the creator, records a net flow. Called once/sec while "boost" is on, or one-shot | no |
| `/auction/run` | POST | free | — | **Feature 2.** `{viewer}` → runs a second-price (Vickrey) auction over funded campaigns → `{winner, clearingUsd, reserveUsd, bids[]}` | no |
| `/ask/:creatorId` | POST (NDJSON) | `$0.0008`/token | **Creator** | **Feature 3.** `{as, question}` → streams a Claude answer token-by-token; bills the viewer per token, splits to the creator. Lines: `{type:"start"\|"token"\|"done"\|"out-of-balance"\|"error", …}`. Falls back to a canned stream with no `ANTHROPIC_API_KEY` | yes (`x-payment-info`, `unitType:"token"`) |
| `/live/start` | POST | free | — | **Feature 5.** `{as, title, tags?, pricePerSec?}` → creates a LIVE clip (looping source); marks the creator present → `{clip}` | no |
| `/live/:id/host-beat` | POST | free | — | `{as}` (owner) → **creator presence pulse**. A stream stays live ONLY while these arrive (~5s cadence); if they lapse (>15s) the stream auto-ends | owner |
| `/live/:id/stop` | POST | free | — | `{as}` (owner) → ends the stream. A live clip is **ephemeral**: ending it removes it from the feed (not left as a dead video) | owner |
| `/live/:id/cheer` | POST | free | — | 👏 → `{applause}` (cumulative) | no |
| `/live/:id/stats` | GET | free | — | `{live, viewers, perSecUsd, totalUsd, applause, ended?}` — shared real-time audience meter. Auto-ends (and reports `ended:true`) once the creator has left | no |
| `/goals` | GET / POST | free | — | **Feature 4.** GET `?creator=&viewer=` → goals (lazily resolved). POST `{as, title, targetUsd, minutes?}` → create a funding goal | no |
| `/goals/:id/pledge` | POST | free | — | `{as, amountUsd}` → escrows the pledge (debits backer). Auto-captures to the creator when the target is met; auto-refunds all pledges if the deadline passes unmet | no |
| `/feed` | GET | free | — | list clips (all channels) | no |
| `/campaigns` | GET | free | — | list ad campaigns | no |
| `/users` | GET | free | — | public user list (no keys) — roles: viewer/creator/advertiser/admin | no |
| `/demo/users` | GET | free | — | **TESTNET demo only**: users incl. keys (login) | no |
| `/clips` | POST | free | — | JSON `{as,title,tags}` OR **multipart** (`as,title,tags,durationSec,video`=file) → creator posts/uploads a clip | no |
| `/clips/:id/edit` | POST | free | — | `{as, title, tags}` (owner) → edit a clip's title + tags (creator dashboard) → `{clip}` | owner |
| `/clips/:id/delete` | POST | free | — | `{as}` (owner) → delete a clip + its uploaded file (creator dashboard) → `{ok, id}` | owner |
| `/wallet/export` | GET | free | — | `?as=<userId>` → **TESTNET ONLY**: the user's own Tempo private key `{address, key}` so they can take their wallet out (import into a Tempo wallet/explorer) | self |
| `/video/:clipId` | GET | free | — | streams the uploaded video file with **HTTP range** support (for `<video>`) | no |
| `/demo/fund` | POST | free | — | `{userId}` → faucet test funds to that user's wallet (returns balance) | no |
| `/admin/users` | GET | free | — | all users + live on-chain pathUSD balances (admin dashboard) | no |
| `/campaigns` | POST | free | — | `{as, tags}` (or multipart `as,title,tags,video,budget`) → company creates a campaign; **starts UNFUNDED** (`maxBudget=0`) until escrowed | no |
| `/escrow-address` | GET | free | — | the platform **escrow/vault address** (the operator wallet) advertisers deposit pathUSD into to fund ads → `{address}` | no |
| `/campaigns/:id/fund` | POST | free | — | **records an on-chain escrow deposit**: `{as, amountUsd, txHash}` — the client has already transferred `amountUsd` pathUSD from the advertiser's wallet to the escrow address; raises the committed budget + stores `escrowTx` → `{maxBudget, escrowTx}` | owner |
| `/campaigns/:id/stop` | POST | free | — | **stops + refunds**: `{as}` → operator transfers the **unspent escrow** (committed − spent) back to the advertiser **on-chain**, caps budget at spent, marks stopped → `{spentUsd, refundedUsd, refundTx}` | owner |
| `/demo/run-ad` | POST | free | — | `{campaignId, viewerId}` → spawns the advertiser agent to pay that viewer **from the escrow** (in-browser ad demo) | no |
| `/onchain-balance` | GET | free | — | `?as=<userId>` or `?address=` → that wallet's **real on-chain pathUSD balance** (the source of truth for all displayed balances) → `{balance, currency:"pathUSD"}` | no |
| `/net` | GET | free | — | `?as=<userId>` or `?address=` → that wallet's `{inUsd,outUsd,netUsd,events[]}` | no |
| `/reset` | POST | free | — | clear the in-memory net ledger (demo) | no |
| `/openapi.json` | GET | free | — | discovery doc (validated) | self |

**Multi-user model:** persistence is local **SQLite** (`node:sqlite`, `server/flow.db`) — no
Supabase. Roles: viewer/creator/advertiser/admin. The server settles every channel as the
**operator**, so it pays out to any creator/viewer wallet. `/watch/:id?as=<viewerId>` pays the
clip's creator; `/attention/:campaignId/:viewerId` pays that viewer (company = payer). Uploaded

**Advertiser escrow (real on-chain):** the **operator wallet doubles as the ad escrow/vault**
(`/escrow-address`). To fund an ad, the advertiser's browser transfers pathUSD to that address
on-chain, then `POST /campaigns/:id/fund` records the deposit (raising the committed budget). The
ad pays viewers from the escrow per proven second (`adrunner` spawns the advertiser agent with
`--escrow`, paying as the operator). `POST /campaigns/:id/stop` refunds the **unspent** budget
(committed − spent) operator→advertiser **on-chain** and caps the budget at what was spent, so no
further payouts can occur. All three legs — deposit, payout, refund — are real Tempo transactions.

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
