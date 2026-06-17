# 06 — Decision Records (ADRs)

Format: Decision · Alternatives · Rationale · Date. Includes every deviation from the
build prompt or from the MPP docs.

---

## ADR-001 — Monorepo via pnpm workspaces (not a single package)
- **Decision:** `shared` / `server` / `web` / `agent` as pnpm workspaces.
- **Alternatives:** single package with folders; Nx/Turbo.
- **Rationale:** matches the prompt's layout; clean dependency boundaries; `agent` and
  `web` both consume `mppx/client` + `@flow/shared` without duplication. Turbo/Nx is
  overkill for a 4-day build.
- **Date:** 2026-06-18

## ADR-002 — pathUSD as the single currency
- **Decision:** Use pathUSD (`0x20c0…0000`) for all channels rather than USDC.e.
- **Alternatives:** USDC.e.
- **Rationale:** docs present pathUSD as the canonical Tempo-testnet micropayment token
  in the session examples. One currency keeps net-balance math trivial.
- **Date:** 2026-06-18

## ADR-003 — Direction B implemented by role-swap (viewer = recipient)
- **Decision:** For "ads pay the viewer", the **advertiser is the MPP client** and the
  FLOW server runs an attention endpoint with **recipient = viewer wallet**.
- **Alternatives:** build a custom reverse-payment layer (forbidden by the prompt).
- **Rationale:** MPP is "client pays server"; swapping roles keeps us 100% on MPP/Tempo
  sessions, which is the whole point. The heartbeat gate enforces honesty.
- **Date:** 2026-06-18

## ADR-004 — Funding via master-transfer first, faucet fallback
- **Decision:** `fundWallet()` prefers a configured `FUNDING_MASTER_PRIVATE_KEY`
  (ERC-20 transfer of pathUSD), falling back to `TEMPO_FAUCET_URL`.
- **Rationale:** a master wallet is the most offline-resistant path for a demo room; the
  faucet may rate-limit or be slow in the critical path (prompt §1: no slow external deps).
- **Date:** 2026-06-18

---

## Open deviations / to-verify against live docs (do not lose track)

- **DEV-A:** `unitType: "second"` — docs example uses `"word"`. Per-second billing may
  require a manual interval + `charge()` loop instead of a generator yield. **Verify.**
- **DEV-B:** Per-second **splits** may not be supported on the session path (only on
  one-time `charge`). Fallback: settle to main creator per second, reconcile splits in
  app logic. **Verify before Phase 3.**
- **DEV-C:** Exact `stream.charge()` / voucher-needed event name unconfirmed from a single
  docs fetch. **Verify against installed `mppx` types.**
- **DEV-D:** `tempo.session.manager` (client) vs `tempo.session` (server method) — naming
  confirmed across two doc pages but must match the installed package.
- **DEV-E:** pathUSD decimals assumed 6 (USDC-style) in `wallet.ts` funding. **Verify.**
- **DEV-F:** RPC URL `https://rpc.testnet.tempo.xyz` is a placeholder. **Verify.**
