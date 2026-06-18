# 10 — Runbook

## Prerequisites

- Node ≥ 20 (repo built/tested on Node 22), `pnpm` (v10+).
- No faucet config needed: `pnpm wallets:setup` funds wallets via the Tempo testnet
  `tempo_fundAddress` RPC automatically. (`FUNDING_MASTER_PRIVATE_KEY` / `TEMPO_FAUCET_URL`
  remain as optional fallbacks.)

> ⚠️ **TESTNET ONLY.** Never put mainnet keys or real funds in `.env`.
> Network: chainId **42431**, RPC `https://rpc.moderato.tempo.xyz` (verified).

## 1. Install

```bash
pnpm install
```

## 2. Configure environment

```bash
cp .env.example .env
# Fill MPP_SECRET_KEY, TEMPO_RPC_URL (verify), TEMPO_FAUCET_URL or FUNDING_MASTER_PRIVATE_KEY
```

See [`.env.example`](../.env.example) for the full schema.

## 3. Create + fund role wallets

```bash
pnpm wallets:setup
# Generates VIEWER / CREATOR / ADVERTISER wallets, funds each via tempo_fundAddress,
# and WRITES .env at the repo root (incl. a random MPP_SECRET_KEY).
# If .env already exists it is NOT overwritten — it prints the lines to merge.
```

Step 2 (`cp .env.example .env`) is optional — `wallets:setup` writes a complete `.env`.
The escrow precompile pulls pathUSD without an ERC-20 approval, so no approval step is
needed (a `shared/src/scripts/approve-escrow.ts` helper exists but is not required).

## 4. Run

```bash
pnpm dev               # ONE COMMAND: server :3000 + web :5173 (concurrently)
```

Then open **http://localhost:5173** → click **Watch** (opens a payment channel; money
flows OUT to the creator per second) → **Skip** (graceful stop → settle on-chain + refund).

Individually if preferred:
```bash
pnpm dev:server        # FLOW server on :3000  (GET /health to check)
pnpm dev:web           # Viewer app on :5173
pnpm --filter @flow/server spike   # headless Direction-A test (watch 4s → close)
pnpm agent:curator     # Phase 4: autonomous curator agent
pnpm agent:advertiser  # Phase 4: autonomous advertiser agent
```

## 5. Verify

- `curl http://localhost:3000/health` → `{"ok":true}`
- `curl http://localhost:3000/openapi.json` (Phase 3) → discovery doc
- `npx mppx discover validate` (Phase 3) → validates the discovery doc
- `pnpm typecheck` → typechecks all workspaces

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `mppx` install fails | Pin exact version once known; check registry access. Log in 06-decisions. |
| Wallets not funded | Set `FUNDING_MASTER_PRIVATE_KEY` or `TEMPO_FAUCET_URL`; re-run `wallets:setup`. |
| 402 loops, never settles | Check `maxDeposit` > price/sec; verify recipient + currency match server config. |
| Refund not returned on close | Confirm `session.close()` is awaited; check channel had unspent deposit. |
| Ad keeps paying with tab hidden | Heartbeat gate misfiring — see Direction B in 01-architecture.md. |
| RPC errors | Verify `TEMPO_RPC_URL` / `TEMPO_CHAIN_ID` against MPP docs. |

## Demo mode (Phase 6)

- Pre-funded wallets committed to a local `.wallets/` (gitignored) so the room demo
  needs no live faucet.
- A **Reset** button restores seed feed + balances.
- Network fallback: see [07-demo-script.md](07-demo-script.md).
