# 07 — Demo Script (3 minutes)

Timed, built around the money-flow moment. Every step has a fallback for a flaky room
network. Matches the built app (Phases 1–5).

## Pre-flight (before you walk up)
- `pnpm dev` running (server :3000 + web :5173). Wallets funded (`pnpm wallets:setup`).
- Browser open at **http://localhost:5173** (phone-width). Net balance shows `reset` if needed.
- A terminal ready with the two agent commands.
- (Optional wow) A **curator agent already running for hours** — have `agent/logs/curator.jsonl`
  open as proof.

## Script

**0:00–0:25 — Hook.**
"Online, you're the product — platforms sell your attention and pay you nothing. FLOW flips
the money, and you can watch it flow in real time." Show the feed of clips.

**0:25–1:05 — Money OUT (creators).**
Tap **Watch** on a clip. "I'm opening a Tempo payment channel — now I pay this creator
**per second** of watchtime." Point at the red **− $** meter ticking and the red flow lane
streaming **→ creator**. Tap **Skip**. "The instant I leave, it settles on-chain and refunds
my unused deposit." Show the green receipt (paid / refunded).

**1:05–1:25 — Splits.**
Scroll to the **Bangkok collab** clip. "Collabs split revenue — 70/20/10 — and you see
exactly who earns what." Watch a few seconds, Skip, show the per-recipient breakdown.

**1:25–2:10 — Money IN (the reversal).**
Start the advertiser: `pnpm --filter @flow/server spike:attention`. Scroll to the **ad card**.
"Now an advertiser pays **me** — per second — but only for *proven* attention." Point at the
green **+ $** meter and the green flow lane streaming **← advertiser**. Tap **Look away 🙈**:
"watch the payment stop — no attention, no money." Tap **Look back 👀**: it resumes.

**2:10–2:40 — Net + agents.**
Point at the **net balance**: "My ad attention more than paid for my creator watching — net
positive. A self-sustaining feed." Then: "And it runs itself —" show the agents:
`pnpm agent:advertiser` + `pnpm agent:curator`. "Two autonomous agents: one pays creators and
earns from ads, the other pays viewers for attention — each with a budget, settling on-chain.
This run: curator paid $0.03, earned $0.06, **net +$0.03**, untouched."

**2:40–3:00 — Why Tempo + ask.**
"Thousands of sub-cent payments per second, instant settlement, refunds — the fee alone kills
this on Ethereum. Only Tempo payment channels make it real." Close on the **live receipts**
panel as on-chain proof. [Ask.]

## Fallbacks
- **Network dies:** the net meter + receipts render from server memory; narrate the last
  on-chain txHash from a terminal log. Say so honestly.
- **Channel open is slow (~5s):** that's the one on-chain tx; the per-second vouchers after
  it are instant — call that out as the point.
- **Agent stalled:** show `agent/logs/curator.jsonl` (the leave-it-running audit trail).
