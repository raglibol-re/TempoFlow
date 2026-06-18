# 02 — MPP Integration

> **VERIFIED against the installed `mppx@0.7.0` (wevm) source + a live Tempo testnet
> run on 2026-06-18.** This supersedes the initial docs-fetch draft, which had several
> wrong signatures. Where this still says "unverified", treat the installed `.d.ts` as truth.

## Package & entry points (`mppx@0.7.0`)

- `mppx/server` — `Mppx.create`, `tempo()` method, `Store` (namespace), transports.
- `mppx/hono` — `Mppx.create` returning **Hono middleware** + `discovery()`.
- `mppx/client` — `sessionManager()`, `tempo()` client method, `Mppx.create`.
- `mppx/tempo` — `Session` namespace (precompile/protocol internals).
- Peer deps: **viem ≥ 2.51**, **hono ≥ 4.12.18**. Currency math via viem `parseUnits`.

## Currency / network constants (Tempo testnet) — VERIFIED

| Constant | Value | Source |
|---|---|---|
| chainId | **42431** (`0xa5bf`) | live `eth_chainId`; 4217 is MAINNET |
| RPC | `https://rpc.moderato.tempo.xyz` | mppx `defaults.ts`, live |
| pathUSD | `0x20c0000000000000000000000000000000000000` | `defaults.ts` |
| decimals | **6** | `defaults.ts` (all TIP-20) |
| escrow precompile | **`0x4d50500000000000000000000000000000000000`** | `Protocol.ts` (NOT the `0xe1c4…` in `defaults.ts`, which reverts — see [06](06-decisions.md) ADR-005) |

Centralized in [`shared/src/currency.ts`](../shared/src/currency.ts).

## `amount` semantics

`amount` (and `suggestedDeposit`, split amounts) are **human-decimal strings** (e.g.
`"0.002"`), scaled to raw units by `parseUnits(amount, decimals)` internally.

## Server — per-second streamed session (Direction A)

```ts
import { Mppx, tempo, Store } from "mppx/server";

const store = Store.memory(); // shared between method + metering

const mppx = Mppx.create({
  methods: [tempo({
    account,                 // viem Account: settlement signer + default recipient
    recipient: creatorAddr,
    currency: PATH_USD,
    decimals: 6,
    chainId: 42431,
    escrowContract: "0x4d50500000000000000000000000000000000000",
    store,
    getClient: () => settlementWalletClient,
    sse: { poll: true },     // poll store; mid-stream voucher POSTs are a separate request
  })],
  secretKey: process.env.MPP_SECRET_KEY,
});

// Same path serves GET (stream) and POST (open / voucher top-up management).
app.on(["GET", "POST"], "/watch/:id", async (c) => {
  const result = await mppx.session({
    amount: "0.002", currency: PATH_USD, decimals: 6,
    unitType: "second", chainId: 42431, suggestedDeposit: "0.5",
  })(c.req.raw);

  if (result.status === 402) return result.challenge;             // 402 challenge Response
  if (c.req.method === "POST") return result.withReceipt(c.json({ ok: true })); // mgmt ack

  return result.withReceipt(async function* (stream) {            // GET → metered stream
    for (let s = 1; s <= duration; s++) {
      await stream.charge();   // reserve+commit one tick; emits `payment-need-voucher` if low
      yield JSON.stringify({ second: s /* … */ });
      await sleep(1000);
    }
  });
});
```

See [`server/src/config.ts`](../server/src/config.ts) and [`server/src/index.ts`](../server/src/index.ts).

## Client — viewer session (also used by the advertiser agent in Direction B)

```ts
import { sessionManager } from "mppx/client";

const manager = sessionManager({
  account, client,           // viem account + client (RPC resolver)
  decimals: 6,
  maxDeposit: "0.5",         // local cap for auto open/top-up (human units)
  escrow: "0x4d50500000000000000000000000000000000000",
});

const stream = await manager.sse(`${SERVER}/watch/${id}`, { onReceipt: r => … });
for await (const data of stream) { /* render + animate money OUT */ }

const receipt = await manager.close(); // settle + refund unused deposit on-chain
// receipt: { channelId, spent, acceptedCumulative, txHash } (no explicit refund field;
// refund = deposit − spent, executed by the escrow on close)
```

See [`server/src/spike-client.ts`](../server/src/spike-client.ts).

## Challenge → Credential(voucher) → Receipt

1. GET with no credential → **402** + MPP challenge (price terms, recipient, currency).
2. Client opens the channel **on-chain** (escrow `open(payee, operator, token, deposit,
   salt, authorizedSigner)`) and signs an initial **voucher** (cumulative amount).
3. Server verifies, streams; per tick it commits against the authorized cumulative.
4. When the server's required cumulative exceeds the voucher, it emits
   `payment-need-voucher`; the client **POSTs a higher voucher** to the same path (off-chain,
   no tx). On `close()` the highest voucher settles to the recipient on-chain; unused
   deposit is refunded to the payer.

## Direction B (advertising) — role swap

Same machinery; the **advertiser is the client**, and `/attention/:campaignId` is a
session endpoint whose **recipient = the viewer wallet**. The handler only calls
`stream.charge()` while a valid heartbeat exists (Phase 2). See [01](01-architecture.md).

## Splits (Phase 3)

`tempo.charge` supports `splits: [{ amount, recipient, memo? }]` with **absolute
per-split amounts** (sum < total) — NOT percentages. Whether splits apply on the
per-second *session* path is still to verify (DEV-B in [06](06-decisions.md)).

## Discovery (Phase 3)

`mppx/hono` `discovery(app, mppx, { auto, path, routes, info:{title,version} })` mounts
`GET /openapi.json`. Programmatic `validate(doc)` from `mppx/discovery`; CLI
`mppx discover validate <path|url>`.

## Funding (testnet)

Faucet = unauthenticated RPC `tempo_fundAddress([address])` → array of tx hashes. Used by
[`shared/src/wallet.ts`](../shared/src/wallet.ts) + `pnpm wallets:setup`. (The `mppx
account` CLI errors `Unsupported platform: win32`.)

## Known open issue

- **DEV-I:** mid-stream voucher top-up loop stalls after tick 1 over SSE (channel opens and
  the first per-second payment settles fine). See [04](04-progress-log.md) / [06](06-decisions.md).
