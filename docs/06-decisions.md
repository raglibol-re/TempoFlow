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

- **DEV-B → RESOLVED (with limitation):** mppx 0.7.0 supports `splits` only on the
  one-time `tempo.charge` path, NOT on the per-second `tempo.session` path (the session
  request schema has no `splits`). **Decision:** collab clips settle their channel to the
  primary creator on-chain and the UI displays the intended 70/20/10 split + per-recipient
  breakdown of what was paid. A real on-chain per-second split would need either mppx
  session-split support or N parallel channels (one per collaborator). Documented as a
  known demo limitation. (ADR-009)
- **DEV-J:** stop flag is keyed by clip id (one active viewer per clip in the demo). For
  multi-viewer, key by channelId/viewer. Fine for Phase 1 demo.

---

## ADR-010 — Three-layer attention proof (not a bare heartbeat)
- **Decision:** Gate advertiser payment on a layered proof in `server/src/attention.ts`
  instead of an unconditional heartbeat: **L1** passive signals — beats only count while
  `visible` + `onScreen` (the client also sends `playing`, kept **advisory**: gating on it
  would deadlock since the ad only plays once payment flows, and emoji ads have no video);
  **L2** a random server-issued challenge (unpredictable token at a random on-screen
  position) the viewer must tap within a 6s window; **L3** a per-session token
  (`POST /attention/session`) that every heartbeat must carry.
  `isAttentionFresh` is true only while the last beat passing **all three** is within the
  2.5s TTL.
- **Alternatives:** (a) keep the bare `{campaignId, viewer}` heartbeat; (b) passive
  signals only (no challenge); (c) server-rendered challenge content (decode-the-pixels)
  or signed client attestation.
- **Rationale:** the original heartbeat proved only that a timer was running — it was
  defeated by a background tab, a muted ad in a corner, or a browserless `curl` loop
  (the endpoint was unauthenticated and took the viewer id in the body). "Ads pay you"
  is only honest if you can't farm it. The layers stack: L1 stops casual gaming, L2
  forces a human's eyes on the screen, L3 stops sessionless scripting. (a)/(b) leave
  obvious holes; (c) is the right long-term answer but is more than a hackathon needs.
- **Threat model:** demo-grade, **not Sybil-proof**. L1 signals are client-reported and
  could be forged; L2 could be defeated by reimplementing the protocol (the challenge
  token is delivered as data, not as undecodable pixels). Goal: casual gaming impossible,
  scripted gaming expensive. Hardening path = option (c).
- **Touches:** `server/src/attention.ts` (new), `server/src/index.ts` (`/attention/session`,
  `/heartbeat`, `/attention/answer`, SSE gate), `web/src/flow.ts` + `web/src/main.tsx`
  (signals, challenge overlay), `server/src/attention-spike.ts` (updated to the new protocol).
- **Date:** 2026-06-19

## ADR-011 — Five per-second-native features routed through the app-ledger
- **Decision:** Add five features that each apply the per-second / escrow-refund primitive
  to a new surface — **live tip boost**, a **second-price attention auction**, **pay-per-token
  creator AI**, **escrowed crowdfund goals**, and **live streaming with a shared meter**.
  Money for the new flows moves through the **app-ledger** (`appDebit`/`appCredit`, SQLite)
  plus a `ledger.record` net-flow entry, rather than opening a fresh on-chain MPP channel
  per flow.
- **Alternatives:** (a) open a real mppx session/channel for every new flow (tips, AI tokens,
  pledges); (b) build each on the in-memory net ledger only (no spendable balance).
- **Rationale:** the app already settled the *spendable* balance through the app-ledger
  (Stripe top-ups bridged to pathUSD, `/api/watch`, ad rewards), and MPP channel-open is the
  flakiest part of the stack (DEV-H/L). Routing new flows through the same custodial ledger
  is reliable, keeps balances consistent across features, and still records the visible net
  flow. The original two directions (`/watch`, `/attention`) keep their real MPP channels —
  this is additive, not a replacement.
- **Auction design:** **Vickrey (second-price)** — the highest funded bid wins the slot but
  the viewer earns the *second-highest* bid (floored at the attention reserve). The clearing
  rate is carried on the attention session (`openSession(..., rewardRate)`, capped at the
  winner's bid) so the existing `/attention` SSE credits it without a parallel reward path.
  Second-price makes truthful bidding optimal, so the "transparent attention market" is real.
- **Creator AI:** streams the **real Claude API** (`server/src/ask.ts`, via `fetch` — no SDK
  dependency added) token-by-token with `unitType: "token"`; bills per ~4-char token and
  splits to the creator. Falls back to a canned local stream when `ANTHROPIC_API_KEY` is
  absent, so the per-token paywall demos fully offline.
- **Crowdfund:** pledges are escrowed (debited up front) and **lazily resolved** on read —
  captured to the creator when the target is met, refunded to all backers once the deadline
  passes. No cron; resolution happens whenever a goal is fetched or pledged to.
- **Live:** simulated (a looping source), with per-viewer presence registered by the existing
  per-second watch loop and an in-memory room aggregating viewers / combined $-sec / cheers.
- **Touches:** `shared/src/types.ts` (`Goal`, `AuctionResult`, `LiveStats`, `Clip.live`),
  `shared/src/currency.ts` (`askPerToken`), `server/src/db.ts` (`goals`/`pledges` tables,
  `clips.live`), `server/src/app-ledger.ts` (`appDebit`/`appCredit`), `server/src/{auction,ask,live}.ts`
  (new), `server/src/attention.ts` (`rewardRate`), `server/src/index.ts` (routes + discovery),
  `web/src/flow.ts` + `web/src/main.tsx` + `web/src/styles.css` (UI for all five).
- **Status:** all workspaces typecheck; DB DDL + goal/pledge helpers smoke-tested.
- **Date:** 2026-06-19
