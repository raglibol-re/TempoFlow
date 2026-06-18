# FLOW backend (@flow/server) — full monorepo container.
# Node 24: `node:sqlite` is stable (no --experimental flag needed) and `npx tsx`
# is available for the advertiser subprocess that adrunner.ts spawns.
FROM node:24-slim

# pnpm via corepack
RUN corepack enable

WORKDIR /app

# Install deps using only manifests first (better layer caching).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY web/package.json web/package.json
COPY agent/package.json agent/package.json
RUN pnpm install --frozen-lockfile

# App source (web/ is unused here — it ships to Vercel — but copying it is cheap
# and keeps the workspace resolvable).
COPY . .

# server/flow.db and server/uploads/ are written at runtime. Mount a persistent
# volume at /app/server to keep them across redeploys (see DEPLOY.md).
ENV SERVER_PORT=3000
EXPOSE 3000

CMD ["pnpm", "--filter", "@flow/server", "start"]
