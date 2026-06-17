/**
 * Currency + network constants for FLOW on the Tempo TESTNET.
 *
 * ⚠️ TESTNET ONLY.
 *
 * Values VERIFIED on 2026-06-18 against the installed `mppx@0.7.0` source
 * (`dist/tempo/internal/defaults.d.ts`) and a live `eth_chainId` call:
 *   - testnet chainId = 42431 (0xa5bf)   [4217 is MAINNET — do not use]
 *   - RPC = https://rpc.moderato.tempo.xyz
 *   - pathUSD = 0x20c0…0000, decimals = 6 (all TIP-20 tokens use 6)
 *   - escrow (testnet) = 0xe1c4d3dce17bc111181ddf716f75bae49e61a336
 */

/** Tempo testnet chain id (42431 / 0xa5bf). */
export const TEMPO_CHAIN_ID = Number(process.env.TEMPO_CHAIN_ID ?? 42431);

/** Tempo testnet RPC URL. */
export const TEMPO_RPC_URL =
  process.env.TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz";

/** TIP-20 token decimals (pathUSD + all Tempo tokens). */
export const TOKEN_DECIMALS = 6;

/** Session-channel escrow precompile contract (Tempo testnet). */
export const ESCROW_CONTRACT =
  (process.env.TEMPO_ESCROW_CONTRACT ??
    "0xe1c4d3dce17bc111181ddf716f75bae49e61a336") as `0x${string}`;

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
