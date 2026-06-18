/**
 * Approve the Tempo session escrow to pull pathUSD from the payer wallets.
 *
 * mppx's session client opens a channel via the escrow's `transferFrom`, which
 * requires a prior ERC-20 allowance. This sets a max allowance once per payer
 * (VIEWER for Direction A, ADVERTISER for Direction B).
 *
 * ⚠️ TESTNET ONLY. Run after `pnpm wallets:setup`:
 *   tsx src/scripts/approve-escrow.ts
 */

import { createWalletClient, http, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEMPO_RPC_URL,
  FLOW_CURRENCY,
  ESCROW_CONTRACT,
  tempoTestnet,
} from "../currency.js";

const APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const PAYER_ROLES = ["VIEWER", "ADVERTISER"] as const;

async function approveFor(role: string) {
  const key = process.env[`${role}_PRIVATE_KEY`] as `0x${string}` | undefined;
  if (!key) {
    console.log(`${role}: no key in env, skipping`);
    return;
  }
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({
    account,
    chain: tempoTestnet as any,
    transport: http(TEMPO_RPC_URL),
  });
  const hash = await wallet.writeContract({
    address: FLOW_CURRENCY,
    abi: APPROVE_ABI,
    functionName: "approve",
    args: [ESCROW_CONTRACT, maxUint256],
    chain: tempoTestnet as any,
  });
  console.log(`${role} (${account.address}) approved escrow — tx ${hash}`);
}

async function main() {
  console.log("\n=== Approve session escrow (Tempo TESTNET) ===\n");
  for (const role of PAYER_ROLES) await approveFor(role);
  console.log("\nDone.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
