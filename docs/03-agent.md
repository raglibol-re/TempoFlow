# 03 — Agents (Phase 4) ✅ BUILT

Two headless TypeScript agents on `mppx/client`, each with a spend policy and CLI flags.
They demonstrate Tempo's "agentic payments" story. **Verified autonomous on testnet**
(see [04-progress-log.md](04-progress-log.md)).

Code: [`agent/src/lib.ts`](../agent/src/lib.ts) (shared infra),
[`agent/src/curator.ts`](../agent/src/curator.ts), [`agent/src/advertiser.ts`](../agent/src/advertiser.ts).

## Shared infrastructure (`lib.ts`)

- **`SpendPolicy`** — `totalBudget` + `maxPerMinute` caps. `allows(amount)` checks both the
  total and a rolling 60s window before every charge; `record(amount)` tracks spend.
- **Structured logs** — JSONL to `agent/logs/<name>.jsonl` + console. Every payment logs
  `{direction, amount, counterparty, contentId}`; plus `info` and a final `summary`.
- **`discoverOffers()`** — fetches `/openapi.json` and parses `x-payment-info.offers` into
  `{path, amount, currency, recipient, intent}` so agents find endpoints + terms themselves.
- **`makeManager(key)`** — viem account + `sessionManager` (decimals 6, escrow precompile).
- **`runPaidStream({manager,url,stopUrl,onFrame,shouldStop})`** — opens the paid SSE
  session, drives it frame-by-frame, and on `shouldStop` does a graceful stop + cooperative
  close (settle + refund). One reusable driver for both directions.

## 4.1 Curator agent — pays creators, earns from ads

Uses the **viewer** wallet. `pnpm agent:curator -- --budget 0.05 --watch 6 --tags nature,music`

1. Discovers offers via `/openapi.json`; pulls inventory from `/feed` + `/campaigns`.
2. Ranks clips by tag preference; watches each (a **fresh channel per clip**) for `--watch`
   seconds, paying `$0.002/sec`, then closes (settle + refund).
3. Concurrently sends attention heartbeats so advertisers pay it (money IN).
4. Stops at `--budget` (creator spend cap) or Ctrl-C; prints a net summary.

> **Wow:** run it for hours — `agent/logs/curator.jsonl` is the "leave-it-running" proof of
> autonomous payments + earnings. Observed run: paid $0.03 to 4 clips, earned $0.06, net +$0.03.

## 4.2 Advertiser agent — pays viewers for proven attention

Uses the **advertiser** wallet. `pnpm agent:advertiser -- --budget 0.08 --tags fintech`

1. Discovers attention endpoints (recipient = viewer) via `/openapi.json`.
2. Picks a campaign (tag targeting), opens a session, pays `$0.004/sec` **only while the
   viewer's attention is fresh** (server gate) — `paused` frames cost nothing.
3. Stops at `--budget` or after `--idleStop` ms with no attention; closes (settle + refund).

> Observed run: paid the viewer $0.06 (15s of proven attention), stopped at budget, on-chain txHash.

## CLI / config reference

| Flag | Curator | Advertiser | Default |
|---|---|---|---|
| `--budget` | total USD paid to creators | total USD paid to viewers | 0.05 / 0.08 |
| `--maxPerMinute` | per-minute spend cap | per-minute spend cap | 0.05 / 0.1 |
| `--watch` | seconds watched per clip | — | 6 |
| `--tags` | preferred clip tags | targeting tags | (none) |
| `--idleStop` | — | ms of no-attention before stopping | 15000 |
| `--server` (env `SERVER_URL`) | FLOW server base URL | same | http://localhost:3000 |

Spend controls, structured logs, and headless CLI operation satisfy the §5 agent requirements.
