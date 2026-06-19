import { createWallet, transferPathUsd, fundWallet } from "@flow/shared";
import { getUser, reloadUsers } from "./users.js";
import { userUpdateBilling } from "./db.js";

export interface InternalWallet {
  internalWalletId: string;
  tempoWalletId: string;
  address: `0x${string}`;
}

export function createInternalWalletForUser(userId: string): InternalWallet {
  const user = getUser(userId);
  if (!user) throw new Error("unknown user");
  if (user.internalWalletId && user.tempoWalletId) {
    return { internalWalletId: user.internalWalletId, tempoWalletId: user.tempoWalletId, address: user.address };
  }
  const wallet = user.address ? { address: user.address } : createWallet();
  const internalWalletId = user.internalWalletId ?? `iw_${userId}_${Date.now().toString(36)}`;
  const tempoWalletId = user.tempoWalletId ?? wallet.address;
  userUpdateBilling(userId, { internalWalletId, tempoWalletId });
  reloadUsers();
  return { internalWalletId, tempoWalletId, address: wallet.address as `0x${string}` };
}

/**
 * Settle a confirmed Stripe (fiat) top-up into REAL pathUSD on the user's Tempo
 * wallet — the fiat→stablecoin on-ramp. Stripe collects the card payment off-chain;
 * we then move the exact same amount of pathUSD on-chain so it's instantly
 * spendable per-second on creators. Treasury transfer first (exact amount); falls
 * back to the testnet faucet if no treasury is configured. ⚠️ TESTNET ONLY.
 */
export async function settleStripeTopupToTempo(userId: string, amount: number): Promise<{ status: "pending" | "confirmed"; tempoTransactionId?: string }> {
  const user = getUser(userId);
  if (!user?.address) return { status: "pending" };
  try {
    const tx = await transferPathUsd(user.address, amount.toFixed(6)); // exact amount from treasury
    if (tx) {
      console.log(`[tempo] stripe top-up settled on-chain user=${userId} amount=${amount.toFixed(2)} → ${tx}`);
      return { status: "confirmed", tempoTransactionId: tx };
    }
    const faucet = await fundWallet(user.address, amount.toFixed(6)); // fallback: testnet faucet provisions real pathUSD
    if (faucet) {
      console.log(`[tempo] stripe top-up faucet-provisioned user=${userId} ref=${faucet}`);
      return { status: "confirmed", tempoTransactionId: faucet };
    }
  } catch (e) {
    console.error(`[tempo] stripe top-up settlement failed user=${userId}:`, (e as Error).message);
  }
  return { status: "pending" };
}

export async function settleStreamingCharge(userId: string, amount: number): Promise<{ status: "confirmed"; tempoTransactionId?: string }> {
  console.log(`[tempo] stream charge accounted user=${userId} amount=${amount.toFixed(6)}`);
  return { status: "confirmed" };
}

export async function settleAdReward(userId: string, amount: number): Promise<{ status: "confirmed"; tempoTransactionId?: string }> {
  console.log(`[tempo] ad reward accounted user=${userId} amount=${amount.toFixed(6)}`);
  return { status: "confirmed" };
}
