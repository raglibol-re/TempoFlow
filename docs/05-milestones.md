# 05 — Milestones

Status: `todo` | `in-progress` | `done` | `blocked`

| # | Milestone | Status | Evidence |
|---|---|---|---|
| P0.1 | Step 0 — MPP context loaded, APIs extracted | done | [02-mpp-integration.md](02-mpp-integration.md) |
| P0.2 | Monorepo + TS + workspaces scaffolded | done | root config, 4 workspaces |
| P0.3 | Wallet helpers + .env schema | done | [shared/src/wallet.ts](../shared/src/wallet.ts), [.env.example](../.env.example) |
| P0.4 | Docs 00/01/02/10 first draft + 04/05 started | done | this folder |
| P0.5 | `pnpm install` + mppx@0.7.0 API verified against source | done | [02](02-mpp-integration.md), [04](04-progress-log.md) |
| P1.0 | Live testnet wiring: faucet funding + first per-sec micropayment | done | tick `{second:1, spentUsd:0.002}` on Tempo testnet |
| P1.1 | Creator stream endpoint `/watch/:id` (per-sec, recipient=creator) | done | full ladder $0.002→$0.008; voucher loop fixed (DEV-I) |
| P1.2 | Web: 1 clip, open session, skip = close + refund | done | `web/` feed card + money-out meter + receipt; `pnpm dev` |
| P1.3 | Direction A acceptance: money flows/sec, skip settles + refunds | done | close receipt `spent 8000`, txHash on-chain, refund 0.492 |
| P1.4 | One-command dev (frontend + backend) | done | `pnpm dev` → server :3000 + web :5173 |
| P2.1 | `/attention/:campaignId` (recipient=viewer, operator) + heartbeat gate + net ledger | done | attention-spike paid to viewer; gate pauses on attention loss |
| P2.2 | Scripted advertiser client streams payment | done | `attention-spike.ts`: $0.044 paid, close txHash on-chain |
| P2.3 | Web: ad card, heartbeats, net-balance rising | done | both-direction UI + net meter + flow feed |
| P3.3 | `/openapi.json` discovery + `mppx discover validate` | done | "Discovery document is valid." — x-payment-info on /watch + /attention, x-service-info |
| P3.1 | Scrollable feed, seamless session switch | done | 3-clip scroll-snap feed; new Watch closes prior channel first |
| P3.2 | Split payments for collab creators | done (display) | collab clip shows 70/20/10 + per-recipient breakdown on settle; settles to primary on-chain (mppx session has no native splits — DEV-B) |
| P4.1 | Curator agent autonomous + spend policy + logs | done | watched 4 clips, paid $0.03, earned $0.06 from ads, net +$0.03, JSONL logs |
| P4.2 | Advertiser agent autonomous + budget | done | paid viewer $0.06 (attention-gated), stopped at budget, on-chain txHash |
| P4.3 | Curator "leave-it-running" process | done (capable) | budget/Ctrl-C stop + JSONL audit trail; run long for the 48h proof |
| P5.1 | Money-flow animation + net-balance meter + receipts view | done | directional flow lanes (out red / in green), net meter, live receipts feed |
| P5.2 | Mobile layout, empty/error states, reconnects | done | phone-width layout, loading/error states, net poll auto-retries |
| P5.3 | Docs 07/08 + README | done | demo script + pitch finalized w/ real numbers; README refreshed (GIF still TODO) |
| P6.1 | Seed data, demo mode, fallbacks, reset | todo | — |
| P6.2 | Dress rehearsal vs 07-demo-script.md | todo | — |
