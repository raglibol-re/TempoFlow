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

const VIEWER_KEY = (import.meta as any).env?.VITE_VIEWER_PRIVATE_KEY as
  | `0x${string}`
  | undefined;

export const viewerAddress = VIEWER_KEY
  ? privateKeyToAccount(VIEWER_KEY).address
  : undefined;

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

export async function fetchNet(): Promise<NetSnapshot> {
  return fetch(`${SERVER_URL}/net`).then((r) => r.json());
}

export async function resetNet(): Promise<void> {
  await fetch(`${SERVER_URL}/reset`, { method: "POST" });
}

/** Send one attention heartbeat for a campaign (tab visible + ad in viewport). */
export async function sendHeartbeat(campaignId: string): Promise<void> {
  await fetch(`${SERVER_URL}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId }),
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
  if (!VIEWER_KEY) throw new Error("VITE_VIEWER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(VIEWER_KEY);
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

  const stream = await manager.sse(`${SERVER_URL}/watch/${clip.id}`);

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
