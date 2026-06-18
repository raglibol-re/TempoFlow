/**
 * Browser-side FLOW client (Direction A — Viewer → Creator).
 *
 * ⚠️ TESTNET ONLY. The viewer key is bundled client-side for the demo.
 * Opens an mppx payment channel, streams a clip while paying per second,
 * and closes (settle + refund) on skip.
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
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await fetch(`${SERVER_URL}/campaigns`);
  const json = await res.json();
  return json.campaigns ?? [];
}

export interface NetSnapshot {
  inUsd: number;
  outUsd: number;
  netUsd: number;
  events: {
    id: string;
    direction: "in" | "out";
    amount: string;
    counterparty: string;
    contentId: string;
  }[];
}

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
  const drained = (async () => {
    for await (const data of stream) {
      try {
        const t = JSON.parse(data) as Tick;
        if (t?.second) onTick(t);
      } catch {
        /* ignore non-JSON keep-alives */
      }
    }
    onEnd();
  })();

  return {
    async stop() {
      // Graceful stop → server ends the stream → final receipt syncs state.
      await fetch(`${SERVER_URL}/watch/${clip.id}/stop`, { method: "POST" });
      await drained; // wait for the stream to finish + receipt applied
      const receipt: any = await manager.close();
      const spentUsd = rawToUsd(receipt?.spent);
      const depositUsd = 0.5; // suggestedDeposit
      return {
        channelId: receipt?.channelId,
        spentRaw: receipt?.spent,
        txHash: receipt?.txHash,
        spentUsd,
        refundUsd:
          spentUsd != null ? +(depositUsd - spentUsd).toFixed(6) : undefined,
      };
    },
  };
}
