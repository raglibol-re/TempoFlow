/**
 * Content registry (SQLite-backed): clips owned by creators + campaigns owned by
 * advertisers. Creators upload clips (with real video); advertisers create campaigns.
 */

import type { Clip, Campaign } from "@flow/shared";
import { PRICES } from "@flow/shared";
import { getUser } from "./users.js";
import {
  clipsCount, clipsAll, clipById, clipInsert, clipSetPrice,
  campaignsCount, campaignsAll, campaignById, campaignInsert, campaignSetBudget,
  clipSetVideo, campaignSetVideo,
  type CampaignRow,
} from "./db.js";

const PLATFORM = "0xF10W0000000000000000000000000000000000FE" as `0x${string}`;
const SEED_VIDEO: Record<string, string> = {
  "clip-aurora": "https://media.w3.org/2010/05/sintel/trailer.mp4",
  "clip-synth": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "clip-speedrun": "https://media.w3.org/2010/05/bunny/trailer.mp4",
  "clip-collab": "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
  "camp-tempo": "https://media.w3.org/2010/05/sintel/trailer.mp4",
  "camp-acme": "https://media.w3.org/2010/05/bunny/trailer.mp4",
};

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
  for (const [id, url] of Object.entries(SEED_VIDEO)) {
    const clip = clipById(id);
    if (clip && !clip.hasVideo) clipSetVideo(id, url);
  }
  if (campaignsCount() === 0) {
    // Both seed ads ship FUNDED ($5) so they reliably start in the demo. The
    // "no funding → no payout" rule is still enforced — newly created ads start
    // at $0 until the advertiser funds them.
    campaignInsert({ id: "camp-tempo", advertiser: "Tempo Pay", ownerId: "tempo", title: "Send money at the speed of light", tags: ["fintech", "crypto"], pricePerSec: PRICES.attentionPerSecond, maxBudget: "5", hasVideo: false, thumb: "🛰️" });
    campaignInsert({ id: "camp-acme", advertiser: "Acme Cloud", ownerId: "acme", title: "Deploy in one command", tags: ["developer", "cloud"], pricePerSec: PRICES.attentionPerSecond, maxBudget: "5", hasVideo: false, thumb: "☁️" });
  }
  for (const [id, url] of Object.entries(SEED_VIDEO)) {
    const campaign = campaignById(id);
    if (campaign && !campaign.hasVideo) campaignSetVideo(id, url);
  }
}

export const getClips = () => clipsAll();
export const getClip = (id: string) => clipById(id);
export const getCampaigns = () => campaignsAll();
export const getCampaign = (id: string) => campaignById(id);

/** Creator posts a clip (optionally with an uploaded video file + a custom price). */
export function addClip(input: {
  ownerId: string; title: string; tags: string[]; durationSec?: number; pricePerSec?: string; hasVideo?: boolean; videoPath?: string; thumb?: string; live?: boolean;
}): Clip {
  const owner = getUser(input.ownerId);
  if (!owner) throw new Error("unknown owner");
  const id = `${input.live ? "live" : "clip"}-${owner.id}-${Date.now().toString(36)}`;
  const clip = {
    id, title: input.title, creator: owner.handle, ownerId: owner.id,
    tags: input.tags, durationSec: input.durationSec ?? 60, pricePerSec: input.pricePerSec ?? PRICES.creatorPerSecond,
    recipients: [{ recipient: owner.address, percentage: 100, label: owner.handle }],
    hasVideo: !!input.hasVideo, videoPath: input.videoPath, thumb: input.thumb ?? owner.avatar,
    live: !!input.live, createdAt: Date.now(),
  };
  clipInsert(clip);
  const { videoPath, createdAt, ...pub } = clip as any;
  return pub as Clip;
}

/** Re-price a clip (creator only — caller checks ownership). Returns the updated clip. */
export function setClipPrice(id: string, pricePerSec: string): Clip {
  if (!clipById(id)) throw new Error("unknown clip");
  clipSetPrice(id, pricePerSec);
  const { videoPath, ...pub } = clipById(id)! as any;
  return pub as Clip;
}

/** Advertiser creates an ad (optionally with an uploaded ad video + funded budget). */
export function addCampaign(input: {
  ownerId: string; tags: string[]; title?: string; pricePerSec?: string; maxBudget?: string;
  hasVideo?: boolean; videoPath?: string; thumb?: string;
}): Campaign {
  const owner = getUser(input.ownerId);
  if (!owner) throw new Error("unknown owner");
  const camp: CampaignRow = {
    id: `camp-${owner.id}-${Date.now().toString(36)}`, advertiser: owner.name, ownerId: owner.id,
    title: input.title, tags: input.tags,
    pricePerSec: input.pricePerSec ?? PRICES.attentionPerSecond,
    maxBudget: input.maxBudget ?? "0", // new ads start UNFUNDED until the advertiser funds them
    hasVideo: !!input.hasVideo, videoPath: input.videoPath, thumb: input.thumb ?? "📣",
  };
  campaignInsert(camp);
  const { videoPath, ...pub } = camp;
  return pub as Campaign;
}

/** Top up an ad's funded budget cap by `addUsd` (returns the new total). */
export function fundCampaign(id: string, addUsd: number): string {
  const camp = campaignById(id);
  if (!camp) throw new Error("unknown campaign");
  const next = (+(Number(camp.maxBudget) + addUsd).toFixed(6)).toString();
  campaignSetBudget(id, next);
  return next;
}
