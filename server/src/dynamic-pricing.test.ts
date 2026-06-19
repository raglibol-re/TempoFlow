import test from "node:test";
import assert from "node:assert/strict";
import { clipSecondSetWatchCount, clipSecondWatchCount } from "./db.js";
import { confirmWatchRange, normalizeWatchRange, priceForWatchCount, quoteWatchRange, type DynamicPricingConfig } from "./dynamic-pricing.js";

const cfg: DynamicPricingConfig = {
  floorPricePerSecond: 1,
  ceilingPricePerSecond: 3,
  popularityThreshold: 10,
};

function clipId(name: string) {
  return `pricing-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("price at zero watch count equals floor", () => {
  assert.equal(priceForWatchCount(0, cfg), 1);
});

test("price reaches ceiling at popularityThreshold", () => {
  assert.equal(priceForWatchCount(10, cfg), 3);
});

test("price never exceeds ceiling", () => {
  assert.equal(priceForWatchCount(1000, cfg), 3);
});

test("cost is summed across multiple seconds", () => {
  const id = clipId("sum");
  clipSecondSetWatchCount(id, 8, 0);
  clipSecondSetWatchCount(id, 9, 5);
  clipSecondSetWatchCount(id, 10, 10);
  clipSecondSetWatchCount(id, 11, 20);

  const quote = quoteWatchRange(id, 8, 12, cfg, 30);

  assert.equal(quote.total, 9);
  assert.deepEqual(quote.pricedSeconds.map((s) => s.price), [1, 2, 3, 3]);
});

test("watch counts are incremented after a session", () => {
  const id = clipId("increment");

  confirmWatchRange(id, 8, 12, 30);

  assert.equal(clipSecondWatchCount(id, 7), 0);
  assert.equal(clipSecondWatchCount(id, 8), 1);
  assert.equal(clipSecondWatchCount(id, 9), 1);
  assert.equal(clipSecondWatchCount(id, 10), 1);
  assert.equal(clipSecondWatchCount(id, 11), 1);
  assert.equal(clipSecondWatchCount(id, 12), 0);
});

test("invalid watch ranges are rejected", () => {
  assert.throws(() => normalizeWatchRange(5, 5, 30), /invalid watch range/);
  assert.throws(() => normalizeWatchRange(6, 5, 30), /invalid watch range/);
  assert.throws(() => normalizeWatchRange(-1, 5, 30), /invalid watch range/);
  assert.throws(() => normalizeWatchRange(Number.NaN, 5, 30), /invalid watch range/);
  assert.throws(() => normalizeWatchRange(29, 31, 30), /outside clip duration/);
});

test("fractional timestamps are handled consistently", () => {
  const id = clipId("fractional");
  clipSecondSetWatchCount(id, 8, 0);
  clipSecondSetWatchCount(id, 9, 5);
  clipSecondSetWatchCount(id, 10, 10);
  clipSecondSetWatchCount(id, 11, 20);

  const range = normalizeWatchRange(8.2, 11.1, 30);
  const quote = quoteWatchRange(id, 8.2, 11.1, cfg, 30);

  assert.deepEqual(range, { startSecond: 8, endSecond: 12, seconds: 4 });
  assert.equal(quote.total, 9);
});
