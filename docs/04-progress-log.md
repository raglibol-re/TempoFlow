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
