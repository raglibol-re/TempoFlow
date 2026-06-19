import test from "node:test";
import assert from "node:assert/strict";
import {
  downsamplePopularity,
  fillMissingSeconds,
  popularityPath,
  popularityPoints,
  positionToTime,
  watchCountAtSecond,
} from "./video-timeline";

test("click position maps to correct timestamp", () => {
  assert.equal(positionToTime(50, 0, 200, 80), 20);
  assert.equal(positionToTime(-10, 0, 200, 80), 0);
  assert.equal(positionToTime(240, 0, 200, 80), 80);
});

test("hover position maps to correct timestamp", () => {
  assert.equal(positionToTime(125, 25, 400, 120), 30);
});

test("watch counts normalize correctly", () => {
  const points = popularityPoints([
    { second: 0, watchCount: 0 },
    { second: 1, watchCount: 5 },
    { second: 2, watchCount: 10 },
  ], 3, 300, 30);
  assert.deepEqual(points.map((p) => p.normalized), [0, 0.5, 1]);
  assert.deepEqual(points.map((p) => p.y), [30, 15, 0]);
});

test("graph path generation works with zero values", () => {
  assert.equal(
    popularityPath([{ second: 0, watchCount: 0 }, { second: 1, watchCount: 0 }], 2, 100, 20),
    "M 0 20 L 100 20",
  );
});

test("graph path generation works with spikes", () => {
  assert.equal(
    popularityPath([{ second: 0, watchCount: 0 }, { second: 1, watchCount: 10 }, { second: 2, watchCount: 0 }], 3, 100, 20),
    "M 0 20 L 50 0 L 100 20",
  );
});

test("missing seconds are treated as zero", () => {
  assert.equal(watchCountAtSecond([{ second: 2, watchCount: 7 }], 1), 0);
  assert.deepEqual(fillMissingSeconds([{ second: 2, watchCount: 7 }], 4), [
    { second: 0, watchCount: 0 },
    { second: 1, watchCount: 0 },
    { second: 2, watchCount: 7 },
    { second: 3, watchCount: 0 },
  ]);
});

test("downsampling preserves high spikes", () => {
  const data = Array.from({ length: 100 }, (_, second) => ({ second, watchCount: second === 42 ? 99 : 1 }));
  const sampled = downsamplePopularity(data, 100, 10);
  assert.equal(Math.max(...sampled.map((p) => p.watchCount)), 99);
});
