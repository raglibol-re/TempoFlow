/** Shared domain types across server, web, and agent. */

export type WalletRole = "viewer" | "creator" | "advertiser";

/** A creator clip in the feed. */
export interface Clip {
  id: string;
  title: string;
  creator: string; // display name
  tags: string[];
  durationSec: number;
  /** Recipient wallet(s). One = solo; many = collaboration → split payments. */
  recipients: Split[];
  pricePerSec: string; // USD
}

/** An advertiser campaign that pays viewers for attention. */
export interface Campaign {
  id: string;
  advertiser: string;
  tags: string[]; // targeting
  pricePerSec: string; // USD paid to the viewer
  maxBudget: string; // USD total campaign budget
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
