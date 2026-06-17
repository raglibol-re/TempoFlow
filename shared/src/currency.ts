/**
 * Currency + network constants for FLOW on the Tempo TESTNET.
 *
 * ⚠️ TESTNET ONLY. These addresses/IDs are for the Tempo test network.
 * Verify against the live MPP docs (mpp.dev/payment-methods) before the demo;
 * any deviation is logged in docs/06-decisions.md.
 */

/** Tempo testnet chain id. */
export const TEMPO_CHAIN_ID = Number(process.env.TEMPO_CHAIN_ID ?? 4217);

/** Tempo testnet RPC URL (override via env). */
export const TEMPO_RPC_URL =
  process.env.TEMPO_RPC_URL ?? "https://rpc.testnet.tempo.xyz";

/**
 * pathUSD — the stable micropayment currency on Tempo testnet.
 * All FLOW vouchers are denominated in this token.
 */
export const PATH_USD = (process.env.FLOW_CURRENCY ??
  "0x20c0000000000000000000000000000000000000") as `0x${string}`;

/** The currency every FLOW payment channel uses. */
export const FLOW_CURRENCY = PATH_USD;

/** Default per-second prices (USD), tunable for the demo. */
export const PRICES = {
  /** Viewer → Creator, charged per second of watchtime. */
  creatorPerSecond: process.env.PRICE_CREATOR_PER_SEC ?? "0.002",
  /** Advertiser → Viewer, charged per second of *proven* attention. */
  attentionPerSecond: process.env.PRICE_ATTENTION_PER_SEC ?? "0.004",
} as const;

/**
 * viem chain definition for the Tempo testnet.
 * RPC + explorer URLs are placeholders until verified in the runbook.
 */
export const tempoTestnet = {
  id: TEMPO_CHAIN_ID,
  name: "Tempo Testnet",
  nativeCurrency: { name: "Tempo", symbol: "TEMPO", decimals: 18 },
  rpcUrls: {
    default: { http: [TEMPO_RPC_URL] },
    public: { http: [TEMPO_RPC_URL] },
  },
  testnet: true,
} as const;
