# 04 — Progress Log

> Append-only, chronological, timestamped. Honest — including what does **not** work yet.

## 2026-06-18 — Phase 0: Setup & Context

- **Step 0 (MPP context):** Loaded `mpp.dev/llms-full.txt` and the `/guides/streamed-payments`
  + `/guides/pay-as-you-go` pages via web fetch. Extracted the mppx server/client/session
  API surface into [02-mpp-integration.md](02-mpp-integration.md).
  - ⚠️ The docs-fetch model flagged that exact SSE framing / per-second billing hooks are
    only partially specified. Recorded open questions in 02 + [06-decisions.md](06-decisions.md).
  - ❓ `npx skills add tempoxyz/mpp -g` and `claude mcp add ... mpp` (MCP docs server) were
    **not** executed in this environment yet — to run during Phase 1 setup on the dev machine.
- **Monorepo scaffolded** (pnpm workspaces): `shared`, `server`, `web`, `agent` + root
  `package.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `.gitignore`, `.env.example`.
- **/shared built (real code):** `currency.ts` (chain + pathUSD + prices + viem chain def),
  `types.ts` (Clip/Campaign/Split/FlowEvent/Heartbeat), `wallet.ts` (create + fund via
  master-transfer or faucet), `scripts/setup-wallets.ts` (`pnpm wallets:setup`).
- **Skeletons:** `server` (Hono `/health` bootstrap), `web` (Vite+React shell),
  `agent` (curator/advertiser placeholders).
- **Docs created:** 00, 01, 02, 04, 05, 06, 07, 08, 09, 10 + README scaffold.
- **Not done yet / blockers:**
  - `pnpm install` not yet run → `mppx` version unverified; signatures in 02 are docs-derived.
  - RPC URL + pathUSD decimals are placeholders pending verification.
- **Next:** post Phase 1 plan, then implement Direction A (creator stream end-to-end).

## 2026-06-18 — Phase 1 spike: Direction A against LIVE Tempo testnet

Goal: validate real mppx API + get a creator stream paying per second on-chain.

**Verified the real `mppx@0.7.0` API** (the earlier docs-fetch was partly wrong):
- `pnpm install` OK. `mppx@0.7.0` is by **wevm** (viem/wagmi team). Peers: viem ≥2.51,
  hono ≥4.12.18 (bumped our specifiers; installed viem 2.52.2 / hono 4.12.25).
- Read the shipped `.d.ts` + `src` and the GitHub `examples/session/sse`. Corrected
  every signature in [02-mpp-integration.md](02-mpp-integration.md). Key reality:
  - Server: `Mppx.create({ methods:[tempo({account,recipient,currency,decimals,chainId,store,getClient,sse})], secretKey })` from **`mppx/server`** (not the hono middleware for streaming).
  - Streaming endpoint = `const r = await mppx.session(opts)(request); if (r.status===402) return r.challenge; return r.withReceipt(async function*(stream){ await stream.charge(); yield … })`.
  - Client: `sessionManager({account,client,decimals,maxDeposit,escrow})` → `.sse(url)` async-iterable → `.close()`.
  - `tempo.session` request needs `{amount,currency,decimals,unitType}` (unitType is a free string → `'second'`). Splits use **absolute amounts**, not percentages.
- Corrected constants: **testnet chainId 42431** (not 4217=mainnet), RPC
  `https://rpc.moderato.tempo.xyz` (live, returns 0xa5bf), pathUSD decimals 6.

**Funding solved without keychain:** `mppx account create` fails on win32, but the
faucet is just the unauthenticated `tempo_fundAddress([addr])` RPC. Rewired
`shared/wallet.ts` + `pnpm wallets:setup` to use it; writes a ready `.env`. ✅

**Live run results (Tempo testnet):**
- ✅ Server boots; `/health`, `/feed` serve.
- ✅ 402 challenge issues correctly (price/sec, recipient=creator).
- ✅ Client opens a **real on-chain payment channel** via the escrow precompile.
- ✅ **First per-second micropayment flowed**: tick `{second:1, spentUsd:0.002, creator:"nordlys.studio"}` — money out, on-chain-backed.
- ⛔ **BLOCKER:** stream stalls at tick 2 — the mid-stream voucher top-up loop.
  The streaming GET and the client's voucher POST run in separate request contexts;
  with the default store this raced ("reserved voucher coverage is no longer available").
  Switching to `sse:{poll:true}` removed the crash but the stream now hangs after
  tick 1 (server polls for a higher voucher; client appears not to receive/act on the
  `payment-need-voucher` SSE frame — likely an SSE flush/handshake timing detail in the
  Node + `@hono/node-server` path). Not an architecture problem — a voucher-loop tuning issue.

**Fixes made along the way (see 06 ADRs):**
- Escrow precompile address: used canonical `0x4d50500…0000` ("MPP") from mppx
  `Protocol.ts`; the `defaults.ts` testnet value `0xe1c4d3…` reverts on open. **(DEV-G)**
- Added `server/src/env.ts` (Node `process.loadEnvFile`) loaded first, instead of the
  tsx `--env-file` flag (which broke `tsx watch` arg parsing).
- The canonical precompile pulls pathUSD **without an ERC-20 allowance**, so the
  `approve-escrow.ts` script turned out unnecessary (kept as a no-op safety net).

**Typecheck:** `@flow/shared` and `@flow/server` both clean (apps use `declaration:false`).

**Next (Phase 1 proper):** resolve the voucher-loop stall (try larger initial voucher /
`prepaidUnits`, or WS transport `.ws()`; verify `payment-need-voucher` round-trip), then
confirm close() settles + refunds, then build the minimal web watch UI.

## 2026-06-18 (later) — DEV-I RESOLVED + web app + one-command dev

**Direction A now works fully end-to-end on live testnet:** open channel → per-second
payments → graceful stop → cooperative close (settle + refund). Spike output:
ticks $0.002→$0.008, `close receipt { spent: 8000, acceptedCumulative: 8000, txHash: 0x3009… }`,
refund = deposit − spent (0.492 pathUSD) on-chain.

**Root cause of the stall (two bugs), found by instrumenting mppx dist:**
1. **Management-POST double-charge.** mppx classifies a voucher POST as no-charge
   management only if the request has no body and no body-intent headers. But
   `@hono/node-server` gives an empty POST a non-null body, so the top-up POST was
   charged a spurious tick — `spent` raced up to the voucher ceiling → zero headroom →
   stream hung. **Fix:** forward a body-less request (Authorization header only) to
   `mppx.session()` for POSTs. → ticks 2,3,4 then flowed.
2. **Close race.** `payment-receipt` is only emitted at generator *completion*
   (`Sse.serve`), so mid-stream the client's confirmed cumulative lagged `spent`;
   `close()` then signed a close voucher < spent → 402, and mppx's close retry reuses
   the same amount. An abort would *skip* the receipt entirely. **Fix:** a graceful-stop
   path — `POST /watch/:id/stop` flags the channel; the generator `return`s normally so
   `Sse.serve` emits the final receipt, the client syncs, then `close()` settles exactly.

**Web app (Phase 1 UI):** `web/src/flow.ts` (browser `sessionManager`) + `main.tsx`
(mobile feed card, live "money out" meter ticking per second, Watch / Skip, on-chain
settle+refund receipt). RPC allows CORS (`ACAO: *`); server has `hono/cors`. Vite reads
the repo-root `.env` (`VITE_VIEWER_PRIVATE_KEY`, testnet only). All 4 workspaces typecheck.

**One-command dev:** `pnpm dev` (concurrently) starts server :3000 + web :5173. Verified
both serve and the web bundle resolves `mppx/client` for the browser.

**Note:** temporary debug logs added to `node_modules/.../mppx/dist` during diagnosis were
removed. The fix lives entirely in our own code — a fresh `pnpm install` keeps it intact.

## 2026-06-18 (later still) — Bug fixes + Phase 2 (Direction B) working

**Fixed "failed to fetch" on Watch (browser).** The `cors()` middleware only decorated
Hono-native responses; mppx returns *raw* `Response` objects (402 challenge, SSE stream,
204 ack) with no `Access-Control-Allow-Origin`, so the browser blocked them. Added a
`corsify()` helper applied to all mppx responses. Verified 402 now returns `ACAO`.

**Git diagnosis (not corruption):** local `main` and `origin/main` are *unrelated
histories* (same 7 commit messages, different SHAs, no common ancestor) — VSCode "Sync
Changes" can't auto-reconcile and spins. Local has the real work; resolve by force-pushing
local→remote (awaiting user OK; not executed).

**Phase 2 — Direction B (ads pay the viewer), end-to-end on testnet:**
- Server `/attention/:campaignId`: session endpoint with **recipient = viewer**, server
  account set as channel **operator** (`operator` in the challenge) so it can settle to the
  viewer without holding the viewer's key. Same body-less-POST + graceful-stop + corsify
  pattern as `/watch`.
- **Attention gate:** `POST /heartbeat` records per-campaign freshness (TTL 2.5s). The
  generator calls `stream.charge()` only while attention is fresh; otherwise it yields a
  `paused` frame and **does not charge** — nobody pays for ignored ads.
- **Net ledger** (`ledger.ts`): `/net` exposes `in` (ads) − `out` (creators) = net, plus a
  flow-event feed. `/reset` clears it.
- **Advertiser spike** (`attention-spike.ts`, the payer): paid $0.004→$0.016/sec, then
  heartbeats OFF → after grace, `paused` (no charge), then ON → resumed → $0.044. Close
  `spent 44000`, on-chain txHash, settled **to the viewer**. `/net` → `inUsd 0.044`.
- **Web app now shows BOTH directions + a NET meter:** creator clip (money OUT), ad card
  with a Look-away/Look-back attention toggle (money IN, heartbeat-gated), live net balance
  + flow-event feed. All 4 workspaces typecheck; web bundle serves.

**Next:** Phase 3 (scrollable feed + splits + `/openapi.json` discovery), then Phase 4 agents.

## 2026-06-18 (Phase 3 start) — Discovery doc live + validated

- `GET /openapi.json` via mppx `generate(mppx, {info, serviceInfo, routes})`. Both paid
  endpoints carry `x-payment-info.offers` (raw amounts — note: discovery amounts must be
  RAW integer units, e.g. "2000" for $0.002 @ 6 decimals, not the decimal string) with
  currency + recipient + intent, plus root `x-service-info` (categories, docs).
- **`npx mppx discover validate http://localhost:3000/openapi.json` → "Discovery document
  is valid."** Agents can now auto-find FLOW's creator + attention endpoints (Phase 4).
- Remaining Phase 3: multi-clip scrollable feed (P3.1) + collab split payments (P3.2).

## 2026-06-18 (Phase 3 complete) — scrollable feed + collab splits

- **Multi-clip feed (P3.1):** seed now has 3 clips (2 solo + 1 collab). Web is a
  scroll-snap vertical feed; clicking Watch on a card **seamlessly closes the previously
  playing channel** (settle + refund) before opening the new one. Active card is highlighted.
- **Collab splits (P3.2):** the collab clip declares a 70/20/10 split. The UI shows the
  split and, on settle, the per-recipient breakdown of what was paid. On-chain the channel
  settles to the primary creator (mppx session has no native per-second splits — see
  06 ADR-009/DEV-B). All clips settle to the server's single creator wallet (only key held).
- All 4 workspaces typecheck; `pnpm dev` serves feed (3 clips) + valid `/openapi.json`.

**Phase 3 done.** Next: Phase 4 — autonomous Curator + Advertiser agents (the
"leave-it-running" wow), using the discovery doc to find content.

## 2026-06-18 (Phase 4 complete) — autonomous agents on testnet

Built `agent/src/lib.ts` (SpendPolicy, JSONL logger, `discoverOffers`, `makeManager`,
`runPaidStream`), `curator.ts`, `advertiser.ts`. Both headless, CLI-flagged, with spend
controls and structured logs.

**Bugs fixed during testing:** (1) a `sessionManager` can't reopen after `close()`
("Invalid session transition: closed + challengeReceived") → curator now makes a **fresh
manager/channel per clip**. (2) advertiser would hang when attention stopped → added an
`--idleStop` (default 15s) so it ends the campaign cleanly.

**Verified autonomous run (testnet):**
- Curator: discovered 2 offers via `/openapi.json`, watched 4 clips (Aurora, Synthwave,
  Bangkok collab, Aurora), paid creators $0.03 (settle+refund each), stopped at budget.
- Advertiser: discovered the attention endpoint, paid the viewer $0.004/sec ×15 = $0.06,
  stopped at budget, on-chain txHash `0x5bdf…`.
- **Net: out $0.03 to creators, in $0.06 from the advertiser → net +$0.03.** The
  self-sustaining loop ("ad attention finances the feed") runs autonomously, both agents
  respecting budgets and closing channels cleanly. JSONL audit trails in `agent/logs/`.

**Phase 4 done.** Next: Phase 5 polish (money-flow animation, receipts view) + 07/08/README.

## 2026-06-18 (Phase 5) — polish + pitch docs

- **Money-flow animation:** directional flow lanes (CSS particle stream) — red **→ creator**
  on the active clip while watching, green **← advertiser** on the ad card while it's paying.
- **Receipts / states:** "live receipts · settled on Tempo" header on the flow feed; loading
  state for the feed; existing error surface; net poll auto-retries (reconnect-tolerant).
- **Docs:** [03-agent.md](03-agent.md) written; [07-demo-script.md](07-demo-script.md) and
  [08-pitch.md](08-pitch.md) finalized with the real demo flow + agent numbers; README
  refreshed (Phases 1–5, DoD checklist). GIF capture remained for Phase 6.
- All 4 workspaces typecheck; web + server + discovery smoke-tested OK.

**Phases 1–5 complete.** Remaining: Phase 6 demo hardening (seed/demo mode, reset button,
network fallbacks, dress rehearsal) + capture the README GIF.

## 2026-06-18 — Multi-user redesign (YouTube/Twitch-style)

**Failed-fetch (precise):** ruled out backend — server `/health` 200, `/watch` 402 with CORS,
browser `/net`+`/heartbeat` polls returning 200 in the log, RPC CORS `*` for all methods,
viewer funded (1,000,016 pathUSD). Conclusion: stale browser tab after many dev restarts →
hard-refresh. Hardened anyway: the web now wraps every request with a **labeled error**
(which URL/step failed) so it never just says "failed to fetch".

**Operator settlement (key change):** the server now settles every channel as the **operator**,
so it can pay out to ANY recipient wallet without holding their key. Verified on testnet:
watched Alice's clip → settled `spent 8000` to Alice's distinct wallet. This unlocks multi-user.

**Multi-user model:**
- `users.ts`: 6 demo users (4 persons, 2 companies), each a funded Tempo wallet, persisted to
  `.users.json` (funded once). Exposed via `/demo/users` (testnet keys) for the web switcher.
- `content.ts`: clips owned by creators (distinct wallets) + campaigns owned by companies;
  `POST /clips` (creator posts) + `POST /campaigns` (company creates).
- `ledger.ts`: per-address net (`/net?as=<userId>`) — each user sees their own in/out/net.
- `/watch/:id?as=<viewer>` pays the clip's creator; `/attention/:id?to=<viewer>` pays that viewer.

**Web — full multi-user dashboard:** account switcher (avatars), per-user net; **persons** get
Home (multi-channel feed, watch=pay creator), Studio (post a clip), Earn (watch ads → get paid,
attention-gated); **companies** get a campaigns view. Money-flow animation + live receipts kept.

**In-browser ads:** an in-process server-side advertiser hit mppx's "object is not extensible"
(can't import mppx/client into the mppx/server process). Fixed by `/demo/run-ad` **spawning the
advertiser agent** as a child process targeting the watching viewer (idle-stops when they leave).

All 4 workspaces typecheck. Operator settlement verified on-chain; multi-creator feed + posting live.

## 2026-06-18 — DB + roles + video + faucet + admin (+ merge-conflict repair)

**Repaired committed merge conflicts.** A git merge left `<<<<<<<`/`>>>>>>>` markers committed
in 7 files incl. `web/src/main.tsx`, `web/src/flow.ts`, `attention-spike.ts` — that broke the
build (the real cause of "failed to fetch … again" + the `git-error` file). Resolved all:
rewrote the source files, kept HEAD for docs. Repo builds clean again.

**Persistence — local SQLite (`node:sqlite`), no Supabase.** `server/src/db.ts` stores users,
clips (incl. uploaded video path), campaigns in `server/flow.db`. Seeded once on first boot.

**Roles + login.** Users now have a role: viewer / creator / advertiser / admin (9 seeded,
funded). Web has a **login screen** (pick an account by role) persisted in localStorage;
role-based dashboards (viewer: Home+Earn; creator: +Studio; advertiser: Campaigns; admin: Users).

**Real video upload + playback.** `POST /clips` accepts multipart (`video` file) → stored under
`server/uploads/` + path in SQLite; `GET /video/:clipId` streams with **HTTP range** (206) for
`<video>`. Studio has an upload form. Verified: upload 200 (`hasVideo:true`), range serve 206.

**Payment-gated video.** The `<video>` plays while per-second payment ticks flow; a stall
detector pauses it (overlay "funding stopped — Get test funds") if ticks stop, and on channel
close. (To force-demo depletion, lower `maxDeposit`.)

**Faucet + admin.** `POST /demo/fund {userId}` tops up any user via `tempo_fundAddress`; a
**"Get test funds"** button for the logged-in user. Admin dashboard (`GET /admin/users`) lists
all users with live on-chain pathUSD balances + per-user "add funds". Verified working.

**Fancy money-flow.** Replaced the CSS lane with a `<canvas>` particle stream (glowing dots,
directional: red → creator / green ← advertiser), intensity tied to live payment activity.

All 4 workspaces typecheck; server boots with SQLite; endpoints + upload/serve verified.

## 2026-06-18 — Root-caused browser "Failed to fetch" → RPC rate-limit (DEV-L)

A browser self-diagnostic (web probes server+RPC, reports to `/debug`) revealed the truth:
the browser reached the server (200) AND the RPC (chainId), but `manager.sse()` still threw
"Failed to fetch". One probe caught the cause — **RPC `429` (rate-limited)**. The public
Tempo RPC throttles the burst of channel-open calls; a `429` returns **without CORS headers**,
so the browser reports it as "Failed to fetch" (Node never hit this — no CORS enforcement +
viem retries 429). Session-long testing + retries had rate-limited our IP.

**Fix:** added a server **RPC proxy** `POST /rpc` (forwards to the public RPC, retries 429/503
with backoff, same-origin + CORS-clean). The browser's viem client now uses `${SERVER}/rpc`
instead of the public RPC directly. Verified end-to-end: full channel open through the proxy
settles on-chain (`tx 0x97b8…`). Removed the on-app-load direct-RPC probe (it added load).
