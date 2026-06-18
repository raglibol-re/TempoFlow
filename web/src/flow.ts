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

<<<<<<< HEAD
export interface DemoUser {
  id: string;
  name: string;
  kind: "person" | "company";
  handle: string;
  avatar: string;
  address: `0x${string}`;
  key: `0x${string}`;
=======
const ENV_VIEWER_KEY = (import.meta as any).env?.VITE_VIEWER_PRIVATE_KEY as
  | `0x${string}`
  | undefined;
const ENV_VIEWER_ID = (import.meta as any).env?.VITE_VIEWER_ID as string | undefined;

export interface ViewerInfo {
  id: string;
  name: string;
  handle: string;
  address: `0x${string}`;
  key: `0x${string}`;
}

let viewerPromise: Promise<ViewerInfo> | null = null;

export async function getViewerInfo(): Promise<ViewerInfo> {
  if (viewerPromise) return viewerPromise;
  viewerPromise = (async () => {
    if (ENV_VIEWER_KEY) {
      const account = privateKeyToAccount(ENV_VIEWER_KEY);
      return {
        id: ENV_VIEWER_ID ?? "viewer",
        name: "Demo Viewer",
        handle: "demo.viewer",
        address: account.address,
        key: ENV_VIEWER_KEY,
      };
    }

    const res = await fetch(`${SERVER_URL}/demo/users`);
    const json = await res.json();
    const viewer = json.users?.find((u: ViewerInfo & { kind?: string }) => u.kind === "person") ?? json.users?.[0];
    if (!viewer?.key) throw new Error("No demo viewer available. Start the server or set VITE_VIEWER_PRIVATE_KEY.");
    return viewer;
  })();
  return viewerPromise;
}

export async function fetchFeed(): Promise<Clip[]> {
  const res = await fetch(`${SERVER_URL}/feed`);
  const json = await res.json();
  return json.clips ?? [];
>>>>>>> dc9e8e82335de8be6e45fd6c2aa36b73d8da4635
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

<<<<<<< HEAD
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
=======
export async function fetchNet(address?: string): Promise<NetSnapshot> {
  const q = address ? `?address=${encodeURIComponent(address)}` : "";
  return fetch(`${SERVER_URL}/net${q}`).then((r) => r.json());
}

export async function resetNet(): Promise<void> {
  await fetch(`${SERVER_URL}/reset`, { method: "POST" });
}

/** Send one attention heartbeat for a campaign (tab visible + ad in viewport). */
export async function sendHeartbeat(campaignId: string): Promise<void> {
  const viewer = await getViewerInfo().catch(() => undefined);
  await fetch(`${SERVER_URL}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, viewer: viewer?.id }),
  }).catch(() => {});
}

export interface WatchHandle {
  stop: () => Promise<CloseSummary | undefined>;
}

export interface Tick {
  second: number;
  spentUsd: number;
  creator: string;
  clipId: string;
}

export interface CloseSummary {
  channelId?: string;
  spentRaw?: string;
  txHash?: string;
  refundUsd?: number;
  spentUsd?: number;
}

function rawToUsd(raw?: string): number | undefined {
  if (raw == null) return undefined;
  return Number(raw) / 10 ** TOKEN_DECIMALS;
}

/**
 * Start watching a clip. Calls `onTick` each paid second. Returns a handle
 * whose `stop()` performs a graceful stop + cooperative close (settle + refund).
 */
export async function watchClip(
  clip: Clip,
  onTick: (t: Tick) => void,
  onEnd: () => void,
): Promise<WatchHandle> {
  const viewer = await getViewerInfo();
  const account = privateKeyToAccount(viewer.key);
  const client = createPublicClient({
    chain: tempoTestnet as any,
    transport: http(TEMPO_RPC_URL),
  });

  const manager = sessionManager({
    account,
    client,
    decimals: TOKEN_DECIMALS,
    maxDeposit: "0.5",
    escrow: ESCROW_CONTRACT,
  });

  const stream = await manager.sse(`${SERVER_URL}/watch/${clip.id}?as=${encodeURIComponent(viewer.id)}`);

  // Drive the stream in the background; resolve close on graceful end.
>>>>>>> dc9e8e82335de8be6e45fd6c2aa36b73d8da4635
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
