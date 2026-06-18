/**
 * Curator agent — autonomous viewer (uses the VIEWER wallet).
 *
 *  - Discovers FLOW's paid endpoints via /openapi.json.
 *  - Watches creator clips it prefers, paying per second (money OUT).
 *  - Simultaneously "watches ads" by sending attention heartbeats, so the
 *    advertiser pays it (money IN). Consumption IS the attention proof.
 *  - Respects a net spend policy; stops cleanly (close()) at budget / Ctrl-C.
 *
 * Run: pnpm agent:curator -- --budget 0.05 --watch 6 --tags nature,music
 * ⚠️ TESTNET ONLY. See docs/03-agent.md.
 */

import "./env.js";
import {
  SERVER,
  flags,
  makeManager,
  makeLogger,
  discoverOffers,
  fetchDemoUsers,
  runPaidStream,
  SpendPolicy,
  sleep,
} from "./lib.js";
import type { Clip, Campaign } from "@flow/shared";

const f = flags();
const BUDGET = Number(f.budget ?? "0.05"); // max USD to pay creators (out)
const WATCH_SECS = Number(f.watch ?? "6"); // seconds watched per clip
const PREF_TAGS = String(f.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_PER_MIN = Number(f.maxPerMinute ?? "0.05");

const log = makeLogger("curator");

async function main() {
  // Act as a real platform user (person). --as <id> selects which.
  const people = (await fetchDemoUsers()).filter((u) => u.kind === "person");
  const meId = String(f.as ?? people[0]?.id ?? "");
  const me = people.find((u) => u.id === meId) ?? people[0];
  if (!me) throw new Error("no person users on server");
  const key = me.key;
  const policy = new SpendPolicy(BUDGET, MAX_PER_MIN);
  log.info(`curator acting as ${me.name} (@${me.handle}) ${me.address}`, { budget: BUDGET, watchSecs: WATCH_SECS, prefTags: PREF_TAGS });

  // 1) Discover paid endpoints.
  const { serviceInfo, offers } = await discoverOffers();
  log.info(`discovered ${offers.length} offers on ${SERVER}`, {
    paths: offers.map((o) => `${o.path} (${o.recipient?.slice(0, 8)}…)`),
    categories: serviceInfo?.categories,
  });

  // 2) Inventory: clips to watch + campaigns to earn from.
  const clips: Clip[] = await fetch(`${SERVER}/feed`).then((r) => r.json()).then((j: any) => j.clips ?? []);
  const campaigns: Campaign[] = await fetch(`${SERVER}/campaigns`).then((r) => r.json()).then((j: any) => j.campaigns ?? []);

  // Rank clips by preference (tag overlap first).
  const ranked = [...clips].sort(
    (a, b) => tagScore(b, PREF_TAGS) - tagScore(a, PREF_TAGS),
  );

  // 3) Earn from ads continuously: send heartbeats so advertisers pay us.
  let earning = true;
  const hb = setInterval(() => {
    if (earning) for (const c of campaigns) sendHeartbeat(c.id, me.id);
  }, 1000);

  // 4) Watch loop: pay creators per second until the budget is reached.
  let running = true;
  process.on("SIGINT", () => {
    log.info("Ctrl-C — stopping after current clip");
    running = false;
  });

  let i = 0;
  while (running) {
    const clip = ranked[i++ % ranked.length];
    if (!clip) break;
    const pricePerSec = Number(clip.pricePerSec);
    if (!policy.allows(pricePerSec)) {
      log.info(`budget reached ($${policy.spent.toFixed(4)}/${BUDGET}) — done watching`);
      break;
    }

    log.info(`watching "${clip.title}" @${clip.creator} for up to ${WATCH_SECS}s`);
    let clipSpent = 0;
    let secs = 0;
    const { manager } = makeManager(key); // fresh channel per clip
    const receipt = await runPaidStream({
      manager,
      url: `${SERVER}/watch/${clip.id}?as=${me.id}`,
      stopUrl: `${SERVER}/watch/${clip.id}/stop`,
      onFrame: (fr) => {
        if (fr.type !== "tick") return;
        secs = fr.second;
        clipSpent = fr.spentUsd;
        log.payment({ direction: "out", amount: pricePerSec, counterparty: clip.creator, contentId: clip.id });
      },
      shouldStop: () => secs >= WATCH_SECS || !policy.allows(clipSpent + pricePerSec) || !running,
    });
    policy.record(clipSpent);
    log.info(`closed "${clip.title}" — paid $${clipSpent.toFixed(4)}, refunded rest`, {
      txHash: receipt?.txHash,
      netRemaining: policy.remaining(),
    });
    await sleep(500);
  }

  earning = false;
  clearInterval(hb);
  const net = await fetch(`${SERVER}/net?as=${me.id}`).then((r) => r.json()).catch(() => null);
  log.summary({ as: me.name, paidToCreators: policy.spent, myNet: net });
  process.exit(0);
}

function tagScore(clip: Clip, prefs: string[]) {
  if (!prefs.length) return 0;
  return clip.tags.filter((t) => prefs.includes(t)).length;
}

function sendHeartbeat(campaignId: string, viewer: string) {
  fetch(`${SERVER}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, viewer }),
  }).catch(() => {});
}

main().catch((e) => {
  log.info("error: " + (e?.message ?? String(e)));
  process.exit(1);
});
