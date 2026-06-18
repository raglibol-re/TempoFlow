/**
 * Content registry (SQLite-backed): clips owned by creators + campaigns owned by
 * advertisers. Creators upload clips (with real video); advertisers create campaigns.
 */

import type { Clip, Campaign } from "@flow/shared";
import { PRICES } from "@flow/shared";
import { getUser } from "./users.js";
import {
  clipsCount, clipsAll, clipById, clipInsert,
  campaignsCount, campaignsAll, campaignById, campaignInsert,
} from "./db.js";

const PLATFORM = "0xF10W0000000000000000000000000000000000FE" as `0x${string}`;

export function initContent(): void {
  if (clipsCount() === 0) {
    const addr = (id: string) => getUser(id)?.address ?? PLATFORM;
    const handle = (id: string) => getUser(id)?.handle ?? id;
    const seed: Array<{ id: string; title: string; ownerId: string; tags: string[]; durationSec: number; collabId?: string; thumb: string }> = [
      { id: "clip-aurora", title: "Aurora over Tromsø (4K timelapse)", ownerId: "alice", tags: ["nature", "timelapse"], durationSec: 120, thumb: "🌌" },
      { id: "clip-synth", title: "Late-night synthwave session", ownerId: "bob", tags: ["music", "live"], durationSec: 90, thumb: "🎹" },
      { id: "clip-speedrun", title: "Any% speedrun — WR attempt", ownerId: "dao", tags: ["gaming", "speedrun"], durationSec: 150, thumb: "🎮" },
      { id: "clip-collab", title: "Street food tour — Bangkok (collab)", ownerId: "carol", tags: ["food", "collab"], durationSec: 100, collabId: "bob", thumb: "🍜" },
    ];
    for (const sdef of seed) {
      const recipients = sdef.collabId
        ? [
            { recipient: addr(sdef.ownerId), percentage: 70, label: handle(sdef.ownerId) },
            { recipient: addr(sdef.collabId), percentage: 20, label: handle(sdef.collabId) },
            { recipient: PLATFORM, percentage: 10, label: "FLOW platform" },
          ]
        : [{ recipient: addr(sdef.ownerId), percentage: 100, label: handle(sdef.ownerId) }];
      clipInsert({
        id: sdef.id, title: sdef.title, creator: handle(sdef.ownerId), ownerId: sdef.ownerId,
        tags: sdef.tags, durationSec: sdef.durationSec, pricePerSec: PRICES.creatorPerSecond,
        recipients, hasVideo: false, thumb: sdef.thumb, createdAt: Date.now(),
      });
    }
  }
  if (campaignsCount() === 0) {
    campaignInsert({ id: "camp-tempo", advertiser: "Tempo Pay", ownerId: "tempo", tags: ["fintech", "crypto"], pricePerSec: PRICES.attentionPerSecond, maxBudget: "1.0" });
    campaignInsert({ id: "camp-acme", advertiser: "Acme Cloud", ownerId: "acme", tags: ["developer", "cloud"], pricePerSec: PRICES.attentionPerSecond, maxBudget: "1.0" });
  }
}

export const getClips = () => clipsAll();
export const getClip = (id: string) => clipById(id);
export const getCampaigns = () => campaignsAll();
export const getCampaign = (id: string) => campaignById(id);

/** Creator posts a clip (optionally with an uploaded video file). */
export function addClip(input: {
  ownerId: string; title: string; tags: string[]; durationSec?: number; hasVideo?: boolean; videoPath?: string; thumb?: string;
}): Clip {
  const owner = getUser(input.ownerId);
  if (!owner) throw new Error("unknown owner");
  const id = `clip-${owner.id}-${Date.now().toString(36)}`;
  const clip = {
    id, title: input.title, creator: owner.handle, ownerId: owner.id,
    tags: input.tags, durationSec: input.durationSec ?? 60, pricePerSec: PRICES.creatorPerSecond,
    recipients: [{ recipient: owner.address, percentage: 100, label: owner.handle }],
    hasVideo: !!input.hasVideo, videoPath: input.videoPath, thumb: input.thumb ?? owner.avatar,
    createdAt: Date.now(),
  };
  clipInsert(clip);
  const { videoPath, createdAt, ...pub } = clip as any;
  return pub as Clip;
}

export function addCampaign(input: { ownerId: string; tags: string[]; pricePerSec?: string; maxBudget?: string }): Campaign {
  const owner = getUser(input.ownerId);
  if (!owner) throw new Error("unknown owner");
  const camp: Campaign = {
    id: `camp-${owner.id}-${Date.now().toString(36)}`, advertiser: owner.name, ownerId: owner.id,
    tags: input.tags, pricePerSec: input.pricePerSec ?? PRICES.attentionPerSecond, maxBudget: input.maxBudget ?? "1.0",
  };
  campaignInsert(camp);
  return camp;
}
