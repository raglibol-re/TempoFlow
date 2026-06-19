# Deploying FLOW

FLOW is split into two deployables:

| Part | Stack | Host | Why |
|------|-------|------|-----|
| `@flow/web` | Vite + React (static) | **Vercel** | Pure static build. |
| `@flow/server` | Hono + `node:sqlite` + spawns the agent subprocess + in-memory MPP channel state | **Railway** (or any always-on container host) | Needs a persistent process + disk; Vercel serverless can't hold SQLite, uploads, or warm channel state. |

The frontend bakes the backend URL in **at build time** (`VITE_SERVER_URL`), so the
backend must be live **before** the frontend is deployed.

---

## 1. Backend → Railway

A `Dockerfile` (Node 24, full monorepo) is included at the repo root.

1. Push this repo to GitHub (if not already).
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → pick this repo.
   Railway auto-detects the `Dockerfile`.
3. Under the service → **Variables**, set (testnet only — never mainnet keys):
   ```
   TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz
   TEMPO_CHAIN_ID=42431
   FLOW_CURRENCY=0x20c0000000000000000000000000000000000000
   TEMPO_ESCROW_CONTRACT=0x4d50500000000000000000000000000000000000
   MPP_SECRET_KEY=<your mpp secret>
   CREATOR_PRIVATE_KEY=<0x…>      # required — server won't boot without it
   VIEWER_PRIVATE_KEY=<0x…>
   ADVERTISER_PRIVATE_KEY=<0x…>
   FUNDING_MASTER_PRIVATE_KEY=<0x…>   # optional (faucet/funding)
   PRICE_CREATOR_PER_SEC=0.002
   PRICE_ATTENTION_PER_SEC=0.004
   SERVER_PORT=3000
   ```
4. Service → **Settings → Networking → Generate Domain** (port `3000`). Copy the
   public URL, e.g. `https://flow-server-production.up.railway.app`.
5. *(Optional, for persistence across redeploys)* Add a **Volume** mounted at
   `/app/server` so `flow.db` and `uploads/` survive. Without it, data resets on
   each redeploy — fine for a demo. **In-memory MPP channel state always resets on
   redeploy/restart** regardless of the volume, so avoid redeploying mid-demo.

## 2. Frontend → Vercel

`vercel.json` at the repo root already configures the monorepo build
(`pnpm --filter @flow/web build` → `web/dist`).

1. Set the env var **`VITE_SERVER_URL`** = the Railway URL from step 1.4
   (Vercel project → Settings → Environment Variables, all environments).
2. Deploy. The build reads `VITE_SERVER_URL` and the SPA talks to the Railway backend.

> CORS is already handled — the server reflects the request `Origin`, so the
> Vercel domain works without extra config.

## Stripe app credit

Stripe keys are server-only. Do not add them to Vercel frontend variables.

Backend env vars:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=https://your-vercel-app.vercel.app
```

Local webhook test:

```
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger checkout.session.completed
```

The app creates checkout sessions at
`POST /api/stripe/create-topup-checkout-session`. Credit is added only after
`/api/stripe/webhook` verifies Stripe's signature and writes a confirmed
`stripe_topup` ledger transaction. Duplicate Stripe sessions/payment intents are
ignored by unique ledger indexes.
