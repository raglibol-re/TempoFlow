/**
 * Browser-side FLOW client (multi-user). Acts as a selected user (person or
 * company), paying from that user's wallet. ⚠️ TESTNET ONLY — demo keys come
 * from the server's /demo/users for the account switcher.
 *
 * Every network step is labeled so failures say WHAT failed, not just "Failed to fetch".
 */

import { sessionManager } from "mppx/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEMPO_RPC_URL,
  TOKEN_DECIMALS,
  ESCROW_CONTRACT,
  tempoTestnet,
  type Clip,
  type Campaign,
} from "@flow/shared";

export const SERVER_URL =
  (import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3000";

export interface DemoUser {
  id: string;
  name: string;
  kind: "person" | "company";
  handle: string;
  avatar: string;
  address: `0x${string}`;
  key: `0x${string}`;
}

async function getJson(path: string, label: string): Promise<any> {
  try {
    const r = await fetch(`${SERVER_URL}${path}`);
    if (!r.ok) throw new Error(`${label}: server returned ${r.status}`);
    return await r.json();
  } catch (e: any) {
    throw new Error(`${label} (${SERVER_URL}${path}): ${e?.message ?? e}`);
  }
}
async function postJson(path: string, body: any, label: string): Promise<any> {
  try {
    const r = await fetch(`${SERVER_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${label}: server returned ${r.status}`);
    return await r.json();
  } catch (e: any) {
    throw new Error(`${label} (${SERVER_URL}${path}): ${e?.message ?? e}`);
  }
}

export const fetchUsers = () => getJson("/demo/users", "load users").then((j) => j.users as DemoUser[]);
export const fetchFeed = () => getJson("/feed", "load feed").then((j) => (j.clips ?? []) as Clip[]);
export const fetchCampaigns = () => getJson("/campaigns", "load campaigns").then((j) => (j.campaigns ?? []) as Campaign[]);

export interface NetSnapshot {
  inUsd: number;
  outUsd: number;
  netUsd: number;
  events: { id: string; direction: "in" | "out"; amount: string; counterparty: string; contentId: string }[];
}
export const fetchNet = (as: string) => getJson(`/net?as=${as}`, "load balance") as Promise<NetSnapshot>;
export const resetNet = () => postJson("/reset", {}, "reset").catch(() => {});
export const sendHeartbeat = (campaignId: string, viewer: string) =>
  postJson("/heartbeat", { campaignId, viewer }, "heartbeat").catch(() => {});
export const postClip = (as: string, title: string, tags: string[], durationSec: number) =>
  postJson("/clips", { as, title, tags, durationSec }, "post clip").then((j) => j.clip as Clip);
export const createCampaign = (as: string, tags: string[]) =>
  postJson("/campaigns", { as, tags }, "create campaign").then((j) => j.campaign as Campaign);
export const runAd = (campaignId: string, viewerId: string) =>
  postJson("/demo/run-ad", { campaignId, viewerId }, "start advertiser").catch(() => {});

export interface Tick { second: number; spentUsd: number; creator: string; clipId: string }
export interface CloseSummary { channelId?: string; spentUsd?: number; refundUsd?: number; txHash?: string }
export interface WatchHandle { stop: () => Promise<CloseSummary | undefined> }

function manager(user: DemoUser) {
  const account = privateKeyToAccount(user.key);
  const client = createPublicClient({ chain: tempoTestnet as any, transport: http(TEMPO_RPC_URL) });
  return sessionManager({ account, client, decimals: TOKEN_DECIMALS, maxDeposit: "0.5", escrow: ESCROW_CONTRACT });
}

const rawToUsd = (raw?: string) => (raw == null ? undefined : Number(raw) / 10 ** TOKEN_DECIMALS);

/** Watch a clip as `me`, paying its creator per second. */
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
      try {
        const t = JSON.parse(data) as Tick;
        if (t?.second) onTick(t);
      } catch {
        /* keep-alive */
      }
    }
    onEnd();
  })();

  return {
    async stop() {
      try {
        await fetch(`${SERVER_URL}/watch/${clip.id}/stop`, { method: "POST" });
      } catch (e: any) {
        throw new Error(`stop failed: ${e?.message ?? e}`);
      }
      await drained;
      let receipt: any;
      try {
        receipt = await mgr.close();
      } catch (e: any) {
        throw new Error(`settle/refund failed: ${e?.message ?? e}`);
      }
      const spentUsd = rawToUsd(receipt?.spent);
      return {
        channelId: receipt?.channelId,
        txHash: receipt?.txHash,
        spentUsd,
        refundUsd: spentUsd != null ? +(0.5 - spentUsd).toFixed(6) : undefined,
      };
    },
  };
}
