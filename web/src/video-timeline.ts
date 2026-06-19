export interface SecondPopularity {
  second: number;
  watchCount: number;
}

export interface TimelinePoint {
  second: number;
  watchCount: number;
  normalized: number;
  x: number;
  y: number;
}

export function positionToTime(clientX: number, left: number, width: number, duration: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(duration) || duration <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return ratio * duration;
}

export function watchCountAtSecond(popularity: SecondPopularity[], second: number): number {
  const target = Math.max(0, Math.floor(second));
  return popularity.find((p) => Math.floor(p.second) === target)?.watchCount ?? 0;
}

export function normalizeWatchCounts(popularity: SecondPopularity[]): SecondPopularity[] {
  return popularity.map((p) => ({
    second: Math.max(0, Math.floor(p.second)),
    watchCount: Math.max(0, Math.floor(p.watchCount)),
  }));
}

export function fillMissingSeconds(popularity: SecondPopularity[], duration: number): SecondPopularity[] {
  const seconds = Math.max(0, Math.ceil(duration));
  const map = new Map<number, number>();
  for (const p of normalizeWatchCounts(popularity)) {
    map.set(p.second, Math.max(map.get(p.second) ?? 0, p.watchCount));
  }
  return Array.from({ length: seconds }, (_, second) => ({ second, watchCount: map.get(second) ?? 0 }));
}

export function downsamplePopularity(popularity: SecondPopularity[], duration: number, maxPoints: number): SecondPopularity[] {
  const filled = fillMissingSeconds(popularity, duration);
  const pointCount = Math.max(1, Math.floor(maxPoints));
  if (filled.length <= pointCount) return filled;
  const bucketSize = filled.length / pointCount;
  return Array.from({ length: pointCount }, (_, bucket) => {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.max(start + 1, Math.ceil((bucket + 1) * bucketSize));
    let max = 0;
    for (let i = start; i < Math.min(end, filled.length); i++) max = Math.max(max, filled[i]?.watchCount ?? 0);
    return { second: Math.min(filled.length - 1, Math.floor(start + bucketSize / 2)), watchCount: max };
  });
}

export function popularityPoints(popularity: SecondPopularity[], duration: number, width: number, height: number): TimelinePoint[] {
  const maxPoints = Math.max(1, Math.floor(width));
  const sampled = downsamplePopularity(popularity, duration, maxPoints);
  const maxWatchCount = sampled.reduce((max, p) => Math.max(max, p.watchCount), 0);
  const graphWidth = Math.max(0, width);
  const graphHeight = Math.max(0, height);
  if (!sampled.length) return [];
  return sampled.map((p, i) => {
    const normalized = maxWatchCount === 0 ? 0 : p.watchCount / maxWatchCount;
    const x = sampled.length === 1 ? graphWidth / 2 : (i / (sampled.length - 1)) * graphWidth;
    const y = graphHeight - normalized * graphHeight;
    return { ...p, normalized, x: +x.toFixed(3), y: +y.toFixed(3) };
  });
}

export function popularityPath(popularity: SecondPopularity[], duration: number, width: number, height: number): string {
  const points = popularityPoints(popularity, duration, width, height);
  if (!points.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}
