/** Seed feed data for the demo. Phase 1: one clip. Phase 2: one ad campaign. */

import type { Clip, Campaign } from "@flow/shared";
import { PRICES } from "@flow/shared";
import { creatorAccount } from "./config.js";

export const clips: Clip[] = [
  {
    id: "clip-aurora",
    title: "Aurora over Tromsø (4K timelapse)",
    creator: "nordlys.studio",
    tags: ["nature", "timelapse", "travel"],
    durationSec: 120,
    pricePerSec: PRICES.creatorPerSecond,
    recipients: [
      { recipient: creatorAccount.address, percentage: 100, label: "nordlys.studio" },
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
