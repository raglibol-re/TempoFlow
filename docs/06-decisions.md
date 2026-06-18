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

## ADR-005 — Escrow = canonical precompile 0x4d50500…0000, not defaults.ts value
- **Decision:** Use the TIP-1034 escrow precompile `0x4d50500000000000000000000000000000000000`
  ("MPP" in ASCII) from mppx `Protocol.ts` for both client and server.
- **Why:** mppx `tempo/internal/defaults.ts` lists testnet escrow `0xe1c4d3…a336`, but
  `open()` against it **reverts** on moderato testnet (verified via `eth_call`). The
  canonical precompile returns a channelId. channelId is derived from the escrow address,
  so client + server MUST share the same one. **(was DEV-G)**
- **Date:** 2026-06-18

## ADR-006 — SSE sessions run with `sse: { poll: true }`
- **Decision:** Configure the tempo session method with `sse: { poll: true }`.
- **Why:** mid-stream voucher POSTs arrive in a different request context than the
  streaming GET. With the default `waitForUpdate` path this crashed ("reserved voucher
  coverage is no longer available"). `poll` makes the charge loop poll the store. **(DEV-H)**
- **Status:** crash fixed; voucher-loop still stalls after tick 1 — under investigation.
- **Date:** 2026-06-18

## ADR-007 — Funding via `tempo_fundAddress` RPC (no keychain)
- **Decision:** Fund testnet wallets by calling the unauthenticated `tempo_fundAddress`
  RPC method directly (in `shared/wallet.ts`).
- **Why:** the `mppx account` CLI uses an OS keychain that errors `Unsupported platform: win32`.
  The faucet underneath is just `tempo_fundAddress([addr])` — works from plain viem.
- **Date:** 2026-06-18

---

## Resolved deviations (verified against installed mppx@0.7.0)

- **DEV-A → RESOLVED:** `unitType` is a free string; `'second'` is accepted. Per-tick
  billing uses `withReceipt(async function*(stream){ await stream.charge(); yield … })`
  with a manual 1s sleep — no special time API.
- **DEV-B → RESOLVED (corrected):** splits live on `tempo.charge` and take **absolute
  per-split amounts** `{amount,recipient,memo?}` (sum < total), NOT percentages. Whether
  per-second session splits work is still open for Phase 3.
- **DEV-C → RESOLVED:** `stream.charge()` (SessionController) confirmed; depletion emits
  the SSE `payment-need-voucher` event.
- **DEV-D → RESOLVED:** client factory is `sessionManager(...)` (from `mppx/client`);
  server method is `tempo()` / `mppx.session(...)`.
- **DEV-E → RESOLVED:** pathUSD decimals = 6 (mppx `defaults.ts`).
- **DEV-F → RESOLVED:** RPC = `https://rpc.moderato.tempo.xyz` (chainId 42431, verified live).

## ADR-008 — Management POSTs forwarded body-less; graceful stop for close (DEV-I FIX)
- **Decision:** (a) For management POSTs to `/watch/:id`, forward a body-less request
  (Authorization header only) to `mppx.session()`. (b) Add a free `POST /watch/:id/stop`
  that flags the channel so the stream generator returns normally (emitting the final
  `payment-receipt`) instead of being aborted; the client then `close()`s.
- **Why:** (a) `@hono/node-server` gives empty POSTs a non-null body, so mppx's
  `shouldChargePlainResponse` mis-classified voucher top-ups as paid content and charged a
  spurious tick — `spent` raced to the voucher ceiling, zero headroom, stream hung.
  (b) `Sse.serve` only emits the receipt at generator *completion*; mid-stream the client's
  cumulative lagged `spent`, so `close()` signed below `spent` (402). Aborting skips the
  receipt. A graceful stop emits it, syncing the client so close settles the exact amount.
- **Evidence:** end-to-end run — $0.002→$0.008 streamed, close `spent 8000`, on-chain txHash,
  refund 0.492 pathUSD.
- **Date:** 2026-06-18

## Still open

- **DEV-B (carry):** per-second session splits vs one-time-charge-only — verify Phase 3.
- **DEV-J:** stop flag is keyed by clip id (one active viewer per clip in the demo). For
  multi-viewer, key by channelId/viewer. Fine for Phase 1 demo.
