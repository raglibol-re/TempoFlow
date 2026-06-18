/**
 * Per-address flow ledger (multi-user). Every settled per-second payment is a
 * flow from one wallet to another. A user's view:
 *   in  = received (creator watch earnings, or viewer ad earnings)
 *   out = paid     (viewer watch spend, or company ad spend)
 *   net = in − out
 *
 * In-memory only — fine for the demo. Reset via /reset.
 */

export interface Flow {
  id: string;
  ts: number;
  fromAddr: string;
  toAddr: string;
  fromLabel: string;
  toLabel: string;
  amount: number;
  contentId: string;
}

const flows: Flow[] = [];
let seq = 0;

export function record(f: Omit<Flow, "id" | "ts">) {
  flows.push({ ...f, id: `f${++seq}`, ts: Date.now() });
  if (flows.length > 2000) flows.shift();
}

const lc = (s: string) => s.toLowerCase();

/** Net view for one address, or global totals if no address given. */
export function snapshot(address?: string) {
  if (!address) {
    const inUsd = flows.reduce((s, f) => s + f.amount, 0);
    return { inUsd: +inUsd.toFixed(6), outUsd: +inUsd.toFixed(6), netUsd: 0, events: view(flows.slice(-30).reverse()) };
  }
  const a = lc(address);
  let inUsd = 0;
  let outUsd = 0;
  const mine: Flow[] = [];
  for (const f of flows) {
    if (lc(f.toAddr) === a) {
      inUsd += f.amount;
      mine.push(f);
    } else if (lc(f.fromAddr) === a) {
      outUsd += f.amount;
      mine.push(f);
    }
  }
  return {
    inUsd: +inUsd.toFixed(6),
    outUsd: +outUsd.toFixed(6),
    netUsd: +(inUsd - outUsd).toFixed(6),
    events: mine
      .slice(-30)
      .reverse()
      .map((f) => ({
        id: f.id,
        direction: lc(f.toAddr) === a ? ("in" as const) : ("out" as const),
        amount: f.amount.toFixed(6),
        counterparty: lc(f.toAddr) === a ? f.fromLabel : f.toLabel,
        contentId: f.contentId,
      })),
  };
}

function view(fs: Flow[]) {
  return fs.map((f) => ({
    id: f.id,
    direction: "in" as const,
    amount: f.amount.toFixed(6),
    counterparty: `${f.fromLabel} → ${f.toLabel}`,
    contentId: f.contentId,
  }));
}

export function reset() {
  flows.length = 0;
  seq = 0;
}
