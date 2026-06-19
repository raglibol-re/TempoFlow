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

> **Port:** the server listens on `PORT` if the host injects one (Render, Fly,
> Heroku), else `SERVER_PORT`, else `3000`, and binds `0.0.0.0`. So the same image
> runs on Railway/Render/Fly with no code change.

---

## Quick path (no deploy): tunnel your laptop — ~2 min

For a demo where you don't want to host the backend, keep it on your laptop and
expose it with a tunnel. The site then works from **any device** — but your laptop
must stay on (the backend still runs there).

1. Run the backend locally: `pnpm dev` (or `pnpm --filter @flow/server start`).
2. In another terminal, open a public tunnel to it (no account needed):
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   # or: npx ngrok http 3000
   ```
   Copy the printed HTTPS URL, e.g. `https://abc-123.trycloudflare.com`.
3. Point the deployed site at it — **either**:
   - **Per-link (no rebuild):** open your Vercel URL with `?server=` appended:
     `https://your-app.vercel.app/?server=https://abc-123.trycloudflare.com`
     The app remembers it (localStorage), so share *that* link. **— or —**
   - **Bake it in:** set `VITE_SERVER_URL` in Vercel to the tunnel URL and redeploy.

The frontend resolves the backend URL at runtime in this order:
`?server=<url>` (saved to localStorage) → previously saved value → build-time
`VITE_SERVER_URL` → `http://localhost:3000`. So `?server=` always wins and needs no
rebuild — handy for swapping between a local tunnel and a hosted backend.

---

## Which should I use?

- **Want it truly laptop-independent (always on, nothing running on your machine)?**
  → Deploy the backend to Railway/Render/Fly (top of this doc). This is the real answer.
- **Just need a quick shared demo and your laptop will be on?** → Tunnel (above).

Either way the visitor's device needs **nothing** — only a reachable backend URL.
