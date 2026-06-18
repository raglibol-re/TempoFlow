/**
 * Multi-user registry (YouTube/Twitch-style). People watch + post; companies
 * run ads. Each user gets a funded Tempo testnet wallet. Persisted to
 * `.users.json` so wallets are stable across dev restarts (funded once).
 *
 * ⚠️ TESTNET ONLY. Keys live in .users.json (gitignored) and are exposed to the
 * local web app via /demo/users for the account switcher — fine for a demo.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createWallet, fundWallet } from "@flow/shared";

export interface DemoUser {
  id: string;
  name: string;
  kind: "person" | "company";
  handle: string;
  avatar: string;
  address: `0x${string}`;
  key: `0x${string}`;
}

const FILE = ".users.json";

const DEFS: Omit<DemoUser, "address" | "key">[] = [
  { id: "alice", name: "Alice Rivera", kind: "person", handle: "nordlys.studio", avatar: "🌌" },
  { id: "bob", name: "Bob Tan", kind: "person", handle: "neon.audio", avatar: "🎹" },
  { id: "carol", name: "Carol Nguyen", kind: "person", handle: "wander.eats", avatar: "🍜" },
  { id: "dao", name: "Deniz Yıldız", kind: "person", handle: "pixel.forge", avatar: "🎮" },
  { id: "tempo", name: "Tempo Pay", kind: "company", handle: "tempo.pay", avatar: "💸" },
  { id: "acme", name: "Acme Cloud", kind: "company", handle: "acme.cloud", avatar: "☁️" },
];

export const users: DemoUser[] = [];

export async function initUsers(): Promise<void> {
  if (existsSync(FILE)) {
    users.push(...(JSON.parse(readFileSync(FILE, "utf8")) as DemoUser[]));
    console.log(`[users] loaded ${users.length} users from ${FILE}`);
    return;
  }
  console.log(`[users] generating + funding ${DEFS.length} demo wallets…`);
  for (const d of DEFS) {
    const w = createWallet();
    try {
      await fundWallet(w.address, "5");
    } catch (e) {
      console.error(`[users] fund failed for ${d.id}:`, (e as Error).message);
    }
    users.push({ ...d, address: w.address, key: w.privateKey });
  }
  writeFileSync(FILE, JSON.stringify(users, null, 2));
  console.log(`[users] wrote ${FILE}`);
}

export const getUser = (id: string) => users.find((u) => u.id === id);
export const persons = () => users.filter((u) => u.kind === "person");
export const companies = () => users.filter((u) => u.kind === "company");

/** Public view (no private key) for general listing. */
export function publicUser(u: DemoUser) {
  const { key, ...rest } = u;
  return rest;
}
