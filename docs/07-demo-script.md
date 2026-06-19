# 07 — Demo Script (3 minutes)

Timed, around the money-flow moment. Multi-user dashboard (YouTube/Twitch-style). Every
step has a fallback for a flaky room network.

## Pre-flight
- `pnpm dev` running (server :3000 + web :5173). `.users.json` present (6 funded users).
- Browser at **http://localhost:5173**; hard-refresh once (Ctrl+Shift+R) for a clean tab.
- (Optional wow) curator agent already running for hours → `agent/logs/curator.jsonl` open.

## Script

**0:00–0:25 — Hook.**
"Online you're the product — platforms sell your attention and pay you nothing. FLOW flips
the money and shows it flowing, per second." Show the feed + the **account switcher** (top
right): "These are real users — creators, viewers, advertisers — each with their own wallet."

**0:25–1:05 — Money OUT (watch a creator).**
As **Alice**, open the **Home** feed (clips from several channels). Tap **Watch** on Bob's
synthwave clip. "I've opened a Tempo payment channel — I'm paying Bob **per second**." Point at
the red **−$** meter + the red flow lane **→ creator**. Tap **Skip**: "settles on-chain, refunds
the rest." Show the receipt. Scroll to the **collab** clip → show the 70/20/10 split.

**1:05–1:30 — Post content (Studio).**
Switch to **Studio**, type a title, **Post clip** → it appears in the feed. "Anyone can post;
when others watch it, they pay your wallet directly."

**1:30–2:15 — Money IN (the reversal).**
Go to **Earn**, tap **Watch ad**. "Now an advertiser — Tempo Pay — pays **me** per second, but
only for *proven* attention." Green **+$** meter + green flow lane **← advertiser**. Tap
**Look away 🙈**: payment pauses. **Look back 👀**: it resumes. Then background the tab or
scroll the ad off-screen — payment pauses there too. When the **"👀 tap to keep earning"**
prompt pops up at a random spot, tap it: "that's the platform checking a human is actually
watching — ignore it and the money stops." (Under the hood the company's advertiser agent
is paying you, gated by a **three-layer attention proof** — visibility/on-screen signals, a
random tap challenge, and session-bound heartbeats. See [01-architecture.md](01-architecture.md).)

**2:15–2:40 — Net + autonomous agents.**
Show the per-user **net**: "my ad attention more than paid for my creator watching." Then the
agents: `pnpm agent:curator` + `pnpm agent:advertiser` — "autonomous, budgeted, settling
on-chain. This curator paid $0.03, earned $0.06, net +$0.03, untouched."

**2:40–3:00 — Why Tempo + ask.**
"Thousands of sub-cent payments per second, instant settlement, refunds — the fee alone kills
this on Ethereum. Only Tempo payment channels make it real." Close on the **live receipts**
panel. [Ask.]

## Fallbacks
- **"Failed to fetch":** hard-refresh (stale tab after a hot-reload). The app now names the
  exact failing step, so read that aloud and diagnose.
- **Network dies:** net meter + receipts render from server memory; cite the last on-chain
  txHash from a terminal log.
- **Channel open is slow (~5s):** that's the single on-chain tx; per-second vouchers after it
  are instant — that's the point.
- **In-browser ad slow to start:** it spawns the advertiser agent (~8s to first payment); or
  run `pnpm agent:advertiser -- --to <viewer>` yourself.
