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
    address TEXT, privKey TEXT,
    stripeCustomerId TEXT, internalWalletId TEXT, tempoWalletId TEXT,
    cachedBalance TEXT DEFAULT '0'
  );
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY, title TEXT, creator TEXT, ownerId TEXT, tags TEXT,
    durationSec INTEGER, pricePerSec TEXT, recipients TEXT, hasVideo INTEGER,
    videoPath TEXT, thumb TEXT, createdAt INTEGER, live INTEGER DEFAULT 0
  );
  -- Creator funding goals + their escrowed pledges (trustless crowdfund).
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY, creatorId TEXT, creator TEXT, title TEXT,
    targetUsd TEXT, deadline INTEGER, status TEXT, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS pledges (
    id TEXT PRIMARY KEY, goalId TEXT, backerId TEXT, amountUsd TEXT,
    status TEXT, createdAt INTEGER  -- status: escrowed | captured | refunded
  );
  CREATE INDEX IF NOT EXISTS idx_pledges_goal ON pledges(goalId);
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
  CREATE TABLE IF NOT EXISTS ledger_transactions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('stripe_topup','stream_charge','ad_reward','adjustment','tempo_settlement','refund')),
    amount TEXT NOT NULL,
    currency TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
    status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed','reversed')),
    stripePaymentIntentId TEXT,
    stripeCheckoutSessionId TEXT,
    tempoTransactionId TEXT,
    mppTransactionId TEXT,
    metadata TEXT,
    createdAt INTEGER NOT NULL,
    confirmedAt INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_stripe_session
    ON ledger_transactions(stripeCheckoutSessionId)
    WHERE stripeCheckoutSessionId IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_stripe_payment_intent
    ON ledger_transactions(stripePaymentIntentId)
    WHERE stripePaymentIntentId IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_ledger_user_status ON ledger_transactions(userId, status);
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
for (const col of ["stripeCustomerId TEXT", "internalWalletId TEXT", "tempoWalletId TEXT", "cachedBalance TEXT DEFAULT '0'"]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* already present */ }
}
// `live` flag on pre-existing clip tables.
try { db.exec(`ALTER TABLE clips ADD COLUMN live INTEGER DEFAULT 0`); } catch { /* already present */ }

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
  stripeCustomerId?: string;
  internalWalletId?: string;
  tempoWalletId?: string;
  cachedBalance?: string;
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
    stripeCustomerId: r.stripeCustomerId || undefined,
    internalWalletId: r.internalWalletId || undefined,
    tempoWalletId: r.tempoWalletId || undefined,
    cachedBalance: r.cachedBalance || "0",
  }));
}
export function userInsert(u: DbUser) {
  db.prepare(`INSERT OR REPLACE INTO users
    (id,name,role,handle,avatar,address,privKey,bio,pic,banner,followPrice,stripeCustomerId,internalWalletId,tempoWalletId,cachedBalance)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(u.id, u.name, u.role, u.handle, u.avatar, u.address, u.key,
      u.bio ?? null, u.pic ?? null, u.banner ?? null, u.followPrice ?? null,
      u.stripeCustomerId ?? null, u.internalWalletId ?? null, u.tempoWalletId ?? null,
      u.cachedBalance ?? "0");
}
/** Patch editable profile fields on an existing user (only provided keys). */
export function userUpdateProfile(id: string, p: Partial<Pick<DbUser, "name" | "handle" | "avatar" | "bio" | "pic" | "banner" | "followPrice">>) {
  const cols = Object.keys(p).filter((k) => (p as any)[k] !== undefined);
  if (!cols.length) return;
  const set = cols.map((c) => `${c}=?`).join(", ");
  db.prepare(`UPDATE users SET ${set} WHERE id=?`).run(...cols.map((c) => (p as any)[c]), id);
}
export function userUpdateBilling(id: string, p: Partial<Pick<DbUser, "stripeCustomerId" | "internalWalletId" | "tempoWalletId" | "cachedBalance">>) {
  const cols = Object.keys(p).filter((k) => (p as any)[k] !== undefined);
  if (!cols.length) return;
  const set = cols.map((c) => `${c}=?`).join(", ");
  db.prepare(`UPDATE users SET ${set} WHERE id=?`).run(...cols.map((c) => (p as any)[c]), id);
}

// ── App ledger ──────────────────────────────────────────────────────────────
export type LedgerType = "stripe_topup" | "stream_charge" | "ad_reward" | "adjustment" | "tempo_settlement" | "refund";
export type LedgerDirection = "credit" | "debit";
export type LedgerStatus = "pending" | "confirmed" | "failed" | "reversed";
export interface LedgerTransaction {
  id: string;
  userId: string;
  type: LedgerType;
  amount: string;
  currency: string;
  direction: LedgerDirection;
  status: LedgerStatus;
  stripePaymentIntentId?: string;
  stripeCheckoutSessionId?: string;
  tempoTransactionId?: string;
  mppTransactionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  confirmedAt?: number;
}
const rowToLedger = (r: any): LedgerTransaction => ({
  id: r.id,
  userId: r.userId,
  type: r.type,
  amount: r.amount,
  currency: r.currency,
  direction: r.direction,
  status: r.status,
  stripePaymentIntentId: r.stripePaymentIntentId || undefined,
  stripeCheckoutSessionId: r.stripeCheckoutSessionId || undefined,
  tempoTransactionId: r.tempoTransactionId || undefined,
  mppTransactionId: r.mppTransactionId || undefined,
  metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
  createdAt: r.createdAt,
  confirmedAt: r.confirmedAt || undefined,
});
export function ledgerInsert(tx: LedgerTransaction): boolean {
  const res = db.prepare(`INSERT OR IGNORE INTO ledger_transactions
    (id,userId,type,amount,currency,direction,status,stripePaymentIntentId,stripeCheckoutSessionId,tempoTransactionId,mppTransactionId,metadata,createdAt,confirmedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tx.id, tx.userId, tx.type, tx.amount, tx.currency, tx.direction, tx.status,
      tx.stripePaymentIntentId ?? null, tx.stripeCheckoutSessionId ?? null,
      tx.tempoTransactionId ?? null, tx.mppTransactionId ?? null,
      tx.metadata ? JSON.stringify(tx.metadata) : null, tx.createdAt, tx.confirmedAt ?? null);
  return res.changes > 0;
}
/** Record the on-chain Tempo settlement tx hash on a ledger row (e.g. after a
 *  Stripe top-up is bridged to pathUSD). */
export function ledgerSetTempoTx(id: string, tempoTransactionId: string): void {
  db.prepare("UPDATE ledger_transactions SET tempoTransactionId=? WHERE id=?").run(tempoTransactionId, id);
}
export function ledgerByStripe(sessionId?: string | null, paymentIntentId?: string | null): LedgerTransaction | undefined {
  const r = sessionId
    ? db.prepare("SELECT * FROM ledger_transactions WHERE stripeCheckoutSessionId=?").get(sessionId)
    : paymentIntentId
      ? db.prepare("SELECT * FROM ledger_transactions WHERE stripePaymentIntentId=?").get(paymentIntentId)
      : undefined;
  return r ? rowToLedger(r) : undefined;
}
export function ledgerByMetadata(type: LedgerType, key: string, value: string): LedgerTransaction | undefined {
  const rows = db.prepare("SELECT * FROM ledger_transactions WHERE type=? ORDER BY createdAt DESC").all(type) as any[];
  const found = rows.find((r) => {
    try { return JSON.parse(r.metadata || "{}")?.[key] === value; } catch { return false; }
  });
  return found ? rowToLedger(found) : undefined;
}
export function ledgerForUser(userId: string, limit = 30): LedgerTransaction[] {
  return (db.prepare("SELECT * FROM ledger_transactions WHERE userId=? ORDER BY createdAt DESC LIMIT ?").all(userId, limit) as any[]).map(rowToLedger);
}
export function ledgerBalance(userId: string): number {
  const rows = db.prepare("SELECT amount,direction FROM ledger_transactions WHERE userId=? AND status='confirmed'").all(userId) as any[];
  const balance = rows.reduce((sum, r) => sum + (r.direction === "credit" ? Number(r.amount) : -Number(r.amount)), 0);
  return +balance.toFixed(6);
}
export function ledgerConfirmedSumByMetadata(type: LedgerType, key: string, value: string): number {
  const rows = db.prepare("SELECT amount,metadata FROM ledger_transactions WHERE type=? AND status='confirmed'").all(type) as any[];
  const total = rows.reduce((sum, r) => {
    try { return JSON.parse(r.metadata || "{}")?.[key] === value ? sum + Number(r.amount) : sum; }
    catch { return sum; }
  }, 0);
  return +total.toFixed(6);
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
    live: !!r.live,
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
    (id,title,creator,ownerId,tags,durationSec,pricePerSec,recipients,hasVideo,videoPath,thumb,createdAt,live)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.id, c.title, c.creator, c.ownerId, JSON.stringify(c.tags), c.durationSec,
      c.pricePerSec, JSON.stringify(c.recipients), c.hasVideo ? 1 : 0,
      c.videoPath ?? null, c.thumb ?? null, c.createdAt ?? Date.now(), c.live ? 1 : 0);
}
/** Update a clip's price-per-second (creators can re-price anytime). */
export function clipSetPrice(id: string, pricePerSec: string) {
  db.prepare("UPDATE clips SET pricePerSec=? WHERE id=?").run(pricePerSec, id);
}
/** Flip a clip's LIVE flag (creator goes live / ends the stream). */
export function clipSetLive(id: string, live: boolean) {
  db.prepare("UPDATE clips SET live=? WHERE id=?").run(live ? 1 : 0, id);
}
export function clipSetVideo(id: string, videoPath: string, thumb?: string) {
  db.prepare("UPDATE clips SET hasVideo=1, videoPath=?, thumb=COALESCE(?, thumb) WHERE id=?").run(videoPath, thumb ?? null, id);
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
export function campaignSetVideo(id: string, videoPath: string, thumb?: string) {
  db.prepare("UPDATE campaigns SET hasVideo=1, videoPath=?, thumb=COALESCE(?, thumb) WHERE id=?").run(videoPath, thumb ?? null, id);
}

// ── Goals + pledges (crowdfund escrow) ───────────────────────────────────────
export interface GoalRow { id: string; creatorId: string; creator: string; title: string; targetUsd: string; deadline: number; status: "active" | "funded" | "expired"; createdAt: number }
export interface PledgeRow { id: string; goalId: string; backerId: string; amountUsd: string; status: "escrowed" | "captured" | "refunded"; createdAt: number }
export function goalInsert(g: GoalRow) {
  db.prepare("INSERT OR REPLACE INTO goals (id,creatorId,creator,title,targetUsd,deadline,status,createdAt) VALUES (?,?,?,?,?,?,?,?)")
    .run(g.id, g.creatorId, g.creator, g.title, g.targetUsd, g.deadline, g.status, g.createdAt);
}
export const goalById = (id: string): GoalRow | undefined => (db.prepare("SELECT * FROM goals WHERE id=?").get(id) as any) || undefined;
export const goalsByCreator = (creatorId: string): GoalRow[] => db.prepare("SELECT * FROM goals WHERE creatorId=? ORDER BY createdAt DESC").all(creatorId) as any[];
export const goalsAll = (): GoalRow[] => db.prepare("SELECT * FROM goals ORDER BY createdAt DESC").all() as any[];
export const goalSetStatus = (id: string, status: GoalRow["status"]) => db.prepare("UPDATE goals SET status=? WHERE id=?").run(status, id);
export function pledgeInsert(p: PledgeRow) {
  db.prepare("INSERT OR REPLACE INTO pledges (id,goalId,backerId,amountUsd,status,createdAt) VALUES (?,?,?,?,?,?)")
    .run(p.id, p.goalId, p.backerId, p.amountUsd, p.status, p.createdAt);
}
export const pledgesForGoal = (goalId: string): PledgeRow[] => db.prepare("SELECT * FROM pledges WHERE goalId=? ORDER BY createdAt DESC").all(goalId) as any[];
export const pledgeSetStatus = (id: string, status: PledgeRow["status"]) => db.prepare("UPDATE pledges SET status=? WHERE id=?").run(status, id);
/** Sum of currently-escrowed (or already-captured) pledges toward a goal. */
export const goalPledgedUsd = (goalId: string): number =>
  +((db.prepare("SELECT COALESCE(SUM(CAST(amountUsd AS REAL)),0) s FROM pledges WHERE goalId=? AND status IN ('escrowed','captured')").get(goalId) as any).s as number).toFixed(6);
export const goalBackerCount = (goalId: string): number =>
  (db.prepare("SELECT COUNT(DISTINCT backerId) n FROM pledges WHERE goalId=? AND status IN ('escrowed','captured')").get(goalId) as any).n as number;
export const viewerPledgedUsd = (goalId: string, backerId: string): number =>
  +((db.prepare("SELECT COALESCE(SUM(CAST(amountUsd AS REAL)),0) s FROM pledges WHERE goalId=? AND backerId=? AND status IN ('escrowed','captured')").get(goalId, backerId) as any).s as number).toFixed(6);
