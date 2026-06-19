/**
 * Phase 2 spike: the ADVERTISER (payer) streams payment to a viewer's attention
 * endpoint. Heartbeats (normally from the viewer's web app) are simulated here.
 *
 * Proves the attention gate: drop heartbeats mid-stream → payment PAUSES
 * (nobody pays for ignored ads) → resume → payment continues.
 *
 * Run server first, then: pnpm --filter @flow/server spike:attention
 * Uses ADVERTISER_PRIVATE_KEY if set, else a demo advertiser from /demo/users.
 * Viewer paid defaults to DEMO_VIEWER_ID (or "vera").
 */

import "./env.js";
import { sessionManager } from "mppx/client";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TEMPO_RPC_URL, TOKEN_DECIMALS, ESCROW_CONTRACT, tempoTestnet } from "@flow/shared";

const SERVER = process.env.SERVER_URL ?? "http://localhost:3000";
const CAMPAIGN = process.env.DEMO_CAMPAIGN_ID ?? "camp-tempo";
const VIEWER = process.env.DEMO_VIEWER_ID ?? "vera";

async function advertiserKey(): Promise<`0x${string}`> {
  const envKey = process.env.ADVERTISER_PRIVATE_KEY;
  if (envKey) return envKey as `0x${string}`;
  const demo = (await fetch(`${SERVER}/demo/users`).then((r) => r.json())) as any;
  const company =
    demo.users?.find((u: any) => u.role === "advertiser" && u.id === "tempo") ??
    demo.users?.find((u: any) => u.role === "advertiser");
  if (!company?.key) throw new Error("no ADVERTISER_PRIVATE_KEY and no demo advertiser available");
  return company.key;
}

const net = async () =>
  (await fetch(`${SERVER}/net?as=${encodeURIComponent(VIEWER)}`).then((r) => r.json())) as any;

async function main() {
  const account = privateKeyToAccount(await advertiserKey());
  const client = createPublicClient({ chain: tempoTestnet as any, transport: http(TEMPO_RPC_URL) });
  const manager = sessionManager({ account, client, decimals: TOKEN_DECIMALS, maxDeposit: "0.5", escrow: ESCROW_CONTRACT });

  // Simulated viewer attention heartbeats. Open a session for the token (L3),
  // send all-true signals (L1), and auto-answer any challenge (L2) so the
  // look-away/look-back narrative below is what drives the pause/resume.
  let attention = true;
  const session = (await fetch(`${SERVER}/attention/session`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId: CAMPAIGN, viewer: VIEWER }),
  }).then((r) => r.json()).catch(() => ({}))) as { token?: string };
  const token = session.token;
  const beat = async () => {
    const res = (await fetch(`${SERVER}/heartbeat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId: CAMPAIGN, viewer: VIEWER, token, visible: true, playing: true, onScreen: true }),
    }).then((r) => r.json()).catch(() => ({}))) as { challenge?: { id: string } | null };
    if (res?.challenge) {
      await fetch(`${SERVER}/attention/answer`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId: CAMPAIGN, viewer: VIEWER, token, challengeId: res.challenge.id }),
      }).catch(() => {});
    }
  };
  const hb = setInterval(() => { if (attention) void beat(); }, 1000);
  await beat(); // prime before opening

  console.log(`[adv] ${account.address} → paying ${VIEWER} for attention`);
  const stream = await manager.sse(`${SERVER}/attention/${CAMPAIGN}/${VIEWER}`, {
    onReceipt: (r: any) => console.log("[adv] receipt spent:", r?.spent),
  });

  let ticks = 0;
  for await (const data of stream) {
    const ev = JSON.parse(data);
    console.log("[adv]", ev.type, ev.paidUsd != null ? `paidUsd=${ev.paidUsd}` : "");
    ticks++;
    if (ticks === 4) { console.log("[adv] >>> viewer looks away (heartbeats OFF)"); attention = false; }
    if (ticks === 9) { console.log("[adv] >>> viewer returns (heartbeats ON)"); attention = true; }
    if (ticks >= 13) {
      console.log("[adv] >>> campaign done → graceful stop");
      await fetch(`${SERVER}/attention/${CAMPAIGN}/${VIEWER}/stop`, { method: "POST" });
    }
  }
  clearInterval(hb);

  console.log("[adv] closing (settle to viewer + refund)…");
  const receipt: any = await manager.close();
  console.log("[adv] close receipt:", { spent: receipt?.spent, txHash: receipt?.txHash });
  console.log("[adv] viewer net:", await net());
}

main().catch((e) => {
  console.error("[adv] error:", e);
  process.exit(1);
});
