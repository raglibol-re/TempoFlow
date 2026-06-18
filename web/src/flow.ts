/**
 * Browser-side FLOW client (multi-user, role-based). Acts as the logged-in user,
 * paying from that user's wallet. ⚠️ TESTNET ONLY — demo keys come from the
 * server's /demo/users. Every network step is labeled so failures are precise.
 */

import { sessionManager } from "mppx/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEMPO_RPC_URL, TOKEN_DECIMALS, ESCROW_CONTRACT, tempoTestnet,
  type Clip, type Campaign, type Role,
} from "@flow/shared";

export const SERVER_URL =
  (import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3000";

export interface DemoUser {
  id: string; name: string; role: Role; handle: string; avatar: string;
  address: `0x${string}`; key: `0x${string}`;
}
export interface AdminUser extends Omit<DemoUser, "key"> { balance: number }

async function jget(path: string, label: string): Promise<any> {
  try {
    const r = await fetch(`${SERVER_URL}${path}`);
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
    return await r.json();
  } catch (e: any) { throw new Error(`${label} (${SERVER_URL}${path}): ${e?.message ?? e}`); }
}
async function jpost(path: string, body: any, label: string): Promise<any> {
  try {
    const r = await fetch(`${SERVER_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
    return await r.json();
  } catch (e: any) { throw new Error(`${label} (${SERVER_URL}${path}): ${e?.message ?? e}`); }
}

export const fetchUsers = () => jget("/demo/users", "load users").then((j) => j.users as DemoUser[]);
export const fetchFeed = () => jget("/feed", "load feed").then((j) => (j.clips ?? []) as Clip[]);
export const fetchCampaigns = () => jget("/campaigns", "load campaigns").then((j) => (j.campaigns ?? []) as Campaign[]);
export const fetchAdminUsers = () => jget("/admin/users", "load admin users").then((j) => (j.users ?? []) as AdminUser[]);
export const fundUser = (userId: string) => jpost("/demo/fund", { userId }, "get test funds");
export const createCampaign = (as: string, tags: string[]) => jpost("/campaigns", { as, tags }, "create campaign").then((j) => j.campaign as Campaign);
export const resetNet = () => jpost("/reset", {}, "reset").catch(() => {});
export const sendHeartbeat = (campaignId: string, viewer: string) => jpost("/heartbeat", { campaignId, viewer }, "heartbeat").catch(() => {});
export const runAd = (campaignId: string, viewerId: string) => jpost("/demo/run-ad", { campaignId, viewerId }, "start advertiser").catch(() => {});

export const videoSrc = (clipId: string) => `${SERVER_URL}/video/${clipId}`;

export interface NetSnapshot {
  inUsd: number; outUsd: number; netUsd: number;
  events: { id: string; direction: "in" | "out"; amount: string; counterparty: string; contentId: string }[];
}
export const fetchNet = (as: string) => jget(`/net?as=${as}`, "load balance") as Promise<NetSnapshot>;

/** Upload a clip with a real video file (multipart). */
export async function uploadClip(as: string, title: string, tags: string[], file: File, durationSec: number): Promise<Clip> {
  const fd = new FormData();
  fd.append("as", as); fd.append("title", title); fd.append("tags", tags.join(",")); fd.append("durationSec", String(durationSec));
  fd.append("video", file);
  try {
    const r = await fetch(`${SERVER_URL}/clips`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).clip as Clip;
  } catch (e: any) { throw new Error(`upload clip: ${e?.message ?? e}`); }
}

export interface Tick { second: number; spentUsd: number; creator: string; clipId: string }
export interface CloseSummary { spentUsd?: number; refundUsd?: number; txHash?: string }
export interface WatchHandle { stop: () => Promise<CloseSummary | undefined> }

function manager(user: DemoUser) {
  const account = privateKeyToAccount(user.key);
  const client = createPublicClient({ chain: tempoTestnet as any, transport: http(TEMPO_RPC_URL) });
  return sessionManager({ account, client, decimals: TOKEN_DECIMALS, maxDeposit: "0.5", escrow: ESCROW_CONTRACT });
}
const rawToUsd = (raw?: string) => (raw == null ? undefined : Number(raw) / 10 ** TOKEN_DECIMALS);

/** Watch a clip as `me`, paying its creator per second. onTick each paid second;
 *  onEnd when the stream ends (funding stopped / closed). */
export async function watchClip(clip: Clip, me: DemoUser, onTick: (t: Tick) => void, onEnd: () => void): Promise<WatchHandle> {
  const mgr = manager(me);
  let stream: AsyncIterable<string>;
  try {
    stream = await mgr.sse(`${SERVER_URL}/watch/${clip.id}?as=${me.id}`);
  } catch (e: any) {
    throw new Error(`open payment channel for "${clip.title}" failed: ${e?.message ?? e}`);
  }
  const drained = (async () => {
    for await (const data of stream) {
      try { const t = JSON.parse(data) as Tick; if (t?.second) onTick(t); } catch { /* keep-alive */ }
    }
    onEnd();
  })();
  return {
    async stop() {
      try { await fetch(`${SERVER_URL}/watch/${clip.id}/stop`, { method: "POST" }); }
      catch (e: any) { throw new Error(`stop failed: ${e?.message ?? e}`); }
      await drained;
      let receipt: any;
      try { receipt = await mgr.close(); } catch (e: any) { throw new Error(`settle/refund failed: ${e?.message ?? e}`); }
      const spentUsd = rawToUsd(receipt?.spent);
      return { spentUsd, txHash: receipt?.txHash, refundUsd: spentUsd != null ? +(0.5 - spentUsd).toFixed(6) : undefined };
    },
  };
}
