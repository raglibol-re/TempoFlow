/**
 * FLOW server payment configuration (Direction A — Viewer → Creator).
 *
 * Wires a single mppx instance with the Tempo `session` method, a shared
 * in-memory ChannelStore (used by BOTH the session middleware and Sse.serve),
 * and a viem wallet client that signs on-chain settlement as the creator/payee.
 *
 * Verified against mppx@0.7.0 (see docs/02-mpp-integration.md).
 */

import { Mppx, tempo, Store } from "mppx/server";
import { createWalletClient, http, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TEMPO_CHAIN_ID,
  TEMPO_RPC_URL,
  FLOW_CURRENCY,
  TOKEN_DECIMALS,
  ESCROW_CONTRACT,
  tempoTestnet,
} from "@flow/shared";

function requireKey(name: string): `0x${string}` {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (run \`pnpm wallets:setup\`)`);
  return v as `0x${string}`;
}

/**
 * The server settlement account. Signs on-chain settlement for BOTH directions:
 *   - Direction A (/watch): it IS the creator/payee.
 *   - Direction B (/attention): it acts as the channel OPERATOR so it can settle
 *     to the viewer (the payee) without holding the viewer's key.
 */
export const creatorAccount: Account = privateKeyToAccount(
  requireKey("CREATOR_PRIVATE_KEY"),
);

/**
 * Address used as the channel OPERATOR for all settlements. Because the server
 * settles as operator, it can pay out to ANY recipient wallet (any creator or
 * viewer) without holding their key — this is what enables multi-user.
 */
export const operatorAddress = creatorAccount.address;

/** viem wallet client for on-chain settlement on the Tempo testnet. */
export const settlementClient = createWalletClient({
  account: creatorAccount,
  chain: tempoTestnet as any,
  transport: http(TEMPO_RPC_URL),
});

/**
 * Shared channel store. The session middleware persists channel state here;
 * Sse.serve meters/charges against the same store by channelId.
 */
export const channelStore = Store.memory();

/** Single mppx instance. secretKey auto-detected from MPP_SECRET_KEY. */
export const mppx = Mppx.create({
  methods: [
    tempo({
      account: creatorAccount,
      recipient: creatorAccount.address,
      currency: FLOW_CURRENCY,
      decimals: TOKEN_DECIMALS,
      chainId: TEMPO_CHAIN_ID,
      escrowContract: ESCROW_CONTRACT,
      store: channelStore,
      getClient: () => settlementClient,
      // poll the store instead of waitForUpdate: mid-stream voucher POSTs arrive
      // in a separate request context from the streaming GET (see docs/06 DEV-H).
      sse: { poll: true },
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY,
});

// Observability: log payment lifecycle events (settlements, failures, challenges).
mppx.onChallengeCreated((ctx: any) =>
  console.log(`[mppx] challenge.created intent=${ctx?.method?.intent}`),
);
mppx.onPaymentSuccess((ctx: any) =>
  console.log(`[mppx] payment.success receipt=`, ctx?.receipt?.reference ?? ctx?.receipt),
);
mppx.onPaymentFailed((ctx: any) =>
  console.log(`[mppx] payment.FAILED:`, ctx?.error?.message ?? ctx?.error),
);
