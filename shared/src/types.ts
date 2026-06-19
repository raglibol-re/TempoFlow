/** Shared domain types across server, web, and agent. */

export type WalletRole = "viewer" | "creator" | "advertiser";

export type Role = "viewer" | "creator" | "advertiser" | "admin";

/** A platform user with a distinct role. */
export interface User {
  id: string;
  name: string;
  role: Role;
  handle: string; // @handle / channel name
  avatar: string; // emoji
  address: `0x${string}`;
}

/** A creator clip in the feed. */
export interface Clip {
  id: string;
  title: string;
  creator: string; // display name (channel)
  ownerId: string; // User.id of the channel owner
  tags: string[];
  durationSec: number;
  /** Recipient wallet(s). One = solo; many = collaboration → split payments. */
  recipients: Split[];
  pricePerSec: string; // USD
  /** True if a real uploaded video file is stored (served at /video/:id). */
  hasVideo?: boolean;
  /** Optional poster emoji/thumbnail hint. */
  thumb?: string;
  /** True if this is a LIVE stream (loops a source; viewers pay per second and a
   *  shared real-time audience/applause meter aggregates across all of them). */
  live?: boolean;
}

/** Live-stream aggregate stats (across all concurrent viewers of a live clip). */
export interface LiveStats {
  live: boolean;
  viewers: number; // concurrent viewers right now
  perSecUsd: number; // combined $/sec flowing to the creator from all viewers
  totalUsd: number; // total paid to the creator this live session
  applause: number; // cumulative 👏 cheers
}

/** A creator funding goal — supporters pledge into escrow; if the goal is reached
 *  the pledges are captured to the creator, otherwise refunded at the deadline.
 *  (Trustless crowdfund on the escrow/refund primitive.) */
export interface Goal {
  id: string;
  creatorId: string;
  creator: string; // display name
  title: string;
  targetUsd: string;
  deadline: number; // ms epoch
  status: "active" | "funded" | "expired";
  createdAt: number;
  // ── computed ──
  pledgedUsd?: number; // total currently escrowed (or captured)
  backers?: number; // distinct backers
  viewerPledgedUsd?: number; // how much the requesting viewer has pledged
}

/** Result of a real-time second-price (Vickrey) attention auction: the winning
 *  advertiser, the clearing price the viewer actually earns, and the full bid book. */
export interface AuctionResult {
  winner?: Campaign; // highest funded bid
  clearingUsd: number; // second-highest bid (or reserve) — what the viewer earns
  reserveUsd: number; // floor price
  bids: { campaignId: string; advertiser: string; bidUsd: number; funded: boolean }[];
}

/** An advertiser ad: a funded video that pays viewers per second of attention.
 *  Money is pulled from the advertiser's wallet automatically; once the funded
 *  budget is spent the ad can no longer pay (see `funded`). */
export interface Campaign {
  id: string;
  advertiser: string; // display name
  ownerId: string; // User.id of the company
  title?: string; // ad title
  tags: string[]; // targeting
  pricePerSec: string; // USD paid to the viewer
  maxBudget: string; // USD funded budget cap (the advertiser's committed funding)
  /** True if a real uploaded ad video is stored (served at /video/:id). */
  hasVideo?: boolean;
  thumb?: string; // poster emoji when no video
  // ── API-computed (GET /campaigns) ──
  /** Funded budget already paid out (USD). */
  spentUsd?: number;
  /** Remaining funded budget (USD). */
  remainingUsd?: number;
  /** On-chain pathUSD balance of the advertiser wallet (its ability to pay). */
  advertiserBalance?: number;
  /** True only if there is remaining budget AND the advertiser wallet can pay. */
  funded?: boolean;
}

/** A revenue split entry (used for collab creators). */
export interface Split {
  recipient: `0x${string}`;
  /** Percentage 0–100. Splits in a clip must sum to 100. */
  percentage: number;
  label?: string;
}

/** Direction of a money flow, from the viewer's point of view. */
export type FlowDirection = "out" | "in"; // out = to creator, in = from advertiser

/** A single settled (or pending) micro-payment, for the receipts view + logs. */
export interface FlowEvent {
  id: string;
  direction: FlowDirection;
  amount: string; // USD
  counterparty: string; // creator or advertiser name/address
  contentId: string; // clipId or campaignId
  timestamp: number;
  receiptRef?: string; // on-chain / voucher reference
}

/** Viewer attention heartbeat sent from the web app. */
export interface Heartbeat {
  viewer: `0x${string}`;
  campaignId: string;
  visible: boolean; // tab visible
  inViewport: boolean; // ad element in viewport
  ts: number;
}
