# FLOW

**A content feed where money flows in real time — _out_ to creators when you watch them,
_in_ from advertisers when you watch ads.** No subscriptions, no engagement-bait
algorithm, no ignored-impression ads. Built on **Tempo** via the **Machine Payments
Protocol (MPP)**.

> _Your attention to ads pays for your creator feed._

![money flow demo](docs/assets/flow.gif) <!-- TODO: capture a GIF of the running app -->

**Status:** Phases 1–5 working on Tempo testnet — both money directions live over MPP
payment channels, attention-gated ads, scrollable feed with collab splits, validated
`/openapi.json` discovery, two autonomous budgeted agents settling on-chain, and a
real-time money-flow UI. **TESTNET ONLY — never real funds.**

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

Open **http://localhost:5173** (a multi-user, YouTube/Twitch-style dashboard):
- **Account switcher** (top-right avatars): be any of the demo users — people (watch + post)
  or companies (run ads). Each has its own funded Tempo wallet; you pay/earn as them.
- **Home**: a multi-channel feed — **Watch** any clip → money streams **out** to *that*
  creator per second; **Skip** → settle on-chain + refund. Collab clips show a 70/20/10 split.
- **Studio**: post your own clip → it joins the feed and earns to your wallet.
- **Earn**: watch an ad → an advertiser pays **you** per second of attention; **Look away**
  and the payment pauses (heartbeat-gated).
- **Company** accounts: a campaigns view; viewers who watch your ad get paid by you.

> If the page ever shows a stale error after a code change, hard-refresh (Ctrl+Shift+R) —
> the dev server hot-reloads and old tabs can hold a dead connection. The app now reports
> the exact failing step rather than a generic "failed to fetch".

**Autonomous agents** (the leave-it-running wow):
```bash
pnpm agent:advertiser -- --budget 0.08    # pays viewers for proven attention
pnpm agent:curator    -- --budget 0.05    # pays creators, earns from ads, net-aware
```
Headless single-watch check: `pnpm --filter @flow/server spike`.
Validate discovery: `npx mppx discover validate http://localhost:3000/openapi.json`.

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

## What works (Definition of Done)

- ✅ Both money directions live over MPP sessions on Tempo testnet
- ✅ Skip / attention-loss stops payment instantly and refunds unused deposit
- ✅ Viewer net balance rises from ads, falls from creators — live
- ✅ Attention heartbeat gate prevents paying for ignored ads
- ✅ Curator + Advertiser agents run autonomously with spend controls + on-chain settle
- ✅ `/openapi.json` discovery present and valid (`mppx discover validate`)
- ✅ Receipts / live flow feed in the UI
- ⏭️ Remaining: Phase 6 demo hardening (seed/demo mode, reset, dress rehearsal)

Built for the MPP Hackathon (Tempo), 16–20 June 2026. **TESTNET ONLY.**
