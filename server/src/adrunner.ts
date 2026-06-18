/**
 * In-browser ad payments without a second terminal: when a viewer starts
 * watching an ad, the server SPAWNS the advertiser agent (a separate process)
 * targeting that viewer. The agent pays while the viewer's heartbeats are fresh
 * and exits when they stop (idleStop). Running the agent in its own process
 * avoids importing mppx/client into the server process (which conflicts with
 * mppx/server — "object is not extensible").
 *
 * ⚠️ TESTNET ONLY.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getUser } from "./users.js";
import { getCampaign } from "./content.js";
import * as ledger from "./ledger.js";

const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../agent");
const procs = new Map<string, ChildProcess>();
const k = (c: string, v: string) => `${c}:${v}`;

export const isAdRunning = (campaignId: string, viewerId: string) => procs.has(k(campaignId, viewerId));

/** Spawn the advertiser agent so the campaign's company pays `viewerId`. */
export function runAd(campaignId: string, viewerId: string) {
  const key = k(campaignId, viewerId);
  if (procs.has(key)) return;
  const campaign = getCampaign(campaignId);
  const viewer = getUser(viewerId);
  const company = campaign ? getUser(campaign.ownerId) : undefined;
  if (!campaign || !viewer || !company) return;

  // Only pay what's still funded (committed budget − already paid out).
  const remaining = Math.max(0, +(Number(campaign.maxBudget) - ledger.spentOn(campaign.id)).toFixed(6));
  if (remaining < Number(campaign.pricePerSec)) {
    console.log(`[adrunner] ${campaign.id} is unfunded (remaining $${remaining}) — not spawning payer`);
    return;
  }

  console.log(`[adrunner] spawning advertiser: ${company.name} → ${viewer.name} (${campaign.id}, budget $${remaining})`);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(
    npx,
    ["tsx", "src/advertiser.ts", "--as", company.id, "--to", viewer.id, "--idleStop", "9000", "--budget", String(remaining)],
    { cwd: agentDir, env: process.env, stdio: ["ignore", "pipe", "pipe"], shell: true },
  );
  procs.set(key, child);
  child.stdout?.on("data", (d) => process.stdout.write(`[adv:${viewer.id}] ${d}`));
  child.stderr?.on("data", (d) => process.stdout.write(`[adv:${viewer.id}!] ${d}`));
  child.on("error", (e) => {
    procs.delete(key);
    console.error(`[adrunner] spawn error: ${e.message}`);
  });
  child.on("exit", (code) => {
    procs.delete(key);
    console.log(`[adrunner] advertiser ${campaign.id}→${viewer.name} exited (code ${code})`);
  });
}
