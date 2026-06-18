/**
 * User registry with distinct roles: viewer, creator, advertiser, admin.
 * Persisted in SQLite (db.ts). On first run, demo users are generated with
 * funded Tempo testnet wallets.
 *
 * ⚠️ TESTNET ONLY. Keys are stored locally and exposed to the local web app via
 * /demo/users for login — fine for a demo.
 */

import { createWallet, fundWallet } from "@flow/shared";
import { usersCount, usersAll, userInsert, type DbUser } from "./db.js";

const DEFS: Omit<DbUser, "address" | "key">[] = [
  { id: "admin", name: "Flo Admin", role: "admin", handle: "admin", avatar: "🛠️" },
  { id: "alice", name: "Alice Rivera", role: "creator", handle: "nordlys.studio", avatar: "🌌" },
  { id: "bob", name: "Bob Tan", role: "creator", handle: "neon.audio", avatar: "🎹" },
  { id: "carol", name: "Carol Nguyen", role: "creator", handle: "wander.eats", avatar: "🍜" },
  { id: "dao", name: "Deniz Yıldız", role: "creator", handle: "pixel.forge", avatar: "🎮" },
  { id: "vera", name: "Vera Holt", role: "viewer", handle: "vera", avatar: "🐧" },
  { id: "sam", name: "Sam Cole", role: "viewer", handle: "sam", avatar: "🦊" },
  { id: "tempo", name: "Tempo Pay", role: "advertiser", handle: "tempo.pay", avatar: "💸" },
  { id: "acme", name: "Acme Cloud", role: "advertiser", handle: "acme.cloud", avatar: "☁️" },
];

export let users: DbUser[] = [];

export async function initUsers(): Promise<void> {
  if (usersCount() === 0) {
    console.log(`[users] seeding + funding ${DEFS.length} demo wallets…`);
    for (const d of DEFS) {
      const w = createWallet();
      try {
        await fundWallet(w.address, "5");
      } catch (e) {
        console.error(`[users] fund failed for ${d.id}:`, (e as Error).message);
      }
      userInsert({ ...d, address: w.address, key: w.privateKey });
    }
  }
  users = usersAll();
  console.log(`[users] ${users.length} users ready`);
}

export const getUser = (id: string) => users.find((u) => u.id === id);
export const byRole = (role: string) => users.filter((u) => u.role === role);
export const reloadUsers = () => { users = usersAll(); };

export function publicUser(u: DbUser) {
  const { key, ...rest } = u;
  return rest;
}
