# 00 — Vision

## FLOW: the feed where money flows the right way

FLOW is a content feed with **no traditional ads and no engagement-bait algorithm**.
Instead, the entire product is built around one visible, real-time moment: **money
flowing per second**, in two directions.

### The reversal thesis

Today's attention economy is backwards: platforms harvest your attention, sell it to
advertisers, and pay you nothing. Creators get a thin slice; the platform takes the rest.

FLOW inverts the flow of money and makes it visible in real time:

| When you… | Money flows… | Mechanism |
|---|---|---|
| **Watch a creator** | **out**: you → creator, **per second** | Watchtime, not subscriptions. Scroll away = instant stop. |
| **Watch an ad** | **in**: advertiser → you, **per second** | Ads pay *you* for genuine attention. |

**How it loops:** you watch for free and your balance **drains per second** to the creator.
When your balance runs **low**, the video pauses and your agent auto-plays a matching ad that
**earns to refill** you — then watching resumes. Balance alternates between draining (while
you watch) and refilling (while an ad plays); over time the net is **≈ 0**:

> _Your attention to ads refills the balance you spend on your creator feed._

### Target audience

- **Viewers** who are tired of being the product — they get paid for ad attention and
  pay creators directly for what they value.
- **Creators** who want per-second, no-middleman revenue tied to real watchtime.
- **Advertisers** who only pay for *proven* attention — never for an ignored impression.

### Why this is only possible on Tempo

The core mechanic is **thousands of sub-cent payments per second**, to **many
recipients simultaneously**, with **instant settlement** and **refund of unused
deposits**. That is economically impossible on general-purpose chains:

- On Ethereum/Solana, the **transaction fee alone would exceed the micro-amount**
  ($0.002/sec). You cannot pay a creator a fifth of a cent per second on-chain.
- FLOW relies on **Tempo Payment Channels** via the **Machine Payments Protocol (MPP)**:
  open a channel once, stream off-chain **vouchers** per second (no per-tx fee), settle
  on-chain only at the end, and **refund the unspent deposit** the instant you scroll away.

Tempo's payment channels + MPP are the *only* substrate where "pay-per-second-of-attention"
is economically real rather than a gimmick. This claim is the spine of the pitch.

### The one moment to show

Everything in the demo orbits a single screen: a **money-flow visualization** where you
can literally watch funds stream **out to the creator** while you watch, then **in from
the advertiser** while an ad plays — with a **net-balance meter** ticking in real time,
and **on-chain receipts** proving it was real.

See [07-demo-script.md](07-demo-script.md) and [08-pitch.md](08-pitch.md).
