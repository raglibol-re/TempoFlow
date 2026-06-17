# 02 — MPP Integration

> Source of truth: <https://mpp.dev/llms-full.txt> and the `/guides/*` pages.
> **If the live mppx TypeScript types differ from what's recorded here, the types win** —
> log the deviation in [06-decisions.md](06-decisions.md) and update this file.
> Signatures below were extracted from the docs on **2026-06-18** and must be
> re-verified against the installed `mppx` package before Phase 1 coding.

## Packages

- `mppx/server` — server-side payment methods + session/charge wrappers.
- `mppx/hono` — Hono adapter + `discovery()` helper.
- `mppx/client` — client session manager (used by web app **and** agents).
- `viem` — account creation/signing (`privateKeyToAccount`, `generatePrivateKey`).

## Currency / network constants (Tempo testnet)

| Constant | Value | Notes |
|---|---|---|
| chainId | `4217` | Tempo testnet (verify) |
| pathUSD (currency) | `0x20c0000000000000000000000000000000000000` | micropayment token |
| RPC URL | `TEMPO_RPC_URL` env | verify exact host in runbook |

Centralized in [`shared/src/currency.ts`](../shared/src/currency.ts).

## Server setup (extracted signatures)

```ts
import { Mppx, tempo } from "mppx/server";

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    tempo.session({
      account,                 // viem Account that signs settlements
      chainId: 4217,
      currency: "0x20c0000000000000000000000000000000000000", // pathUSD
      store: Store.memory(),   // durable store in prod
    }),
  ],
});
```

### Per-second streamed endpoint (Direction A — creator)

```ts
// Price per billable unit. For FLOW, unit = one second of watchtime.
export const GET = mppx.session({ amount: "0.002", unitType: "second" })(
  async function* () {
    for (;;) {
      await stream.charge();   // charge the viewer for this second
      yield secondTick();      // emit content frame / keep-alive
    }
  },
);
// On channel depletion the server emits `event: payment-need-voucher`;
// the client session tops up transparently.
```

> ⚠️ **To verify:** exact name/shape of the per-unit charge call (`stream.charge()`),
> whether `unitType` accepts `"second"` (docs show `"word"`), and the time-based billing
> hook (we may need a manual `setInterval` + `charge()` loop instead of a generator).

### Attention endpoint (Direction B — recipient = viewer)

Same `mppx.session(...)` wrapper, but the payment method's **recipient is the viewer's
wallet**, and the handler **only charges while a valid heartbeat exists**:

```ts
mppx.session({ amount: "0.004", unitType: "second" })(async function* () {
  for (;;) {
    if (!hasValidHeartbeat(campaignId)) { yield idle(); continue; } // do NOT charge
    await stream.charge(); // settle to the VIEWER wallet
    yield adTick();
  }
});
```

### Split payments (collab creators — Phase 3)

```ts
mppx.charge({
  amount: "0.002",
  splits: [
    { recipient: CREATOR_MAIN,   percentage: 70 },
    { recipient: CREATOR_COLLAB, percentage: 20 },
    { recipient: PLATFORM,       percentage: 10 },
  ],
});
```

> ⚠️ **To verify:** whether `splits` is supported on the *session* path (per-second) or
> only on one-time `charge`. If session-splits aren't supported, we settle per-second to
> the main creator and reconcile splits in app logic (log decision).

### Discovery

```ts
import { discovery } from "mppx/hono";
discovery(app, mppx, { auto: true, info: { title: "FLOW", version: "0.1.0" } });
// → GET /openapi.json with per-route x-payment-info.offers[] and x-service-info
// Validate: npx mppx discover validate
```

## Client session API (web app + agents)

```ts
import { tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const session = tempo.session.manager({
  account: privateKeyToAccount(privateKey),
  maxDeposit: "1",            // max pathUSD reserved per channel
  // getClient: provider.getClient   // when using an injected provider
});

// Stream (Direction A consume, or Direction B advertiser-as-client):
const stream = await session.sse(`${SERVER}/watch/${contentId}`);
for await (const chunk of stream) { /* render + animate money flow */ }

// One-shot paid request also available:
// const res = await session.fetch(url);

// Skip / done → settle on-chain + refund unused deposit:
const receipt = await session.close();
```

### Challenge → Credential → Receipt (happens transparently inside the session)

1. Server returns **402** with an `MPP` challenge (price terms, recipient).
2. Client signs a **credential** (voucher) against the challenge.
3. Server verifies + returns a **receipt** reference.
4. Within a session, steps repeat off-chain per second (no on-chain tx per voucher).

## Open questions (tracked in 06-decisions.md)

- Exact time-based billing hook for per-**second** (vs per-word) streaming.
- Session-level splits vs one-time-only splits.
- `getClient` requirement for headless agents vs raw viem account.
- Exact `mppx` package version + whether `npx skills add tempoxyz/mpp` / the MCP server
  are available in this environment (see Step 0 status in 04-progress-log.md).
