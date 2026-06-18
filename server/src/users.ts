/**
 * User registry with distinct roles: viewer, creator, advertiser, admin.
 * Persisted in SQLite (db.ts). On first run, demo users are generated with
 * funded Tempo testnet wallets.
 *
 * ⚠️ TESTNET ONLY. Keys are stored locally and exposed to the local web app via
 * /demo/users for login — fine for a demo.
 */

import { createWallet, fundWallet } from "@flow/shared";
import { usersCount, usersAll, userInsert, userUpdateProfile, type DbUser } from "./db.js";

const DEFS: Omit<DbUser, "address" | "key">[] = [
  { id: "admin", name: "Flo Admin", role: "admin", handle: "admin", avatar: "🛠️", bio: "Keeping TempoFlow running smoothly.", followPrice: "0" },
  { id: "alice", name: "Alice Rivera", role: "creator", handle: "nordlys.studio", avatar: "🌌", bio: "Ambient visuals & northern-lights timelapses. New drop every week. 🌌", followPrice: "0.05" },
  { id: "bob", name: "Bob Tan", role: "creator", handle: "neon.audio", avatar: "🎹", bio: "Synthwave producer. I make the soundtrack to your late nights. 🎹", followPrice: "0.08" },
  { id: "carol", name: "Carol Nguyen", role: "creator", handle: "wander.eats", avatar: "🍜", bio: "Street food adventures across Asia. Hungry yet? 🍜", followPrice: "0.04" },
  { id: "dao", name: "Deniz Yıldız", role: "creator", handle: "pixel.forge", avatar: "🎮", bio: "Indie game dev streaming the build. Pixels, bugs & boss fights. 🎮", followPrice: "0.1" },
  { id: "vera", name: "Vera Holt", role: "viewer", handle: "vera", avatar: "🐧", bio: "Here for the ambient streams and the free snacks.", followPrice: "0.02" },
  { id: "sam", name: "Sam Cole", role: "viewer", handle: "sam", avatar: "🦊", bio: "Professional lurker. Occasionally tips. 🦊", followPrice: "0.02" },
  { id: "tempo", name: "Tempo Pay", role: "advertiser", handle: "tempo.pay", avatar: "💸", bio: "Real-time payments on Tempo. We pay you to watch.", followPrice: "0" },
  { id: "acme", name: "Acme Cloud", role: "advertiser", handle: "acme.cloud", avatar: "☁️", bio: "Cloud infra for builders. ☁️", followPrice: "0" },
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
  // Backfill profile fields (bio/followPrice) for seed users on DBs created
  // before profiles existed — only fills when the user hasn't set their own.
  for (const d of DEFS) {
    const existing = usersAll().find((u) => u.id === d.id);
    if (existing && existing.followPrice == null && (d.bio || d.followPrice != null)) {
      userUpdateProfile(d.id, { bio: d.bio, followPrice: d.followPrice });
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
