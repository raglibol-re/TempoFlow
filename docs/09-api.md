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
| `/heartbeat` | POST | free | — | `{campaignId}` → marks attention fresh (gate input) | no |
| `/feed` | GET | free | — | list clips | no |
| `/campaigns` | GET | free | — | list ad campaigns | no |
| `/net` | GET | free | — | viewer net balance `{inUsd,outUsd,netUsd,events[]}` | no |
| `/reset` | POST | free | — | clear the in-memory net ledger (demo) | no |
| `/openapi.json` | GET | free | — | discovery (Phase 3) | self |

## Heartbeat payload
```jsonc
// POST /heartbeat
{ "viewer": "0x…", "campaignId": "c1", "visible": true, "inViewport": true, "ts": 1750000000000 }
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
