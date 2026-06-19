import {
  ledgerBalance,
  ledgerByMetadata,
  ledgerByStripe,
  ledgerConfirmedSumByMetadata,
  ledgerForUser,
  ledgerInsert,
  ledgerSetTempoTx,
  userUpdateBilling,
  type LedgerTransaction,
} from "./db.js";
import { createInternalWalletForUser, settleAdReward, settleStreamingCharge, settleStripeTopupToTempo } from "./tempo-service.js";

export const APP_CURRENCY = "usd";

function txId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function money(n: number): string {
  if (!Number.isFinite(n)) throw new Error("invalid amount");
  return Math.max(0, +n.toFixed(6)).toFixed(6);
}

export function ensureUserBilling(userId: string) {
  return createInternalWalletForUser(userId);
}

export function getAppBalance(userId: string): number {
  const balance = ledgerBalance(userId);
  userUpdateBilling(userId, { cachedBalance: balance.toFixed(6) });
  return balance;
}

export function getLedgerSnapshot(userId: string) {
  const balance = getAppBalance(userId);
  return {
    balance,
    currency: APP_CURRENCY,
    transactions: ledgerForUser(userId).map((tx) => ({
      ...tx,
      metadata: tx.metadata ?? {},
    })),
  };
}

export function creditStripeTopup(input: {
  userId: string;
  amount: number;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  metadata?: Record<string, unknown>;
}): { inserted: boolean; transaction: LedgerTransaction } {
  const existing = ledgerByStripe(input.stripeCheckoutSessionId, input.stripePaymentIntentId);
  if (existing) return { inserted: false, transaction: existing };
  const now = Date.now();
  const tx: LedgerTransaction = {
    id: txId("lt"),
    userId: input.userId,
    type: "stripe_topup",
    amount: money(input.amount),
    currency: APP_CURRENCY,
    direction: "credit",
    status: "confirmed",
    stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? undefined,
    stripePaymentIntentId: input.stripePaymentIntentId ?? undefined,
    metadata: input.metadata ?? {},
    createdAt: now,
    confirmedAt: now,
  };
  const inserted = ledgerInsert(tx);
  if (inserted) {
    // Bridge the fiat top-up to real pathUSD on Tempo, then stamp the on-chain tx
    // onto this ledger row so the UI can show "settled on Tempo · tx 0x…".
    settleStripeTopupToTempo(input.userId, input.amount)
      .then((res) => { if (res.tempoTransactionId) ledgerSetTempoTx(tx.id, res.tempoTransactionId); })
      .catch((e) => console.error("[ledger] tempo settlement error:", (e as Error).message));
  }
  getAppBalance(input.userId);
  return { inserted, transaction: tx };
}

/** Demo faucet → spendable app credit (so you can watch without configuring Stripe).
 *  Recorded as a confirmed 'adjustment' credit. ⚠️ TESTNET / demo only. */
export function creditDemoFunds(userId: string, amount: number): { balance: number } {
  const now = Date.now();
  ledgerInsert({
    id: txId("lt"), userId, type: "adjustment", amount: money(amount), currency: APP_CURRENCY,
    direction: "credit", status: "confirmed", metadata: { source: "demo_faucet" }, createdAt: now, confirmedAt: now,
  });
  return { balance: getAppBalance(userId) };
}

export async function chargeForStreamingSeconds(userId: string, seconds: number, opts: { clipId: string; pricePerSecond: number; creatorId?: string; mppTransactionId?: string }) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const amount = +(safeSeconds * opts.pricePerSecond).toFixed(6);
  if (safeSeconds <= 0 || amount <= 0) return { ok: true, amount: 0, balance: getAppBalance(userId) };
  const balance = getAppBalance(userId);
  if (balance + 1e-9 < amount) return { ok: false, reason: "insufficient_balance", balance, amount };
  const now = Date.now();
  const tx: LedgerTransaction = {
    id: txId("lt"),
    userId,
    type: "stream_charge",
    amount: money(amount),
    currency: APP_CURRENCY,
    direction: "debit",
    status: "confirmed",
    mppTransactionId: opts.mppTransactionId,
    metadata: { clipId: opts.clipId, seconds: safeSeconds, pricePerSecond: opts.pricePerSecond, creatorId: opts.creatorId },
    createdAt: now,
    confirmedAt: now,
  };
  ledgerInsert(tx);
  await settleStreamingCharge(userId, amount);
  return { ok: true, amount, balance: getAppBalance(userId) };
}

export async function creditAdReward(userId: string, secondsWatched: number, adSessionId: string, opts: { campaignId: string; rewardPerSecond: number; advertiserId?: string; mppTransactionId?: string }) {
  if (ledgerByMetadata("ad_reward", "adSessionId", adSessionId)) {
    return { ok: true, inserted: false, amount: 0, balance: getAppBalance(userId) };
  }
  const safeSeconds = Math.max(0, Math.floor(secondsWatched));
  const amount = +(safeSeconds * opts.rewardPerSecond).toFixed(6);
  if (safeSeconds <= 0 || amount <= 0) return { ok: true, inserted: false, amount: 0, balance: getAppBalance(userId) };
  const now = Date.now();
  const tx: LedgerTransaction = {
    id: txId("lt"),
    userId,
    type: "ad_reward",
    amount: money(amount),
    currency: APP_CURRENCY,
    direction: "credit",
    status: "confirmed",
    mppTransactionId: opts.mppTransactionId,
    metadata: { adSessionId, campaignId: opts.campaignId, secondsWatched: safeSeconds, rewardPerSecond: opts.rewardPerSecond, advertiserId: opts.advertiserId },
    createdAt: now,
    confirmedAt: now,
  };
  const inserted = ledgerInsert(tx);
  if (inserted) await settleAdReward(userId, amount);
  return { ok: true, inserted, amount, balance: getAppBalance(userId) };
}

export function appSpentOnContent(contentId: string): number {
  return ledgerConfirmedSumByMetadata("ad_reward", "campaignId", contentId)
    + ledgerConfirmedSumByMetadata("stream_charge", "clipId", contentId);
}
