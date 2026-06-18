/**
 * Advertiser agent — autonomous payer (uses the ADVERTISER wallet).
 *
 *  - Discovers attention endpoints via /openapi.json (recipient = viewer).
 *  - Streams payment per second to a viewer's attention, but ONLY while the
 *    viewer's attention is proven (server gate). No attention → it pays nothing.
 *  - Respects a campaign budget + spend policy; stops cleanly at budget.
 *
 * Real attention comes from the viewer (web app or curator agent). Run the
 * curator (or open the web app) so this agent has someone to pay.
 *
 * Run: pnpm agent:advertiser -- --budget 0.08
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
} from "./lib.js";
import type { Campaign } from "@flow/shared";

const f = flags();
const BUDGET = Number(f.budget ?? "0.08"); // max USD this campaign will pay viewers
const MAX_PER_MIN = Number(f.maxPerMinute ?? "0.1");
const TARGET_TAGS = String(f.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const log = makeLogger("advertiser");

async function main() {
  // Act as a company; pay a specific viewer for attention.
  const all = await fetchDemoUsers();
  const company = all.find((u) => u.kind === "company" && (!f.as || u.id === f.as)) ?? all.find((u) => u.kind === "company");
  const target = all.find((u) => u.kind === "person" && (!f.to || u.id === f.to)) ?? all.find((u) => u.kind === "person");
  if (!company || !target) throw new Error("need a company + a person user on the server");
  const { manager } = makeManager(company.key);
  const policy = new SpendPolicy(BUDGET, MAX_PER_MIN);
  log.info(`advertiser acting as ${company.name} → paying viewer ${target.name}`, { budget: BUDGET, targetTags: TARGET_TAGS });

  // 1) Discover attention endpoints (recipient = viewer → these pay viewers).
  const { offers } = await discoverOffers();
  const attentionOffers = offers.filter((o) => o.path.includes("/attention/"));
  log.info(`discovered ${attentionOffers.length} attention endpoint(s)`, { paths: attentionOffers.map((o) => o.path) });

  // 2) Pick this company's campaign (or one matching targeting tags).
  const campaignList: Campaign[] = await fetch(`${SERVER}/campaigns`).then((r) => r.json()).then((j: any) => j.campaigns ?? []);
  const campaign =
    campaignList.find((c) => c.ownerId === company.id) ??
    campaignList.find((c) => !TARGET_TAGS.length || c.tags.some((t) => TARGET_TAGS.includes(t))) ??
    campaignList[0];
  if (!campaign) {
    log.info("no campaign available — exiting");
    return;
  }
  const pricePerSec = Number(campaign.pricePerSec);
  log.info(`running campaign "${campaign.id}" — paying ${target.name} $${pricePerSec}/sec for proven attention`);

  // 3) Stream payment to the viewer while attention is fresh; stop at budget
  //    or after a stretch of no attention (idle) — no point paying to wait.
  const IDLE_STOP_MS = Number(f.idleStop ?? "15000");
  let paid = 0;
  let stopping = false;
  let lastPaid = Date.now();
  const receipt = await runPaidStream({
    manager,
    url: `${SERVER}/attention/${campaign.id}/${target.id}`,
    stopUrl: `${SERVER}/attention/${campaign.id}/${target.id}/stop`,
    onFrame: (fr) => {
      if (fr.type === "paid") {
        paid = fr.paidUsd;
        lastPaid = Date.now();
        policy.record(pricePerSec);
        log.payment({ direction: "out", amount: pricePerSec, counterparty: "viewer", contentId: campaign.id });
      } else if (fr.type === "paused") {
        log.info("attention lost — not paying (gate active)");
      }
    },
    shouldStop: () => {
      if (stopping) return true;
      if (!policy.allows(pricePerSec)) {
        log.info(`budget reached ($${paid.toFixed(4)}/${BUDGET}) — stopping`);
        return (stopping = true);
      }
      if (Date.now() - lastPaid > IDLE_STOP_MS) {
        log.info(`no attention for ${IDLE_STOP_MS / 1000}s — ending campaign`);
        return (stopping = true);
      }
      return false;
    },
  });

  log.summary({ paidToViewers: paid, txHash: receipt?.txHash });
  process.exit(0);
}

main().catch((e) => {
  log.info("error: " + (e?.message ?? String(e)));
  process.exit(1);
});
