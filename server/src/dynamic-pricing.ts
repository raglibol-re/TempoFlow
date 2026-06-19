import { PRICES } from "@flow/shared";
import { clipSecondIncrementRange, clipSecondWatchCounts } from "./db.js";

export interface DynamicPricingConfig {
  floorPricePerSecond: number;
  ceilingPricePerSecond: number;
  popularityThreshold: number;
}

export interface NormalizedWatchRange {
  startSecond: number;
  endSecond: number;
  seconds: number;
}

export interface PricedSecond {
  second: number;
  watchCount: number;
  price: number;
}

export interface WatchPriceQuote extends NormalizedWatchRange {
  total: number;
  pricedSeconds: PricedSecond[];
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function defaultDynamicPricingConfig(): DynamicPricingConfig {
  const floor = envNumber("FLOOR_PRICE_PER_SECOND", Number(PRICES.creatorPerSecond));
  return {
    floorPricePerSecond: floor,
    ceilingPricePerSecond: envNumber("CEILING_PRICE_PER_SECOND", Math.max(floor, floor * 10)),
    popularityThreshold: Math.max(1, Math.floor(envNumber("POPULARITY_THRESHOLD", 100))),
  };
}

export function validatePricingConfig(config: DynamicPricingConfig): DynamicPricingConfig {
  if (!Number.isFinite(config.floorPricePerSecond) || config.floorPricePerSecond < 0) throw new Error("invalid floorPricePerSecond");
  if (!Number.isFinite(config.ceilingPricePerSecond) || config.ceilingPricePerSecond < config.floorPricePerSecond) throw new Error("invalid ceilingPricePerSecond");
  if (!Number.isFinite(config.popularityThreshold) || config.popularityThreshold <= 0) throw new Error("invalid popularityThreshold");
  return config;
}

export function priceForWatchCount(watchCount: number, config: DynamicPricingConfig): number {
  const cfg = validatePricingConfig(config);
  const safeWatchCount = Math.max(0, Math.floor(watchCount));
  const normalizedPopularity = Math.min(safeWatchCount / cfg.popularityThreshold, 1);
  const price = cfg.floorPricePerSecond + normalizedPopularity * (cfg.ceilingPricePerSecond - cfg.floorPricePerSecond);
  return +price.toFixed(6);
}

export function normalizeWatchRange(startTime: number, endTime: number, durationSec?: number): NormalizedWatchRange {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) throw new Error("invalid watch range");
  if (startTime < 0 || endTime <= startTime) throw new Error("invalid watch range");
  const startSecond = Math.floor(startTime);
  const endSecond = Math.ceil(endTime);
  if (startSecond < 0 || endSecond <= startSecond) throw new Error("invalid watch range");
  if (durationSec !== undefined) {
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("invalid duration");
    if (startSecond >= durationSec || endSecond > durationSec) throw new Error("watch range outside clip duration");
  }
  return { startSecond, endSecond, seconds: endSecond - startSecond };
}

export function quoteWatchRange(
  clipId: string,
  startTime: number,
  endTime: number,
  config: DynamicPricingConfig = defaultDynamicPricingConfig(),
  durationSec?: number,
): WatchPriceQuote {
  const range = normalizeWatchRange(startTime, endTime, durationSec);
  const counts = clipSecondWatchCounts(clipId, range.startSecond, range.endSecond);
  const pricedSeconds: PricedSecond[] = [];
  let total = 0;
  for (let second = range.startSecond; second < range.endSecond; second++) {
    const watchCount = counts.get(second) ?? 0;
    const price = priceForWatchCount(watchCount, config);
    pricedSeconds.push({ second, watchCount, price });
    total += price;
  }
  return { ...range, total: +total.toFixed(6), pricedSeconds };
}

export function confirmWatchRange(clipId: string, startTime: number, endTime: number, durationSec?: number): NormalizedWatchRange {
  const range = normalizeWatchRange(startTime, endTime, durationSec);
  clipSecondIncrementRange(clipId, range.startSecond, range.endSecond);
  return range;
}
