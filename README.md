# FLOW

**A content feed where money flows in real time — _out_ to creators when you watch them,
_in_ from advertisers when you watch ads.** No subscriptions, no engagement-bait
algorithm, no ignored-impression ads. Built on **Tempo** via the **Machine Payments
Protocol (MPP)**.

> _Your attention to ads pays for your creator feed._

![money flow demo](docs/assets/flow.gif) <!-- TODO: add GIF in Phase 5 -->

## The reversal

| When you… | Money flows… | How |
|---|---|---|
| **Watch a creator** | **out**: you → creator, per second | Watchtime, not subscriptions. Scroll away = instant stop + refund. |
| **Watch an ad** | **in**: advertiser → you, per second | Ads pay *you* — but **only for proven attention** (heartbeat-gated). |

The attention you spend on ads finances the creators you watch — a potentially
self-sustaining feed.

## Why only on Tempo

Thousands of **sub-cent payments per second**, to **many recipients**, with **instant
settlement** and **refund of unused deposit**. On Ethereum/Solana the transaction fee
alone would dwarf a $0.002/sec micro-payment. FLOW streams off-chain **vouchers** over
**Tempo payment channels** and settles on-chain only at the end — the *only* substrate
where pay-per-second-of-attention is economically real.

## Quickstart

```bash
pnpm install
pnpm wallets:setup          # generate + fund testnet wallets, writes .env (TESTNET ONLY)
pnpm dev                    # ONE COMMAND → server :3000 + web :5173
```

Open **http://localhost:5173**, hit **Watch** (money streams out to the creator per
second), then **Skip** (settle on-chain + refund the unused deposit).

Headless check: `pnpm --filter @flow/server spike`. Agents (Phase 4):
`pnpm agent:curator`, `pnpm agent:advertiser`.

## Architecture

```
shared/  types, currency/chain constants, wallet helpers
server/  Hono + mppx: /watch (Viewer→Creator), /attention (Advertiser→Viewer), discovery
web/     Vite + React: feed, attention heartbeats, money-flow UI, receipts
agent/   headless agents: curator (pays creators, earns from ads), advertiser
```

Two money directions, both over MPP sessions on Tempo testnet. See
[docs/01-architecture.md](docs/01-architecture.md).

## Docs

- [00 Vision](docs/00-vision.md) · [01 Architecture](docs/01-architecture.md) ·
  [02 MPP Integration](docs/02-mpp-integration.md) · [03 Agents](docs/03-agent.md)
- [04 Progress Log](docs/04-progress-log.md) · [05 Milestones](docs/05-milestones.md) ·
  [06 Decisions](docs/06-decisions.md)
- [07 Demo Script](docs/07-demo-script.md) · [08 Pitch](docs/08-pitch.md) ·
  [09 API](docs/09-api.md) · [10 Runbook](docs/10-runbook.md)

## Status

Phase 0 (setup & context) complete. **TESTNET ONLY — never real funds.**
Built for the MPP Hackathon (Tempo), 16–20 June 2026.
