import Stripe from "stripe";
import { getUser, reloadUsers } from "./users.js";
import { userUpdateBilling } from "./db.js";
import { creditStripeTopup, ensureUserBilling } from "./app-ledger.js";

const MIN_TOPUP_USD = 5;
const MAX_TOPUP_USD = 250;
const TOPUP_PACKAGES: Record<string, number> = { "topup_5": 5, "topup_10": 10, "topup_25": 25 };

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

export function resolveTopupAmount(body: any): number {
  const fromPackage = body?.topupPackageId ? TOPUP_PACKAGES[String(body.topupPackageId)] : undefined;
  const amount = fromPackage ?? Number(body?.amount);
  if (!Number.isFinite(amount)) throw new Error("invalid amount");
  const rounded = +amount.toFixed(2);
  if (rounded < MIN_TOPUP_USD) throw new Error(`minimum top-up is ${MIN_TOPUP_USD} USD`);
  if (rounded > MAX_TOPUP_USD) throw new Error(`maximum top-up is ${MAX_TOPUP_USD} USD`);
  return rounded;
}

export async function ensureStripeCustomer(userId: string): Promise<string> {
  const user = getUser(userId);
  if (!user) throw new Error("unknown user");
  ensureUserBilling(user.id);
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const stripe = stripeClient();
  const customer = await stripe.customers.create({
    name: user.name,
    metadata: { userId: user.id },
  });
  userUpdateBilling(user.id, { stripeCustomerId: customer.id });
  reloadUsers();
  return customer.id;
}

export async function createTopupCheckoutSession(userId: string, amountUsd: number) {
  const user = getUser(userId);
  if (!user) throw new Error("unknown user");
  const stripe = stripeClient();
  const customer = await ensureStripeCustomer(user.id);
  return stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(amountUsd * 100),
        product_data: { name: `TempoFlow app credit - $${amountUsd.toFixed(2)}` },
      },
    }],
    success_url: `${appUrl()}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/?payment=cancel`,
    metadata: { userId: user.id, topupAmount: amountUsd.toFixed(2) },
    payment_intent_data: { metadata: { userId: user.id, topupAmount: amountUsd.toFixed(2) } },
  });
}

export async function syncCheckoutSession(sessionId: string, userId: string) {
  if (!/^cs_/.test(sessionId)) throw new Error("invalid checkout session");
  const user = getUser(userId);
  if (!user) throw new Error("unknown user");
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.userId !== user.id) throw new Error("checkout session does not belong to user");
  if (session.payment_status !== "paid") return { ok: true, credited: false, paymentStatus: session.payment_status };
  const amount = Number(session.metadata?.topupAmount ?? (session.amount_total ?? 0) / 100);
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const result = creditStripeTopup({
    userId: user.id,
    amount,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    metadata: { syncedFromCheckoutReturn: true, paymentStatus: session.payment_status },
  });
  return { ok: true, credited: result.inserted, transactionId: result.transaction.id };
}

export async function handleStripeWebhook(rawBody: string | Buffer, signature: string | undefined) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  if (!signature) throw new Error("missing stripe signature");
  const stripe = stripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== "paid") return { ok: true, ignored: "checkout_not_paid" };
    const userId = String(session.metadata?.userId ?? "");
    const user = getUser(userId);
    if (!user) throw new Error(`webhook user not found: ${userId}`);
    const amount = Number(session.metadata?.topupAmount ?? (session.amount_total ?? 0) / 100);
    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    const result = creditStripeTopup({
      userId,
      amount,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      metadata: { stripeEventId: event.id, paymentStatus: session.payment_status },
    });
    return { ok: true, credited: result.inserted, transactionId: result.transaction.id };
  }
  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    const userId = String(pi.metadata?.userId ?? "");
    if (!userId) return { ok: true, ignored: "payment_intent_without_user" };
    if (!getUser(userId)) throw new Error(`webhook user not found: ${userId}`);
    const amount = Number(pi.metadata?.topupAmount ?? pi.amount_received / 100);
    const result = creditStripeTopup({
      userId,
      amount,
      stripePaymentIntentId: pi.id,
      metadata: { stripeEventId: event.id },
    });
    return { ok: true, credited: result.inserted, transactionId: result.transaction.id };
  }
  if (event.type === "payment_intent.payment_failed" || event.type === "charge.refunded") {
    console.log(`[stripe] observed ${event.type}; no ledger credit created`);
    return { ok: true, ignored: event.type };
  }
  return { ok: true, ignored: event.type };
}
