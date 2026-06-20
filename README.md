<p align="center">
  <img src="docs/assets/banner.svg" alt="TempoFlow — your attention to ads pays for your creator feed" width="100%" />
</p>

# TempoFlow

**A content feed where money flows in real time — _out_ to creators when you watch them,
_in_ from advertisers when your balance runs low.** You watch free; when your credit
dips, your agent auto-plays a matching ad to refill you. No subscriptions, no
engagement-bait algorithm, no ignored-impression ads. Built on **Tempo** via the
**Machine Payments Protocol (MPP)**.

> _Your attention to ads pays for your creator feed._

![money flow demo](docs/assets/flow.gif)

**Status:** Phases 1–6 demo-ready on Tempo testnet — both money directions live over MPP
payment channels, attention-gated ads, scrollable feed with collab splits, validated
`/openapi.json` discovery, two autonomous budgeted agents settling on-chain, and a
real-time money-flow UI with demo reset/fallbacks. **TESTNET ONLY — never real funds.**

## The reversal

| When you… | Money flows… | How |
|---|---|---|
| **Watch a creator** | **out**: you → creator, per second | Watchtime, not subscriptions — you pay only while you watch, and stop anytime. |
| **Run low on credit** | **in**: advertiser → you, per second | Your agent auto-plays a *matching* ad to refill you — paid **only for proven attention** (layered proof, below). |

You watch free; your balance drains to the creators you watch, and when it runs low your
**agent earns it back from a matched ad** — an alternating drain → refill loop that nets
≈ 0 over time. A potentially self-sustaining feed, balanced by a machine (no API key).

## Proving attention (anti-fraud)

"Ads pay you" only works if you can't get paid for *ignoring* the ad. A naive
heartbeat proves a timer is running, not that a human is watching — you could leave
it in a background tab, or even skip the browser entirely and `curl` the heartbeat in
a loop. FLOW gates payment on a **three-layer proof** instead
([server/src/attention.ts](server/src/attention.ts)):

1. **Passive signals (Layer 1).** A heartbeat only counts while the tab is **visible**
   and the player is **on-screen** (`IntersectionObserver`); the client also reports
   whether the video is **playing** (advisory — not gated, since the ad only starts
   playing *after* payment flows, so requiring it would deadlock). Kills the
   background-tab / scrolled-away / manual-look-away cheats.
2. **Active challenge (Layer 2).** At random intervals the server issues an
   unpredictable token at a **random on-screen position**; you must tap that target
   within a few seconds to keep earning. This is what forces eyes on the screen.
3. **Session binding (Layer 3).** Every heartbeat must carry a per-session token issued
   when the ad opens — a sessionless `curl` loop mints zero attention.

The layers stack: 1 stops casual gaming, 2 forces real attention, 3 stops scripted
abuse. **Demo-grade, not Sybil-proof** — Layer 1 signals are client-reported. See
[docs/01-architecture.md](docs/01-architecture.md) and [ADR-010](docs/06-decisions.md).

## More ways the money flows (per-second native features)

Every feature below is the same primitive — **stream value in tiny units, settle/refund
trustlessly** — applied to a different surface. See [ADR-011](docs/06-decisions.md).

| Feature | What it does | The MPP angle |
|---|---|---|
| **Autonomous ad agent** | When your credit runs low while watching, a deterministic agent (no API key) reads your interests, picks the best-matching **funded** ad, plays it full-screen to refill you, then auto-resumes your video. | Settles the advertiser → viewer payout on-chain per proven second; pure tag-overlap + budget policy, no LLM. |
| **Live tip boost** | While watching a creator, stream an extra `$X/sec` tip on top of watchtime (or quick one-tap tips). | Per-second value transfer, layered on the existing watch stream — settled on-chain. |
| **Ask a creator's AI** | Chat a creator's AI persona, billed **per generated token**, revenue split to the creator. | `unitType: "token"` — the machine-payments story (real Claude API streaming, falls back to a canned answer offline). |
| **Crowdfund goals** | Back a creator's funding goal; pledges are **escrowed** and only captured if the goal is reached, else **auto-refunded** at the deadline. | Trustless Kickstarter on the escrow + refund primitive. |
| **Advertiser escrow + refund** | An advertiser **escrows real pathUSD on-chain** into the platform vault to fund an ad; the ad pays viewers per proven second from that escrow; when the advertiser hits **Stop**, the **unspent remainder is refunded on-chain** to their wallet (and the budget is capped at what was actually spent). | Pay-as-watched ad budgets on the escrow + refund primitive — every deposit, payout, and refund is a real on-chain tx, linked to the block explorer in the Ad Studio. |
| **Go live (on camera)** | Creators stream their **webcam** live; viewers on other accounts see the real camera feed and pay per second, while the host watches a live **income meter** (watchers, combined `$/sec`, 👏 cheers). Live only while the host is present — it auto-ends when they leave. | Many per-second payers into one aggregated audience, gated on host presence. |

Find them in the app: the **watch page** (auto ad-refill + tip boost); **Studio → 🔴 Go live** (on camera);
**Ad Studio** (fund ads on-chain); the **Ledger** (transparent 3% margin); and any **creator profile** (Ask-AI box + funding goal).

## Why only on Tempo

Thousands of **sub-cent payments per second**, to **many recipients**, with **instant
settlement** and **refund of unused deposit**. On Ethereum/Solana the transaction fee
alone would dwarf a $0.002/sec micro-payment. FLOW streams off-chain **vouchers** over
**Tempo payment channels** and settles on-chain only at the end — the *only* substrate
where pay-per-second-of-attention is economically real.

## Quickstart

```bash
pnpm install
pnpm wallets:setup          # generate + fund testnet wallets, writes .env (TESTNET ONLY)
pnpm dev                    # ONE COMMAND → server :3000 + web :5173
```

Open **http://localhost:5173** (a multi-user, YouTube/Twitch-style dashboard):
- **Account switcher** (top-right avatars): be any of the demo users — people (watch + post)
  or companies (run ads). Each has its own funded Tempo wallet; you pay/earn as them.
- **Home**: a multi-channel feed — **Watch** any clip → money streams **out** to *that*
  creator per second; when your credit runs low your **agent plays a matching ad** full-screen
  to refill you, then auto-resumes. Stop anytime (you're only charged for what you watch).
  Collab clips show a 70/20/10 split.
- **Studio**: post a clip → it joins the feed and earns to your wallet, or **🔴 Go live on
  camera** → viewers on other accounts see your webcam and pay you per second.
- **Ad Studio**: fund an ad on-chain — your funded ad is what the agent serves to viewers,
  paying them per **proven** second (look away / background the tab / ignore the random
  "tap to prove you're watching" prompt → payment pauses; three-layer attention proof above).
- **Ledger**: the transparent glass ledger — every payment and the **3% platform margin**, on-chain.

> If the page ever shows a stale error after a code change, hard-refresh (Ctrl+Shift+R) —
> the dev server hot-reloads and old tabs can hold a dead connection. The app now reports
> the exact failing step rather than a generic "failed to fetch".

**Autonomous agents** (the leave-it-running wow):
```bash
pnpm agent:advertiser -- --budget 0.08    # pays viewers for proven attention
pnpm agent:curator    -- --budget 0.05    # pays creators, earns from ads, net-aware
```
Headless single-watch check: `pnpm --filter @flow/server spike`.
Validate discovery: `npx mppx discover validate http://localhost:3000/openapi.json`.

## Architecture

```
shared/  types, currency/chain constants, wallet helpers
server/  Hono + mppx: /watch (Viewer→Creator), /attention (Advertiser→Viewer), discovery
web/     Vite + React: feed, attention heartbeats, money-flow UI, receipts
agent/   headless agents: curator (pays creators, earns from ads), advertiser
```

Two money directions, both over MPP sessions on Tempo testnet. See
[docs/01-architecture.md](docs/01-architecture.md).

## Docs

- [00 Vision](docs/00-vision.md) · [01 Architecture](docs/01-architecture.md) ·
  [02 MPP Integration](docs/02-mpp-integration.md) · [03 Agents](docs/03-agent.md)
- [04 Progress Log](docs/04-progress-log.md) · [05 Milestones](docs/05-milestones.md) ·
  [06 Decisions](docs/06-decisions.md)
- [07 Demo Script](docs/07-demo-script.md) · [08 Pitch](docs/08-pitch.md) ·
  [09 API](docs/09-api.md) · [10 Runbook](docs/10-runbook.md)

## What works (Definition of Done)

- ✅ Both money directions live over MPP sessions on Tempo testnet
- ✅ Stopping or losing attention halts payment instantly — you're only charged per second actually watched
- ✅ When credit runs low, the agent's matched ad refills you on-chain, then watching auto-resumes (drain → refill, net ≈ 0)
- ✅ Live streaming on camera: viewers on other accounts see the host's real webcam and pay per second; the host sees a live income meter
- ✅ Three-layer attention proof (passive signals + random tap challenge + session-bound heartbeats) prevents paying for ignored or scripted ads
- ✅ Per-second-native features: live tip boost, second-price attention auction, pay-per-token creator AI, escrowed crowdfund goals, and live streaming with a shared audience meter
- ✅ Advertiser escrow + refund: ad budgets are real pathUSD escrowed on-chain, spent per proven second, and the unspent remainder is refunded on-chain on Stop (verified: fund/payout/refund all settle on Tempo)
- ✅ Every account is a real Tempo wallet; the wallet menu always shows your address, links to the Tempo explorer + app, and exports your (testnet) private key so you can take the wallet out
- ✅ Creator dashboard: edit (title/tags) + delete your videos; live streams are shown distinctly, not as regular clips
- ✅ Live streams are gated on creator presence — live only while the host is in the stream, auto-ending (and leaving the feed) when they go
- ✅ Curator + Advertiser agents run autonomously with spend controls + on-chain settle
- ✅ `/openapi.json` discovery present and valid (`mppx discover validate`)
- ✅ Receipts / live flow feed in the UI
- ✅ Seed/demo mode, reset flow, and room-network fallbacks documented
- ⏭️ Remaining manual step: live dress rehearsal before presenting

Built for the MPP Hackathon (Tempo), 16–20 June 2026. **TESTNET ONLY.**
