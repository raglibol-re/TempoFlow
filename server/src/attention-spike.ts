/**
 * Phase 2 spike: the ADVERTISER (payer) streams payment to a viewer's attention
 * endpoint. Heartbeats (normally from the viewer's web app) are simulated here.
 *
 * Proves the attention gate: we drop heartbeats mid-stream → payment PAUSES
 * (nobody pays for ignored ads) → resume → payment continues.
 *
 * Run server first, then: pnpm --filter @flow/server spike:attention
 * Requires ADVERTISER_PRIVATE_KEY funded with testnet pathUSD.
 */

import "./env.js";
import { sessionManager } from "mppx/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TEMPO_RPC_URL, TOKEN_DECIMALS, ESCROW_CONTRACT, tempoTestnet } from "@flow/shared";

const SERVER = process.env.SERVER_URL ?? "http://localhost:3000";
const CAMPAIGN = "camp-tempo";

function requireKey(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (run \`pnpm wallets:setup\`)`);
  return v as `0x${string}`;
}

async function net() {
  return (await fetch(`${SERVER}/net`).then((r) => r.json())) as any;
}

async function main() {
  const account = privateKeyToAccount(requireKey("ADVERTISER_PRIVATE_KEY"));
  const client = createPublicClient({ chain: tempoTestnet as any, transport: http(TEMPO_RPC_URL) });
  const manager = sessionManager({
    account,
    client,
    decimals: TOKEN_DECIMALS,
    maxDeposit: "0.5",
    escrow: ESCROW_CONTRACT,
  });

  // Simulated viewer attention heartbeats.
  let attention = true;
  const hb = setInterval(() => {
    if (attention)
      fetch(`${SERVER}/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: CAMPAIGN }),
      }).catch(() => {});
  }, 1000);
  // prime one heartbeat before opening
  await fetch(`${SERVER}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId: CAMPAIGN }),
  });

  console.log(`[adv] advertiser ${account.address} → paying viewer for attention`);
  const stream = await manager.sse(`${SERVER}/attention/${CAMPAIGN}`, {
    onReceipt: (r: any) => console.log("[adv] receipt spent:", r?.spent),
  });

  let ticks = 0;
  for await (const data of stream) {
    const ev = JSON.parse(data);
    console.log("[adv]", ev.type, ev.paidUsd != null ? `paidUsd=${ev.paidUsd}` : "");
    ticks++;
    if (ticks === 4) {
      console.log("[adv] >>> viewer looks away (heartbeats OFF) — payment should PAUSE");
      attention = false;
    }
    if (ticks === 9) {
      console.log("[adv] >>> viewer returns (heartbeats ON) — payment should RESUME");
      attention = true;
    }
    if (ticks >= 13) {
      console.log("[adv] >>> campaign done → graceful stop");
      await fetch(`${SERVER}/attention/${CAMPAIGN}/stop`, { method: "POST" });
    }
  }
  clearInterval(hb);

  console.log("[adv] closing (settle to viewer + refund unused deposit)…");
  const receipt: any = await manager.close();
  console.log("[adv] close receipt:", {
    spent: receipt?.spent,
    txHash: receipt?.txHash,
  });
  console.log("[adv] viewer net balance:", await net());
}

main().catch((e) => {
  console.error("[adv] error:", e);
  process.exit(1);
});
