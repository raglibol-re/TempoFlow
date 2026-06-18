/**
 * Phase 1 spike: a viewer client that watches a creator clip for ~3 seconds,
 * then "scrolls away" → close() → settlement + refund of unused deposit.
 *
 * Run the server first (`pnpm dev:server`), then `pnpm --filter @flow/server spike`.
 * Requires VIEWER_PRIVATE_KEY funded with testnet pathUSD.
 */

import "./env.js"; // must be first — loads .env before @flow/shared
import { sessionManager } from "mppx/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEMPO_RPC_URL,
  TOKEN_DECIMALS,
  ESCROW_CONTRACT,
  tempoTestnet,
} from "@flow/shared";

const SERVER = process.env.SERVER_URL ?? "http://localhost:3000";
const CLIP = "clip-aurora";

function requireKey(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (run \`pnpm wallets:setup\`)`);
  return v as `0x${string}`;
}

async function main() {
  const account = privateKeyToAccount(requireKey("VIEWER_PRIVATE_KEY"));
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

  console.log(`[spike] opening session for ${CLIP} as viewer ${account.address}`);
  const stream = await manager.sse(`${SERVER}/watch/${CLIP}`, {
    onReceipt: (r: any) => console.log("[spike] receipt spent:", r?.spent),
  });

  const WATCH_SECONDS = 4;
  let ticks = 0;
  let stopSent = false;
  for await (const data of stream) {
    console.log("[spike] tick:", data);
    ticks++;
    // "Scroll away" after WATCH_SECONDS: signal a graceful stop, then keep
    // reading so the server's final receipt syncs our state before close().
    if (ticks >= WATCH_SECONDS && !stopSent) {
      stopSent = true;
      console.log("[spike] scrolling away → graceful stop");
      await fetch(`${SERVER}/watch/${CLIP}/stop`, { method: "POST" });
    }
  }

  console.log("[spike] stream ended; closing session (settle + refund)…");
  const receipt = await manager.close();
  console.log("[spike] close receipt:", {
    channelId: receipt?.channelId,
    spent: receipt?.spent,
    acceptedCumulative: receipt?.acceptedCumulative,
    txHash: receipt?.txHash,
  });
  console.log("[spike] done. Refund = deposit − spent, settled on-chain at close.");
}

main().catch((e) => {
  console.error("[spike] error:", e);
  process.exit(1);
});
