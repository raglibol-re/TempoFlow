/**
 * Real-time SECOND-PRICE (Vickrey) attention auction. Advertisers "bid" by the
 * per-second rate they set on their campaign (`pricePerSec`). For a given viewer
 * we rank all funded bids: the highest bid WINS the ad slot, but the viewer is
 * paid the CLEARING price = the second-highest bid (floored at the reserve). The
 * winner pays their own bid into the channel; the spread is the platform's.
 *
 * Truthful bidding is a dominant strategy under second-price — which makes the
 * "transparent attention market" claim real rather than a slogan.
 */

import type { Campaign, AuctionResult } from "@flow/shared";
import { PRICES } from "@flow/shared";

/** Run the auction over the (enriched) campaigns. `funded` must be set per camp. */
export function runAuction(campaigns: Campaign[]): AuctionResult {
  const reserveUsd = +Number(PRICES.attentionPerSecond).toFixed(6);
  const bids = campaigns
    .map((c) => ({ campaignId: c.id, advertiser: c.advertiser, bidUsd: Number(c.pricePerSec), funded: !!c.funded }))
    .sort((a, b) => b.bidUsd - a.bidUsd);
  const eligible = bids.filter((b) => b.funded && b.bidUsd >= reserveUsd);
  // Clearing = second-highest eligible bid, floored at the reserve.
  const clearingUsd = eligible.length
    ? +Math.max(reserveUsd, eligible[1]?.bidUsd ?? reserveUsd).toFixed(6)
    : reserveUsd;
  const winner = eligible[0] ? campaigns.find((c) => c.id === eligible[0]!.campaignId) : undefined;
  return { winner, clearingUsd, reserveUsd, bids };
}
