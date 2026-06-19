/**
 * In-memory live-stream presence + applause. A live clip aggregates ALL its
 * concurrent viewers into one shared meter: how many are watching right now, the
 * combined $/sec flowing to the creator, the running total, and cumulative 👏.
 *
 * Each watching client pulses `liveBeat` every second (the per-second watch loop
 * does this); a viewer drops out of the count if no beat arrives for PRESENCE_MS.
 * In-memory only — fine for the demo; reset when the creator ends the stream.
 */

const PRESENCE_MS = 4000;
/** A live stream is only "live" while its HOST (the creator) is present. The host's
 *  browser pulses every few seconds; if no host beat arrives for this long, the
 *  stream is considered ended (the creator left). Tolerates a couple of missed beats. */
const HOST_TTL_MS = 15000;

interface LiveRoom {
  viewers: Map<string, number>; // viewerId → last-beat ms
  totalUsd: number; // total paid to the creator this session
  applause: number; // cumulative cheers
  lastHostBeat: number; // ms epoch of the creator's last presence pulse
}

const rooms = new Map<string, LiveRoom>();
function room(clipId: string): LiveRoom {
  let r = rooms.get(clipId);
  if (!r) { r = { viewers: new Map(), totalUsd: 0, applause: 0, lastHostBeat: 0 }; rooms.set(clipId, r); }
  return r;
}

/** Mark the creator (host) present — call on go-live and on every host pulse. */
export function hostBeat(clipId: string): void {
  room(clipId).lastHostBeat = Date.now();
}

/** Is the creator currently present in their stream? False once host beats lapse. */
export function hostPresent(clipId: string): boolean {
  const r = rooms.get(clipId);
  if (!r || !r.lastHostBeat) return false;
  return Date.now() - r.lastHostBeat <= HOST_TTL_MS;
}

/** Mark a viewer present (called once per paid second they watch). */
export function liveBeat(clipId: string, viewerId: string): void {
  room(clipId).viewers.set(viewerId, Date.now());
}

/** Add a settled second's payment to the session total. */
export function liveAddPaid(clipId: string, usd: number): void {
  const r = room(clipId);
  r.totalUsd = +(r.totalUsd + usd).toFixed(6);
}

/** Register a cheer; returns the new applause count. */
export function liveCheer(clipId: string): number {
  return ++room(clipId).applause;
}

/** Snapshot the shared meter. `perViewerPerSec` is the clip's price (combined $/sec
 *  = live viewers × price). */
export function liveStats(clipId: string, perViewerPerSec: number): { live: boolean; viewers: number; perSecUsd: number; totalUsd: number; applause: number } {
  const r = room(clipId);
  const now = Date.now();
  for (const [v, t] of r.viewers) if (now - t > PRESENCE_MS) r.viewers.delete(v);
  const viewers = r.viewers.size;
  return { live: true, viewers, perSecUsd: +(viewers * perViewerPerSec).toFixed(6), totalUsd: r.totalUsd, applause: r.applause };
}

/** Clear a room (creator ended the stream). */
export function liveReset(clipId: string): void {
  rooms.delete(clipId);
}
