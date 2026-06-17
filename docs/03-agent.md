# 03 — Agents (Phase 4)

Two headless TypeScript agents on `mppx/client`, each with a spend policy, CLI-driven.
They demonstrate Tempo's "agentic payments" story.

> Status: **design** (scaffold only in Phase 0). Implementation in Phase 4.

## Shared requirements

- **Spend controls:** `maxPerSession`, `maxPerMinute`, `totalBudget` (USD). Hard stop at
  limit; always `session.close()` on stop. Modeled on Tempo wallet spend-controls.
- **Structured logs:** every payment → `{ ts, direction, amount, counterparty, contentId,
  receiptRef }` as JSONL.
- **Config:** `agent.config.ts` / JSON; CLI flags override.

## 3.1 Curator agent — pays creators, earns from ads

Budget + topic preferences. Loop:
1. Fetch the feed via discovery (`/openapi.json`).
2. Pick creator content by preference; "watch" it (open session, pay/sec, actually
   consume/summarize — consumption *is* the attention proof).
3. "Watch" ads to earn (process ad content → real heartbeat/proof; no fake watchtime).
4. Respect **net** budget; stop cleanly at limit.

**Wow demo build:** start Thursday, show Saturday — _"this agent has run autonomously for
48h, paid X to creators, earned Y from ads, net Z."_

## 3.2 Advertiser agent — pays viewers for attention

Campaign budget + targeting policy. Loop:
1. Find active viewer/attention sessions via discovery.
2. Decide whose attention is worth paying for.
3. Stream payment/sec to the attention endpoint **while heartbeats are valid**.
4. Stop at budget end / when attention drops.

## Config reference (draft)

```ts
export interface AgentConfig {
  role: "curator" | "advertiser";
  privateKey: `0x${string}`;       // testnet
  serverUrl: string;
  preferences?: { tags: string[] };
  spend: { maxPerSessionUsd: string; maxPerMinuteUsd: string; totalBudgetUsd: string };
}
```
