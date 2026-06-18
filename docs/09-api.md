# 09 — API Reference

> Status: **scaffold** — filled in as endpoints land (Phases 1–3). Discovery doc at
> `GET /openapi.json` is the machine-readable source of truth.

## Endpoints

| Path | Method | Price / Intent | Recipient role | 402 behavior | Discovery |
|---|---|---|---|---|---|
| `/health` | GET | free | — | none | no |
| `/watch/:contentId` | GET (SSE) + POST | `$0.002`/sec (`tempo` session) | **Creator** | 402 challenge → channel open → per-sec vouchers. GET streams; POST = voucher/open management (same path, forwarded body-less) | yes (`x-payment-info`) |
| `/watch/:contentId/stop` | POST | free | — | graceful stop: ends the stream so the final receipt is emitted (enables clean close + refund) | no |
| `/attention/:campaignId` | GET (SSE) + POST | `$0.004`/sec (`tempo` session) | **Viewer** | 402 → channel open (server = operator) → per-sec vouchers, **charged only while heartbeat is fresh (TTL 2.5s)**. GET streams `paid`/`paused` frames; POST = voucher management | yes (`x-payment-info`) |
| `/attention/:campaignId/stop` | POST | free | — | graceful stop (final receipt → clean close) | no |
| `/heartbeat` | POST | free | — | `{campaignId, viewer}` → marks that viewer's attention fresh (gate input) | no |
| `/feed` | GET | free | — | list clips (all channels) | no |
| `/campaigns` | GET | free | — | list ad campaigns | no |
| `/users` | GET | free | — | public user list (no keys) | no |
| `/demo/users` | GET | free | — | **TESTNET demo only**: users incl. keys (account switcher) | no |
| `/clips` | POST | free | — | `{as, title, tags, durationSec}` → creator posts a clip | no |
| `/campaigns` | POST | free | — | `{as, tags}` → company creates a campaign | no |
| `/demo/run-ad` | POST | free | — | `{campaignId, viewerId}` → spawns the advertiser agent to pay that viewer (in-browser ad demo) | no |
| `/net` | GET | free | — | `?as=<userId>` or `?address=` → that wallet's `{inUsd,outUsd,netUsd,events[]}` | no |
| `/reset` | POST | free | — | clear the in-memory net ledger (demo) | no |
| `/openapi.json` | GET | free | — | discovery doc (validated) | self |

**Multi-user model:** the server settles every channel as the **operator**, so it pays out
to any creator/viewer wallet. `/watch/:id?as=<viewerId>` pays the clip's creator; recipient
is that clip's owner. `/attention/:campaignId?to=<viewerId>` pays that viewer; the company
(campaign owner) is the payer.

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
