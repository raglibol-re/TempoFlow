# 07 — Demo Script (3 minutes)

> Status: **draft** — finalize in Phase 5. Timed, built around the money-flow moment.
> Every step has a fallback for a flaky room network.

## Setup (before walking up)
- Server + web running; wallets pre-funded (demo mode); curator agent already running 48h.
- Receipts panel open in a second tab.

## Script

**0:00–0:25 — Hook / problem.**
"Online, you're the product: platforms sell your attention and pay you nothing. FLOW
flips the money." Show the feed.

**0:25–1:10 — Direction A (money OUT).**
Play a creator clip. Point at the flow animation streaming **out** to the creator and the
balance ticking down ~$0.002/sec. **Scroll away.** "The instant I scroll, payment stops
and my unused deposit is refunded on-chain." Show the refund + receipt.

**1:10–2:00 — Direction B (money IN, the reversal).**
An ad appears; flow animation reverses — money streams **in** from the advertiser,
net-balance rises ~$0.004/sec. **Hide the tab / scroll the ad out of view.** "Watch the
payment stop — the advertiser only pays for *proven* attention. No heartbeat, no money."
Bring it back; payment resumes.

**2:00–2:35 — Net + agents.**
Show the net meter: "ad attention financed my creator watching." Then: "This curator
**agent** has run autonomously for 48 hours — paid $X to creators, earned $Y from ads,
net $Z. Nobody touched it."

**2:35–3:00 — Why Tempo + ask.**
"Thousands of sub-cent payments per second, instant settlement, refunds — the fee alone
would kill this on Ethereum. Only Tempo payment channels make it real." Close on the
receipts as on-chain proof.

## Fallbacks
- **Network dies mid-demo:** switch to "Demo Mode" with recorded/seeded flow events; the
  animation + receipts still render from local state. Say so honestly.
- **Settlement lag:** narrate the off-chain voucher stream (instant) vs the on-chain
  settle-on-close; show a previously captured receipt.
- **Agent stalled:** have a screenshot/log of the 48h run as backup evidence.
