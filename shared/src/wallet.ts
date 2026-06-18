/**
 * Wallet helpers for the three FLOW roles on the Tempo TESTNET.
 *
 * ⚠️ TESTNET ONLY — never use these helpers with mainnet keys or real funds.
 *
 * Funding strategy (see docs/10-runbook.md):
 *   1. If FUNDING_MASTER_PRIVATE_KEY is set → transfer pathUSD from the master
 *      wallet (most robust for an offline demo room).
 *   2. Else if TEMPO_FAUCET_URL is set → request from the public faucet.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Account,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tempoTestnet, FLOW_CURRENCY } from "./currency.js";

/** Minimal ERC-20 transfer ABI (pathUSD funding). */
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export interface FlowWallet {
  account: Account;
  privateKey: `0x${string}`;
  address: Address;
}

/** Create a fresh ephemeral testnet wallet. */
export function createWallet(): FlowWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { account, privateKey, address: account.address };
}

/** Load a wallet from an existing private key (e.g. from .env). */
export function walletFromKey(privateKey: `0x${string}`): FlowWallet {
  const account = privateKeyToAccount(privateKey);
  return { account, privateKey, address: account.address };
}

export const publicClient = createPublicClient({
  chain: tempoTestnet as any,
  transport: http(),
});

/**
 * Fund a wallet with testnet tokens (pathUSD + fee token).
 *
 * Primary path: the Tempo testnet faucet precompile via the `tempo_fundAddress`
 * RPC method (no auth, no keychain — verified working 2026-06-18). Returns the
 * funding tx hashes. Falls back to a master-wallet transfer or a faucet URL.
 *
 * `amountUsd` only applies to the master-transfer fallback; the faucet RPC funds
 * a fixed testnet allotment.
 */
export async function fundWallet(
  to: Address,
  amountUsd: string,
): Promise<string | null> {
  const masterKey = process.env.FUNDING_MASTER_PRIVATE_KEY as
    | `0x${string}`
    | undefined;
  const faucetUrl = process.env.TEMPO_FAUCET_URL;

  // Primary: Tempo testnet faucet precompile.
  try {
    const hashes = await publicClient.request({
      method: "tempo_fundAddress" as any,
      params: [to] as any,
    });
    if (Array.isArray(hashes) && hashes.length > 0) {
      return `faucet:${hashes[0]}`;
    }
  } catch (err) {
    // fall through to master / faucet-url paths
  }

  if (masterKey) {
    const master = privateKeyToAccount(masterKey);
    const wallet = createWalletClient({
      account: master,
      chain: tempoTestnet as any,
      transport: http(),
    });
    // pathUSD assumed 6 decimals (USDC-style); verify in runbook.
    const amount = parseUnits(amountUsd, 6);
    const hash = await wallet.writeContract({
      address: FLOW_CURRENCY,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, amount],
      chain: tempoTestnet as any,
    });
    return hash;
  }

  if (faucetUrl) {
    const res = await fetch(faucetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: to, amount: amountUsd }),
    });
    return `faucet:${res.status}`;
  }

  return null;
}
