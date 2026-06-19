import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { createWallet } from "@flow/shared";
import { userInsert } from "./db.js";
import { reloadUsers } from "./users.js";
import { chargeForStreamingSeconds, creditAdReward, creditStripeTopup, getAppBalance, ensureUserBilling } from "./app-ledger.js";
import { handleStripeWebhook, resolveTopupAmount } from "./stripe.js";

process.env.STRIPE_SECRET_KEY = "sk_test_unit";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit";
process.env.APP_URL = "http://localhost:5173";

function testUser(id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  const w = createWallet();
  userInsert({
    id,
    name: "Test User",
    role: "creator",
    handle: id,
    avatar: "T",
    address: w.address,
    key: w.privateKey,
    cachedBalance: "0",
  });
  reloadUsers();
  return id;
}

function signedEvent(payload: any) {
  const body = JSON.stringify(payload);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return { body, signature };
}

test("validates top-up amount and packages server-side", () => {
  assert.equal(resolveTopupAmount({ topupPackageId: "topup_10" }), 10);
  assert.throws(() => resolveTopupAmount({ amount: 4.99 }), /minimum/);
  assert.throws(() => resolveTopupAmount({ amount: 251 }), /maximum/);
});

test("verifies Stripe webhook signature", async () => {
  const { body } = signedEvent({ id: "evt_bad", type: "payment_intent.succeeded", data: { object: { id: "pi_bad", metadata: {}, amount_received: 500 } } });
  await assert.rejects(() => handleStripeWebhook(body, "bad-signature"), /signature/i);
});

test("credits Stripe checkout webhooks idempotently", async () => {
  const userId = testUser();
  const event = {
    id: `evt_${userId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${userId}`,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 1000,
        payment_intent: `pi_${userId}`,
        metadata: { userId, topupAmount: "10.00" },
      },
    },
  };
  const { body, signature } = signedEvent(event);
  assert.equal((await handleStripeWebhook(body, signature) as any).credited, true);
  assert.equal((await handleStripeWebhook(body, signature) as any).credited, false);
  assert.equal(getAppBalance(userId), 10);
});

test("computes balance from confirmed ledger transactions", () => {
  const userId = testUser();
  creditStripeTopup({ userId, amount: 25, stripeCheckoutSessionId: `cs_balance_${userId}` });
  assert.equal(getAppBalance(userId), 25);
});

test("charges streaming seconds and blocks insufficient balance", async () => {
  const userId = testUser();
  creditStripeTopup({ userId, amount: 1, stripeCheckoutSessionId: `cs_stream_${userId}` });
  assert.deepEqual(await chargeForStreamingSeconds(userId, 2, { clipId: "clip-test", pricePerSecond: 0.25 }), { ok: true, amount: 0.5, balance: 0.5 });
  assert.equal((await chargeForStreamingSeconds(userId, 3, { clipId: "clip-test", pricePerSecond: 0.25 })).ok, false);
});

test("credits ad rewards once per ad session", async () => {
  const userId = testUser();
  const first = await creditAdReward(userId, 5, `ad-session-${userId}`, { campaignId: "camp-test", rewardPerSecond: 0.01 });
  const second = await creditAdReward(userId, 5, `ad-session-${userId}`, { campaignId: "camp-test", rewardPerSecond: 0.01 });
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(getAppBalance(userId), 0.05);
});

test("onboarding ensures internal and Tempo wallet links", () => {
  const userId = testUser();
  const wallet = ensureUserBilling(userId);
  assert.match(wallet.internalWalletId, /^iw_/);
  assert.match(wallet.tempoWalletId, /^0x[0-9a-fA-F]{40}$/);
});
