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
    id TEXT PRIMARY KEY, advertiser TEXT, ownerId TEXT, tags TEXT,
    pricePerSec TEXT, maxBudget TEXT
  );
`);

export interface DbUser {
  id: string;
  name: string;
  role: Role;
  handle: string;
  avatar: string;
  address: `0x${string}`;
  key: `0x${string}`;
}

// ── Users ───────────────────────────────────────────────────────────────────
export function usersCount(): number {
  return (db.prepare("SELECT COUNT(*) n FROM users").get() as any).n as number;
}
export function usersAll(): DbUser[] {
  return (db.prepare("SELECT * FROM users").all() as any[]).map((r) => ({
    id: r.id, name: r.name, role: r.role, handle: r.handle, avatar: r.avatar,
    address: r.address, key: r.privKey,
  }));
}
export function userInsert(u: DbUser) {
  db.prepare("INSERT OR REPLACE INTO users (id,name,role,handle,avatar,address,privKey) VALUES (?,?,?,?,?,?,?)")
    .run(u.id, u.name, u.role, u.handle, u.avatar, u.address, u.key);
}

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

// ── Campaigns ────────────────────────────────────────────────────────────────
function rowToCampaign(r: any): Campaign {
  return { id: r.id, advertiser: r.advertiser, ownerId: r.ownerId, tags: JSON.parse(r.tags || "[]"), pricePerSec: r.pricePerSec, maxBudget: r.maxBudget };
}
export function campaignsCount(): number {
  return (db.prepare("SELECT COUNT(*) n FROM campaigns").get() as any).n as number;
}
export function campaignsAll(): Campaign[] {
  return (db.prepare("SELECT * FROM campaigns").all() as any[]).map(rowToCampaign);
}
export function campaignById(id: string): Campaign | undefined {
  const r = db.prepare("SELECT * FROM campaigns WHERE id=?").get(id);
  return r ? rowToCampaign(r) : undefined;
}
export function campaignInsert(c: Campaign) {
  db.prepare("INSERT OR REPLACE INTO campaigns (id,advertiser,ownerId,tags,pricePerSec,maxBudget) VALUES (?,?,?,?,?,?)")
    .run(c.id, c.advertiser, c.ownerId, JSON.stringify(c.tags), c.pricePerSec, c.maxBudget);
}
