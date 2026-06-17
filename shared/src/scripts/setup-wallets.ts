/**
 * Generate + fund the three FLOW role wallets on the Tempo testnet,
 * then print .env lines to paste. Run: `pnpm wallets:setup`.
 *
 * ⚠️ TESTNET ONLY. Generates fresh ephemeral keys each run unless reused.
 */

import { createWallet, fundWallet } from "../wallet.js";

const ROLES = ["VIEWER", "CREATOR", "ADVERTISER"] as const;
const FUND_AMOUNT = "5"; // 5 pathUSD per wallet for the demo

async function main() {
  console.log("\n=== FLOW wallet setup (Tempo TESTNET) ===\n");
  const lines: string[] = [];

  for (const role of ROLES) {
    const w = createWallet();
    let fundResult: string | null = null;
    try {
      fundResult = await fundWallet(w.address, FUND_AMOUNT);
    } catch (err) {
      console.error(`  ! funding failed for ${role}:`, (err as Error).message);
    }
    console.log(`${role}: ${w.address}`);
    console.log(
      `  funding: ${fundResult ?? "SKIPPED (set FUNDING_MASTER_PRIVATE_KEY or TEMPO_FAUCET_URL)"}`,
    );
    lines.push(`${role}_PRIVATE_KEY=${w.privateKey}`);
  }

  console.log("\n--- paste into .env ---");
  console.log(lines.join("\n"));
  console.log("\nDone. Never commit these keys.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
