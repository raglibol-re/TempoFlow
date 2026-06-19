import { createWallet } from "@flow/shared";
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

export async function settleStripeTopupToTempo(userId: string, amount: number): Promise<{ status: "pending" | "confirmed"; tempoTransactionId?: string }> {
  console.log(`[tempo] stripe topup settlement queued user=${userId} amount=${amount.toFixed(6)}`);
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
