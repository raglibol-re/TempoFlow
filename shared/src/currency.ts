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
 *   - escrow = 0x4d50500000000000000000000000000000000000 (canonical TIP-1034
 *     "MPP" precompile from mppx Protocol.ts; privileged — needs NO ERC-20
 *     allowance. NB: mppx defaults.ts lists 0xe1c4d3… for testnet but that
 *     deployment reverts on open — see docs/06-decisions.md DEV-G.)
 */

/** Safe env read — works in Node and in the browser (no `process`). */
function env(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) return process.env[key];
  return undefined;
}

/** Tempo testnet chain id (42431 / 0xa5bf). */
export const TEMPO_CHAIN_ID = Number(env("TEMPO_CHAIN_ID") ?? 42431);

/** Tempo testnet RPC URL. */
export const TEMPO_RPC_URL =
  env("TEMPO_RPC_URL") ?? "https://rpc.moderato.tempo.xyz";

/** Tempo testnet block-explorer base URL (testnet "moderato"). Used to link real
 *  on-chain receipts (tx + address). Override via TEMPO_EXPLORER_URL if it differs. */
export const TEMPO_EXPLORER_URL =
  env("TEMPO_EXPLORER_URL") ?? "https://explorer.moderato.tempo.xyz";

/** The Tempo app / project home — linked from the wallet dashboard so users can open
 *  Tempo directly. Override via TEMPO_APP_URL. */
export const TEMPO_APP_URL =
  env("TEMPO_APP_URL") ?? "https://tempo.xyz";

/** The platform's transparent margin (fraction, e.g. 0.03 = 3%). FLOW shows this in
 *  the open ledger instead of hiding it like a blackbox middleman. Override via
 *  PLATFORM_FEE. */
export const PLATFORM_FEE = Math.min(0.2, Math.max(0, Number(env("PLATFORM_FEE") ?? 0.03)));

/** TIP-20 token decimals (pathUSD + all Tempo tokens). */
export const TOKEN_DECIMALS = 6;

/** Canonical TIP-1034 session-channel escrow precompile ("MPP"). */
export const ESCROW_CONTRACT =
  (env("TEMPO_ESCROW_CONTRACT") ??
    "0x4d50500000000000000000000000000000000000") as `0x${string}`;

/**
 * pathUSD — the stable micropayment currency on Tempo testnet.
 * All FLOW vouchers are denominated in this token.
 */
export const PATH_USD = (env("FLOW_CURRENCY") ??
  "0x20c0000000000000000000000000000000000000") as `0x${string}`;

/** The currency every FLOW payment channel uses. */
export const FLOW_CURRENCY = PATH_USD;

/** Default per-second prices (USD), tunable for the demo. */
export const PRICES = {
  /** Viewer → Creator, charged per second of watchtime. */
  creatorPerSecond: env("PRICE_CREATOR_PER_SEC") ?? "0.002",
  /** Advertiser → Viewer, charged per second of *proven* attention. */
  attentionPerSecond: env("PRICE_ATTENTION_PER_SEC") ?? "0.004",
  /** Viewer → Creator, charged per generated token when chatting a creator's AI. */
  askPerToken: env("PRICE_ASK_PER_TOKEN") ?? "0.0008",
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
  blockExplorers: {
    default: { name: "Tempo Explorer", url: TEMPO_EXPLORER_URL },
  },
  testnet: true,
} as const;
