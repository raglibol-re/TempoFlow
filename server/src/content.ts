/**
 * Content registry: clips (owned by person users) + ad campaigns (owned by
 * companies). Built from the user registry after wallets are ready. Creators
 * can post new clips; companies can create campaigns (in-memory, demo).
 */

import type { Clip, Campaign } from "@flow/shared";
import { PRICES } from "@flow/shared";
import { getUser, persons } from "./users.js";

export const clips: Clip[] = [];
export const campaigns: Campaign[] = [];

let clipSeq = 0;
let campSeq = 0;

function ownerAddr(id: string): `0x${string}` {
  const u = getUser(id);
  if (!u) throw new Error(`unknown user ${id}`);
  return u.address;
}

/** Build the seed feed once users (wallets) exist. */
export function initContent(): void {
  const seed: Array<Omit<Clip, "recipients" | "pricePerSec"> & { collabId?: string }> = [
    { id: "clip-aurora", title: "Aurora over Tromsø (4K timelapse)", creator: "nordlys.studio", ownerId: "alice", tags: ["nature", "timelapse", "travel"], durationSec: 120 },
    { id: "clip-synth", title: "Late-night synthwave session", creator: "neon.audio", ownerId: "bob", tags: ["music", "synthwave", "live"], durationSec: 90 },
    { id: "clip-speedrun", title: "Any% speedrun — world record attempt", creator: "pixel.forge", ownerId: "dao", tags: ["gaming", "speedrun", "live"], durationSec: 150 },
    { id: "clip-collab", title: "Street food tour — Bangkok (collab)", creator: "wander.eats × neon.audio", ownerId: "carol", tags: ["food", "travel", "collab"], durationSec: 100, collabId: "bob" },
  ];

  for (const s of seed) {
    const recipients =
      s.collabId != null
        ? [
            { recipient: ownerAddr(s.ownerId), percentage: 70, label: getUser(s.ownerId)?.handle ?? "owner" },
            { recipient: ownerAddr(s.collabId), percentage: 20, label: getUser(s.collabId)?.handle ?? "guest" },
            { recipient: ("0xF10W0000000000000000000000000000000000FE" as `0x${string}`), percentage: 10, label: "FLOW platform" },
          ]
        : [{ recipient: ownerAddr(s.ownerId), percentage: 100, label: getUser(s.ownerId)?.handle ?? "owner" }];
    const { collabId, ...clip } = s;
    clips.push({ ...clip, recipients, pricePerSec: PRICES.creatorPerSecond });
    clipSeq++;
  }

  const camps: Array<Omit<Campaign, "pricePerSec" | "maxBudget">> = [
    { id: "camp-tempo", advertiser: "Tempo Pay", ownerId: "tempo", tags: ["fintech", "crypto"] },
    { id: "camp-acme", advertiser: "Acme Cloud", ownerId: "acme", tags: ["developer", "cloud"] },
  ];
  for (const c of camps) {
    campaigns.push({ ...c, pricePerSec: PRICES.attentionPerSecond, maxBudget: "1.0" });
    campSeq++;
  }
}

export const getClip = (id: string) => clips.find((c) => c.id === id);
export const getCampaign = (id: string) => campaigns.find((c) => c.id === id);

/** Creator posts a new clip to their channel. */
export function addClip(input: { ownerId: string; title: string; tags: string[]; durationSec?: number }): Clip {
  const owner = getUser(input.ownerId);
  if (!owner) throw new Error("unknown owner");
  const clip: Clip = {
    id: `clip-${owner.id}-${++clipSeq}`,
    title: input.title,
    creator: owner.handle,
    ownerId: owner.id,
    tags: input.tags,
    durationSec: input.durationSec ?? 60,
    pricePerSec: PRICES.creatorPerSecond,
    recipients: [{ recipient: owner.address, percentage: 100, label: owner.handle }],
  };
  clips.unshift(clip); // newest first
  return clip;
}

/** Company creates a new ad campaign. */
export function addCampaign(input: { ownerId: string; tags: string[]; pricePerSec?: string; maxBudget?: string }): Campaign {
  const owner = getUser(input.ownerId);
  if (!owner) throw new Error("unknown owner");
  const camp: Campaign = {
    id: `camp-${owner.id}-${++campSeq}`,
    advertiser: owner.name,
    ownerId: owner.id,
    tags: input.tags,
    pricePerSec: input.pricePerSec ?? PRICES.attentionPerSecond,
    maxBudget: input.maxBudget ?? "1.0",
  };
  campaigns.unshift(camp);
  return camp;
}
