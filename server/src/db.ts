/**
 * Local persistence via Node's built-in SQLite (`node:sqlite`) — no external DB
 * or Supabase needed for the demo. Stores users, clips (incl. uploaded video
 * paths), and campaigns to `server/flow.db`. Swap for Postgres/Supabase later by
 * reimplementing these functions.
 *
 * ⚠️ TESTNET ONLY — user rows include testnet private keys (local demo).
 */

import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clip, Campaign, Role } from "@flow/shared";

const dbPath = resolve(dirname(fileURLToPath(import.meta.url)), "../flow.db");
export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT, role TEXT, handle TEXT, avatar TEXT,
    address TEXT, privKey TEXT
  );
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY, title TEXT, creator TEXT, ownerId TEXT, tags TEXT,
    durationSec INTEGER, pricePerSec TEXT, recipients TEXT, hasVideo INTEGER,
    videoPath TEXT, thumb TEXT, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY, advertiser TEXT, ownerId TEXT, title TEXT, tags TEXT,
    pricePerSec TEXT, maxBudget TEXT, hasVideo INTEGER, videoPath TEXT, thumb TEXT
  );
  -- Pay-to-follow (super-follow): one row per (follower → creator) bond, with the
  -- on-chain payment that bought it. ⚠️ TESTNET pathUSD.
  CREATE TABLE IF NOT EXISTS follows (
    follower TEXT, creator TEXT, amountUsd TEXT, txHash TEXT, createdAt INTEGER,
    PRIMARY KEY (follower, creator)
  );
`);

// Migrate pre-existing DBs (added ad-video + funding columns). Each ALTER throws
// if the column already exists — ignore that.
for (const col of ["title TEXT", "hasVideo INTEGER DEFAULT 0", "videoPath TEXT", "thumb TEXT"]) {
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN ${col}`); } catch { /* already present */ }
}
// Profile columns on users (creator-platform fields). Same ignore-if-exists migrate.
for (const col of ["bio TEXT", "pic TEXT", "banner TEXT", "followPrice TEXT"]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* already present */ }
}

export interface DbUser {
  id: string;
  name: string;
  role: Role;
  handle: string;
  avatar: string; // emoji/symbol
  address: `0x${string}`;
  key: `0x${string}`;
  // ── profile (creator-platform) ──
  bio?: string;
  pic?: string;          // uploaded profile-pic filename (served at /pic/:id)
  banner?: string;       // optional banner color/gradient key
  followPrice?: string;  // USD price others pay to super-follow this user
}

// ── Users ───────────────────────────────────────────────────────────────────
export function usersCount(): number {
  return (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n as number;
}
export function usersAll(): DbUser[] {
  return (db.prepare("SELECT * FROM users").all() as any[]).map((r) => ({
    id: r.id, name: r.name, role: r.role, handle: r.handle, avatar: r.avatar,
    address: r.address, key: r.privKey,
    bio: r.bio || undefined, pic: r.pic || undefined, banner: r.banner || undefined,
    followPrice: r.followPrice || undefined,
  }));
}
export function userInsert(u: DbUser) {
  db.prepare("INSERT OR REPLACE INTO users (id,name,role,handle,avatar,address,privKey,bio,pic,banner,followPrice) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(u.id, u.name, u.role, u.handle, u.avatar, u.address, u.key,
      u.bio ?? null, u.pic ?? null, u.banner ?? null, u.followPrice ?? null);
}
/** Patch editable profile fields on an existing user (only provided keys). */
export function userUpdateProfile(id: string, p: Partial<Pick<DbUser, "name" | "handle" | "avatar" | "bio" | "pic" | "banner" | "followPrice">>) {
  const cols = Object.keys(p).filter((k) => (p as any)[k] !== undefined);
  if (!cols.length) return;
  const set = cols.map((c) => `${c}=?`).join(", ");
  db.prepare(`UPDATE users SET ${set} WHERE id=?`).run(...cols.map((c) => (p as any)[c]), id);
}

// ── Follows (pay-to-follow) ──────────────────────────────────────────────────
export interface Follow { follower: string; creator: string; amountUsd: string; txHash: string; createdAt: number }
export function followInsert(f: Follow) {
  db.prepare("INSERT OR REPLACE INTO follows (follower,creator,amountUsd,txHash,createdAt) VALUES (?,?,?,?,?)")
    .run(f.follower, f.creator, f.amountUsd, f.txHash, f.createdAt);
}
export function followRemove(follower: string, creator: string) {
  db.prepare("DELETE FROM follows WHERE follower=? AND creator=?").run(follower, creator);
}
export function isFollowing(follower: string, creator: string): boolean {
  return !!db.prepare("SELECT 1 FROM follows WHERE follower=? AND creator=?").get(follower, creator);
}
/** Follower rows for a creator (who supports them), newest first. */
export function followersOf(creator: string): Follow[] {
  return db.prepare("SELECT * FROM follows WHERE creator=? ORDER BY createdAt DESC").all(creator) as any[];
}
/** Creators a user follows, newest first. */
export function followingOf(follower: string): Follow[] {
  return db.prepare("SELECT * FROM follows WHERE follower=? ORDER BY createdAt DESC").all(follower) as any[];
}
export const followerCount = (creator: string) => (db.prepare("SELECT COUNT(*) n FROM follows WHERE creator=?").get(creator) as any).n as number;
export const followingCount = (follower: string) => (db.prepare("SELECT COUNT(*) n FROM follows WHERE follower=?").get(follower) as any).n as number;
/** Total pathUSD a creator has earned from super-follows. */
export const followEarnings = (creator: string) =>
  (db.prepare("SELECT COALESCE(SUM(CAST(amountUsd AS REAL)),0) s FROM follows WHERE creator=?").get(creator) as any).s as number;

// ── Clips ───────────────────────────────────────────────────────────────────
type ClipRow = Clip & { videoPath?: string };
function rowToClip(r: any): ClipRow {
  return {
    id: r.id, title: r.title, creator: r.creator, ownerId: r.ownerId,
    tags: JSON.parse(r.tags || "[]"), durationSec: r.durationSec,
    pricePerSec: r.pricePerSec, recipients: JSON.parse(r.recipients || "[]"),
    hasVideo: !!r.hasVideo, videoPath: r.videoPath || undefined, thumb: r.thumb || undefined,
  };
}
export function clipsCount(): number {
  return (db.prepare("SELECT COUNT(*) n FROM clips").get() as any).n as number;
}
export function clipsAll(): ClipRow[] {
  return (db.prepare("SELECT * FROM clips ORDER BY createdAt DESC").all() as any[]).map(rowToClip);
}
export function clipById(id: string): ClipRow | undefined {
  const r = db.prepare("SELECT * FROM clips WHERE id=?").get(id);
  return r ? rowToClip(r) : undefined;
}
export function clipInsert(c: ClipRow & { createdAt?: number }) {
  db.prepare(`INSERT OR REPLACE INTO clips
    (id,title,creator,ownerId,tags,durationSec,pricePerSec,recipients,hasVideo,videoPath,thumb,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.id, c.title, c.creator, c.ownerId, JSON.stringify(c.tags), c.durationSec,
      c.pricePerSec, JSON.stringify(c.recipients), c.hasVideo ? 1 : 0,
      c.videoPath ?? null, c.thumb ?? null, c.createdAt ?? Date.now());
}
/** Update a clip's price-per-second (creators can re-price anytime). */
export function clipSetPrice(id: string, pricePerSec: string) {
  db.prepare("UPDATE clips SET pricePerSec=? WHERE id=?").run(pricePerSec, id);
}

// ── Campaigns (ads) ──────────────────────────────────────────────────────────
export type CampaignRow = Campaign & { videoPath?: string };
function rowToCampaign(r: any): CampaignRow {
  return {
    id: r.id, advertiser: r.advertiser, ownerId: r.ownerId, title: r.title || undefined,
    tags: JSON.parse(r.tags || "[]"), pricePerSec: r.pricePerSec, maxBudget: r.maxBudget,
    hasVideo: !!r.hasVideo, videoPath: r.videoPath || undefined, thumb: r.thumb || undefined,
  };
}
export function campaignsCount(): number {
  return (db.prepare("SELECT COUNT(*) n FROM campaigns").get() as any).n as number;
}
export function campaignsAll(): CampaignRow[] {
  return (db.prepare("SELECT * FROM campaigns").all() as any[]).map(rowToCampaign);
}
export function campaignById(id: string): CampaignRow | undefined {
  const r = db.prepare("SELECT * FROM campaigns WHERE id=?").get(id);
  return r ? rowToCampaign(r) : undefined;
}
export function campaignInsert(c: CampaignRow) {
  db.prepare(`INSERT OR REPLACE INTO campaigns
    (id,advertiser,ownerId,title,tags,pricePerSec,maxBudget,hasVideo,videoPath,thumb)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(c.id, c.advertiser, c.ownerId, c.title ?? null, JSON.stringify(c.tags),
      c.pricePerSec, c.maxBudget, c.hasVideo ? 1 : 0, c.videoPath ?? null, c.thumb ?? null);
}
/** Raise an ad's funded budget cap (advertiser tops up funding). */
export function campaignSetBudget(id: string, maxBudget: string) {
  db.prepare("UPDATE campaigns SET maxBudget=? WHERE id=?").run(maxBudget, id);
}
