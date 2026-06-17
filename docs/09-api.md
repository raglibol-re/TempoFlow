# 09 — API Reference

> Status: **scaffold** — filled in as endpoints land (Phases 1–3). Discovery doc at
> `GET /openapi.json` is the machine-readable source of truth.

## Endpoints

| Path | Method | Price / Intent | Recipient role | 402 behavior | Discovery |
|---|---|---|---|---|---|
| `/health` | GET | free | — | none | no |
| `/watch/:contentId` | GET (SSE) | `$0.002`/sec (`tempo` session) | **Creator** | 402 MPP challenge → session open → per-sec vouchers | yes (`x-payment-info`) |
| `/attention/:campaignId` | GET (SSE) | `$0.004`/sec (`tempo` session) | **Viewer** | 402 → session open → per-sec vouchers, **settled only while heartbeat valid** | yes (`x-payment-info`) |
| `/heartbeat` | POST | free | — | none (attention proof input) | no |
| `/feed` | GET | free | — | none | no |
| `/receipts/:wallet` | GET | free | — | none | no |
| `/openapi.json` | GET | free | — | none | self |

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
