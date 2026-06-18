/** Seed feed data for the demo. Phase 1: one clip. Phase 2: one ad campaign. */

import type { Clip, Campaign } from "@flow/shared";
import { PRICES } from "@flow/shared";
import { creatorAccount } from "./config.js";

// NOTE: all channels settle on-chain to the server's single creator wallet
// (the only key the server holds). Different `creator` display names share that
// payout wallet for the demo. Collab `recipients` show the intended split; real
// per-second on-chain splitting needs mppx session-split support (see 06 DEV-B).
const PRIMARY = creatorAccount.address;
const COLLAB_GUEST = "0xC0LLAB0000000000000000000000000000000A11" as `0x${string}`;
const PLATFORM = "0xF10W0000000000000000000000000000000000FE" as `0x${string}`;

export const clips: Clip[] = [
  {
    id: "clip-aurora",
    title: "Aurora over Tromsø (4K timelapse)",
    creator: "nordlys.studio",
    tags: ["nature", "timelapse", "travel"],
    durationSec: 120,
    pricePerSec: PRICES.creatorPerSecond,
    recipients: [{ recipient: PRIMARY, percentage: 100, label: "nordlys.studio" }],
  },
  {
    id: "clip-synth",
    title: "Late-night synthwave session",
    creator: "neon.audio",
    tags: ["music", "synthwave", "live"],
    durationSec: 90,
    pricePerSec: PRICES.creatorPerSecond,
    recipients: [{ recipient: PRIMARY, percentage: 100, label: "neon.audio" }],
  },
  {
    id: "clip-collab",
    title: "Street food tour — Bangkok (collab)",
    creator: "wander.eats × chef.mai",
    tags: ["food", "travel", "collab"],
    durationSec: 100,
    pricePerSec: PRICES.creatorPerSecond,
    // Collaboration → revenue split (display; settles to primary on-chain).
    recipients: [
      { recipient: PRIMARY, percentage: 70, label: "wander.eats" },
      { recipient: COLLAB_GUEST, percentage: 20, label: "chef.mai" },
      { recipient: PLATFORM, percentage: 10, label: "FLOW platform" },
    ],
  },
];

export function getClip(id: string): Clip | undefined {
  return clips.find((c) => c.id === id);
}

/** Ad campaigns that pay the viewer for proven attention (Direction B). */
export const campaigns: Campaign[] = [
  {
    id: "camp-tempo",
    advertiser: "Tempo Pay",
    tags: ["fintech", "crypto"],
    pricePerSec: PRICES.attentionPerSecond, // paid TO the viewer
    maxBudget: "1.0",
  },
];

export function getCampaign(id: string): Campaign | undefined {
  return campaigns.find((c) => c.id === id);
}
