/**
 * In-memory flow ledger for the viewer's NET balance (demo, single viewer).
 *
 *   net = in (from advertisers, Direction B) − out (to creators, Direction A)
 *
 * The narrative: attention to ads finances the creator feed. Persisted only in
 * memory — fine for the hackathon demo (reset on restart / via /reset).
 */

import type { FlowEvent } from "@flow/shared";

let outUsd = 0; // paid to creators
let inUsd = 0; // received from advertisers
const events: FlowEvent[] = [];
let seq = 0;

function record(
  direction: "in" | "out",
  amount: number,
  counterparty: string,
  contentId: string,
  receiptRef?: string,
) {
  events.push({
    id: `f${++seq}`,
    direction,
    amount: amount.toFixed(6),
    counterparty,
    contentId,
    timestamp: Date.now(),
    receiptRef,
  });
  if (events.length > 200) events.shift();
}

/** Viewer pays a creator (Direction A). */
export function addOut(amount: number, creator: string, clipId: string) {
  outUsd += amount;
  record("out", amount, creator, clipId);
}

/** Viewer receives from an advertiser for proven attention (Direction B). */
export function addIn(amount: number, advertiser: string, campaignId: string) {
  inUsd += amount;
  record("in", amount, advertiser, campaignId);
}

export function snapshot() {
  return {
    inUsd: +inUsd.toFixed(6),
    outUsd: +outUsd.toFixed(6),
    netUsd: +(inUsd - outUsd).toFixed(6),
    events: events.slice(-30).reverse(),
  };
}

export function reset() {
  outUsd = 0;
  inUsd = 0;
  events.length = 0;
  seq = 0;
}
