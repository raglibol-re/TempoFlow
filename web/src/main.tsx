/**
 * FLOW viewer web app — Phases 1 + 2.
 *  - Watch a creator clip: money flows OUT per second (skip = settle + refund).
 *  - Watch an ad: money flows IN per second of PROVEN attention (heartbeat-gated).
 *  - NET balance meter: ads finance the creator feed.
 *
 * The advertiser is a separate payer — run `pnpm --filter @flow/server spike:attention`
 * (or the Phase-4 advertiser agent) so the ad pays you.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Clip, Campaign } from "@flow/shared";
import {
  fetchFeed,
  fetchCampaigns,
  fetchNet,
  resetNet,
  sendHeartbeat,
  watchClip,
  viewerAddress,
  type Tick,
  type CloseSummary,
  type WatchHandle,
  type NetSnapshot,
} from "./flow";

type Status = "idle" | "opening" | "watching" | "closing" | "closed";

function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [net, setNet] = useState<NetSnapshot | null>(null);

  // Creator (Direction A)
  const [status, setStatus] = useState<Status>("idle");
  const [tick, setTick] = useState<Tick | null>(null);
  const [spentUsd, setSpentUsd] = useState(0);
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const [handle, setHandle] = useState<WatchHandle | null>(null);

  // Ad (Direction B)
  const [attention, setAttention] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clip = clips[0];
  const campaign = campaigns[0];

  useEffect(() => {
    fetchFeed().then(setClips).catch((e) => setError(String(e)));
    fetchCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  // Poll the net balance every second.
  useEffect(() => {
    const id = setInterval(() => {
      fetchNet().then(setNet).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Send attention heartbeats while "looking" at the ad.
  const inUsdPrev = useRef(0);
  const [adPaying, setAdPaying] = useState(false);
  useEffect(() => {
    if (!campaign) return;
    const id = setInterval(() => {
      if (attention) sendHeartbeat(campaign.id);
    }, 1000);
    return () => clearInterval(id);
  }, [attention, campaign]);

  // Detect whether the ad is actively paying (inUsd rising).
  useEffect(() => {
    if (!net) return;
    setAdPaying(net.inUsd > inUsdPrev.current);
    inUsdPrev.current = net.inUsd;
  }, [net]);

  async function onWatch() {
    if (!clip) return;
    setError(null);
    setSummary(null);
    setSpentUsd(0);
    setTick(null);
    setStatus("opening");
    try {
      const h = await watchClip(
        clip,
        (t) => {
          setStatus("watching");
          setTick(t);
          setSpentUsd(t.spentUsd);
        },
        () => {},
      );
      setHandle(h);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setStatus("idle");
    }
  }

  async function onSkip() {
    if (!handle) return;
    setStatus("closing");
    try {
      setSummary((await handle.stop()) ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    setHandle(null);
    setStatus("closed");
  }

  const netUsd = net?.netUsd ?? 0;

  return (
    <div style={styles.page}>
      <div style={styles.phone}>
        <header style={styles.header}>
          <h1 style={{ margin: 0, fontSize: 22 }}>FLOW</h1>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            {viewerAddress
              ? `${viewerAddress.slice(0, 6)}…${viewerAddress.slice(-4)}`
              : "no viewer key"}
          </span>
        </header>

        {/* NET balance — ads finance the feed */}
        <div style={styles.netCard}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>net balance</div>
          <div style={{ ...styles.netAmount, color: netUsd >= 0 ? "#46d39a" : "#ff7a7a" }}>
            {netUsd >= 0 ? "+" : "−"}${Math.abs(netUsd).toFixed(3)}
          </div>
          <div style={styles.netBreak}>
            <span style={{ color: "#46d39a" }}>▲ in ${net?.inUsd.toFixed(3) ?? "0.000"}</span>
            <span style={{ color: "#ff7a7a" }}>▼ out ${net?.outUsd.toFixed(3) ?? "0.000"}</span>
            <button style={styles.reset} onClick={() => resetNet()}>
              reset
            </button>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* Creator clip — money OUT */}
        {clip && (
          <div style={styles.card}>
            <div style={styles.tag}>creator · money out</div>
            <div style={{ fontWeight: 600 }}>🌌 {clip.title}</div>
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              @{clip.creator} · ${clip.pricePerSec}/sec
            </div>
            <div style={styles.amount("#ff7a7a")}>− ${spentUsd.toFixed(3)}</div>
            {tick && (
              <div style={{ fontSize: 12, opacity: 0.6 }}>watched {tick.second}s</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={styles.btnPrimary}
                onClick={onWatch}
                disabled={status === "opening" || status === "watching" || status === "closing"}
              >
                {status === "opening"
                  ? "opening channel…"
                  : status === "watching"
                    ? "watching…"
                    : "▶ Watch"}
              </button>
              <button style={styles.btnGhost} onClick={onSkip} disabled={status !== "watching"}>
                Skip ⏭
              </button>
            </div>
            {status === "closing" && (
              <div style={{ fontSize: 12, opacity: 0.7 }}>settling + refunding…</div>
            )}
            {summary && (
              <div style={styles.receipt("#1f3d22", "#0f1a10")}>
                ✓ paid creator ${summary.spentUsd?.toFixed(3) ?? "?"} · refunded $
                {summary.refundUsd?.toFixed(3) ?? "?"}
              </div>
            )}
          </div>
        )}

        {/* Ad — money IN, gated by attention */}
        {campaign && (
          <div style={styles.card}>
            <div style={styles.tag}>ad · money in</div>
            <div style={{ fontWeight: 600 }}>📣 {campaign.advertiser}</div>
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              pays you ${campaign.pricePerSec}/sec for real attention
            </div>
            <div style={styles.amount("#46d39a")}>+ ${net?.inUsd.toFixed(3) ?? "0.000"}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {attention
                ? adPaying
                  ? "👀 attention proven — advertiser is paying you"
                  : "👀 watching — waiting for advertiser…"
                : "🙈 looked away — payment paused"}
            </div>
            <button
              style={attention ? styles.btnGhost : styles.btnPrimary}
              onClick={() => setAttention((a) => !a)}
            >
              {attention ? "Look away 🙈" : "Look back 👀"}
            </button>
            <div style={{ fontSize: 11, opacity: 0.5 }}>
              run the advertiser: <code>pnpm --filter @flow/server spike:attention</code>
            </div>
          </div>
        )}

        {/* Live flow events */}
        {net && net.events.length > 0 && (
          <div style={styles.events}>
            {net.events.slice(0, 6).map((e) => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: e.direction === "in" ? "#46d39a" : "#ff7a7a" }}>
                  {e.direction === "in" ? "▲" : "▼"} {e.counterparty}
                </span>
                <span style={{ opacity: 0.7 }}>${Number(e.amount).toFixed(3)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  page: {
    minHeight: "100vh",
    margin: 0,
    background: "#0b0b12",
    color: "#f2f2f7",
    fontFamily: "system-ui, sans-serif",
    display: "flex",
    justifyContent: "center",
  },
  phone: { width: 400, maxWidth: "100%", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  netCard: {
    background: "linear-gradient(160deg,#15151f,#101019)",
    borderRadius: 16,
    padding: 16,
    textAlign: "center",
  },
  netAmount: { fontSize: 40, fontWeight: 800, letterSpacing: 0.5 },
  netBreak: { display: "flex", justifyContent: "center", gap: 14, fontSize: 12, alignItems: "center" },
  reset: {
    marginLeft: 6,
    fontSize: 10,
    background: "transparent",
    color: "#666",
    border: "1px solid #333",
    borderRadius: 6,
    cursor: "pointer",
  },
  card: {
    background: "#15151f",
    borderRadius: 16,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  tag: { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, opacity: 0.5 },
  amount: (color: string) => ({ fontSize: 30, fontWeight: 700, color }),
  btnPrimary: {
    flex: 1,
    padding: "12px 14px",
    borderRadius: 10,
    border: "none",
    background: "#5b8cff",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnGhost: {
    flex: 1,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid #333",
    background: "transparent",
    color: "#f2f2f7",
    cursor: "pointer",
  },
  receipt: (border: string, bg: string) => ({
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
  }),
  events: { background: "#0f0f17", borderRadius: 12, padding: 12, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 },
  error: {
    background: "#2a0f12",
    border: "1px solid #5a1f25",
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    wordBreak: "break-all",
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
