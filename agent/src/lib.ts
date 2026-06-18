/**
 * Shared agent infrastructure: spend policy, JSONL logger, MPP discovery,
 * sessionManager factory, and a generic paid-stream driver.
 *
 * ⚠️ TESTNET ONLY. See docs/03-agent.md.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { sessionManager } from "mppx/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEMPO_RPC_URL,
  TOKEN_DECIMALS,
  ESCROW_CONTRACT,
  tempoTestnet,
} from "@flow/shared";

export const SERVER = process.env.SERVER_URL ?? "http://localhost:3000";

export function requireKey(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (run \`pnpm wallets:setup\`)`);
  return v as `0x${string}`;
}

/** Minimal CLI flag parser: --key value / --key=value / --flag (boolean). */
export function flags(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (!t || !t.startsWith("--")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) {
      out[t.slice(2, eq)] = t.slice(eq + 1);
      continue;
    }
    const next = a[i + 1];
    if (next && !next.startsWith("--")) {
      out[t.slice(2)] = next;
      i++;
    } else {
      out[t.slice(2)] = true;
    }
  }
  return out;
}

// ── Spend policy (spend controls) ───────────────────────────────────────────
export class SpendPolicy {
  spent = 0;
  private window: { t: number; amt: number }[] = [];
  constructor(
    readonly totalBudget: number,
    readonly maxPerMinute: number,
  ) {}
  remaining() {
    return +(this.totalBudget - this.spent).toFixed(6);
  }
  private spentLastMinute() {
    const cutoff = Date.now() - 60_000;
    this.window = this.window.filter((w) => w.t >= cutoff);
    return this.window.reduce((s, w) => s + w.amt, 0);
  }
  /** True if `amount` may be spent without breaching total or per-minute caps. */
  allows(amount: number) {
    if (this.spent + amount > this.totalBudget + 1e-9) return false;
    if (this.spentLastMinute() + amount > this.maxPerMinute + 1e-9) return false;
    return true;
  }
  record(amount: number) {
    this.spent = +(this.spent + amount).toFixed(6);
    this.window.push({ t: Date.now(), amt: amount });
  }
}

// ── Structured logger (JSONL + console) ─────────────────────────────────────
export interface PaymentLog {
  direction: "in" | "out";
  amount: number;
  counterparty: string;
  contentId: string;
  receiptRef?: string;
}

export function makeLogger(name: string) {
  mkdirSync("logs", { recursive: true });
  const file = `logs/${name}.jsonl`;
  const write = (obj: Record<string, unknown>) =>
    appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), agent: name, ...obj }) + "\n");
  return {
    info(msg: string, extra: Record<string, unknown> = {}) {
      write({ kind: "info", msg, ...extra });
      console.log(`[${name}] ${msg}`);
    },
    payment(p: PaymentLog) {
      write({ kind: "payment", ...p });
      console.log(
        `[${name}] ${p.direction === "out" ? "▼ paid" : "▲ earned"} $${p.amount.toFixed(4)} ` +
          `${p.direction === "out" ? "→" : "←"} ${p.counterparty} (${p.contentId})`,
      );
    },
    summary(s: Record<string, unknown>) {
      write({ kind: "summary", ...s });
      console.log(`[${name}] SUMMARY`, s);
    },
  };
}
export type Logger = ReturnType<typeof makeLogger>;

// ── MPP discovery ───────────────────────────────────────────────────────────
export interface Offer {
  path: string;
  method: string;
  amount?: string; // raw units
  currency?: string;
  recipient?: string;
  intent?: string;
}

export interface DemoUser {
  id: string;
  name: string;
  kind: "person" | "company";
  handle: string;
  avatar: string;
  address: `0x${string}`;
  key: `0x${string}`;
}

/** Fetch the demo users (incl. testnet keys) so an agent can act as one. */
export async function fetchDemoUsers(): Promise<DemoUser[]> {
  const j: any = await fetch(`${SERVER}/demo/users`).then((r) => r.json());
  return j.users ?? [];
}

export async function discoverOffers(): Promise<{ serviceInfo: any; offers: Offer[] }> {
  const doc: any = await fetch(`${SERVER}/openapi.json`).then((r) => r.json());
  const offers: Offer[] = [];
  for (const [path, ops] of Object.entries<any>(doc.paths ?? {})) {
    for (const [method, op] of Object.entries<any>(ops ?? {})) {
      const list = op?.["x-payment-info"]?.offers ?? [];
      for (const o of list) offers.push({ path, method, ...o });
    }
  }
  return { serviceInfo: doc["x-service-info"], offers };
}

// ── sessionManager factory ──────────────────────────────────────────────────
export function makeManager(key: `0x${string}`) {
  const account = privateKeyToAccount(key);
  const client = createPublicClient({ chain: tempoTestnet as any, transport: http(TEMPO_RPC_URL) });
  const manager = sessionManager({
    account,
    client,
    decimals: TOKEN_DECIMALS,
    maxDeposit: "0.5",
    escrow: ESCROW_CONTRACT,
  });
  return { account, manager };
}

/**
 * Open a paid SSE session, drive it frame-by-frame, and close (settle + refund)
 * once `shouldStop` returns true. Stops gracefully via `stopUrl` so the server
 * emits its final receipt and the cooperative close settles the exact amount.
 */
export async function runPaidStream(opts: {
  manager: any;
  url: string;
  stopUrl: string;
  onFrame: (f: any) => void;
  shouldStop: () => boolean;
}): Promise<any> {
  const stream = await opts.manager.sse(opts.url);
  let stopSent = false;
  for await (const data of stream as AsyncIterable<string>) {
    let f: any;
    try {
      f = JSON.parse(data);
    } catch {
      continue;
    }
    opts.onFrame(f);
    if (!stopSent && opts.shouldStop()) {
      stopSent = true;
      await fetch(opts.stopUrl, { method: "POST" }).catch(() => {});
    }
  }
  return opts.manager.close();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
