# 08 — Pitch

## One-liner
> **FLOW: the feed that pays you to watch ads, and pays creators when you watch them —
> live, per second, only possible on Tempo.**

## Problem
The attention economy is backwards. Platforms harvest your attention, sell it to advertisers,
and pay you nothing; creators get crumbs and are captive to an engagement algorithm. The money
flows the wrong way, and it's invisible.

## The reversal (our thesis)
FLOW makes money flow per second and **visible**, in two directions:
- **Watch a creator → money flows OUT**, you → creator, per second of watchtime. Scroll away,
  it stops and refunds instantly.
- **Watch an ad → money flows IN**, advertiser → you, per second — but **only for proven
  attention** (heartbeat-gated). No attention, no payment.

**Net effect:** your ad-attention finances the creators you actually want to watch — a
potentially self-sustaining feed. We proved it: autonomous agents ran the loop and the viewer
came out **net positive** (paid $0.03 to creators, earned $0.06 from ads).

## Live demo
The money-flow moment (see [07-demo-script.md](07-demo-script.md)): out to a creator with
scroll-to-refund, collab splits, then the reversal — ads paying you, gated by real attention —
and two **autonomous agents** running the whole economy on-chain.

## Why only on Tempo (the crux)
The mechanic is **thousands of sub-cent payments per second**, to **many recipients**, with
**instant settlement** and **refund of unused deposit**. On Ethereum/Solana the per-transaction
fee alone dwarfs a $0.002/sec micro-payment — it's economically impossible. FLOW streams
off-chain **vouchers** over **Tempo payment channels** (via MPP / `mppx`) and settles on-chain
only at the end. Tempo is the only substrate where pay-per-second-of-attention is real, not a
gimmick — and the agent story shows it's built for machine-to-machine commerce.

## Market
Creator economy + digital ad spend, on a fairer rail for both sides; and **agentic commerce**
(autonomous machine micropayments) as the wedge — FLOW's agents are a working example.

## Built (not slideware)
Both money directions live on Tempo testnet over MPP sessions; attention-gated ads; scroll feed
with collab splits; `/openapi.json` discovery (validated); two autonomous budgeted agents with
on-chain settlement; a real-time money-flow UI with on-chain receipts.

## Ask
[Fill in: what we want from judges / next steps — e.g. feedback, prize track, intros to
creator/ad partners, mainnet pilot.]
