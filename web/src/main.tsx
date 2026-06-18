/**
 * FLOW viewer web app — Phases 1–3.
 *  - Scrollable feed of creator clips: money flows OUT per second; switching
 *    clips seamlessly closes the previous channel (settle + refund).
 *  - Collab clips show the revenue split (70/20/10).
 *  - Ad card: money flows IN per second of PROVEN attention (heartbeat-gated).
 *  - NET balance meter: ad attention finances the creator feed.
 *
 * Advertiser is a separate payer: `pnpm --filter @flow/server spike:attention`.
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

/** Animated directional money-flow lane: dots stream out (red) or in (green). */
const FLOW_CSS = `
@keyframes flowRight { from { transform: translateX(-12px); opacity: 0 } 10% { opacity: 1 } 90% { opacity: 1 } to { transform: translateX(var(--lane)); opacity: 0 } }
@keyframes flowLeft  { from { transform: translateX(var(--lane)); opacity: 0 } 10% { opacity: 1 } 90% { opacity: 1 } to { transform: translateX(-12px); opacity: 0 } }
.flow-lane { position: relative; height: 18px; overflow: hidden; border-radius: 9px; background: #0f0f17; }
.flow-dot { position: absolute; top: 6px; width: 6px; height: 6px; border-radius: 50%; }
`;

function FlowLane({ direction, active }: { direction: "in" | "out"; active: boolean }) {
  const color = direction === "out" ? "#ff7a7a" : "#46d39a";
  const anim = direction === "out" ? "flowRight" : "flowLeft";
  const dots = 7;
  return (
    <div className="flow-lane" style={{ ["--lane" as any]: "320px", opacity: active ? 1 : 0.25 }}>
      {Array.from({ length: dots }).map((_, i) => (
        <span
          key={i}
          className="flow-dot"
          style={{
            background: color,
            boxShadow: `0 0 6px ${color}`,
            left: 0,
            animation: active ? `${anim} 1.8s linear ${(i * 1.8) / dots}s infinite` : "none",
          }}
        />
      ))}
      <span style={{ position: "absolute", right: 8, top: 1, fontSize: 11, opacity: 0.7, color }}>
        {direction === "out" ? "→ creator" : "← advertiser"}
      </span>
    </div>
  );
}

function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [net, setNet] = useState<NetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Single active creator watch at a time (seamless switching).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"opening" | "watching" | "closing" | null>(null);
  const [spentUsd, setSpentUsd] = useState(0);
  const [tick, setTick] = useState<Tick | null>(null);
  const [summaries, setSummaries] = useState<Record<string, CloseSummary>>({});
  const handleRef = useRef<WatchHandle | null>(null);

  // Ad attention
  const [attention, setAttention] = useState(true);
  const [adPaying, setAdPaying] = useState(false);
  const inPrev = useRef(0);

  const campaign = campaigns[0];

  useEffect(() => {
    fetchFeed().then(setClips).catch((e) => setError(String(e)));
    fetchCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => fetchNet().then(setNet).catch(() => {}), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!campaign) return;
    const id = setInterval(() => {
      if (attention) sendHeartbeat(campaign.id);
    }, 1000);
    return () => clearInterval(id);
  }, [attention, campaign]);

  useEffect(() => {
    if (!net) return;
    setAdPaying(net.inUsd > inPrev.current);
    inPrev.current = net.inUsd;
  }, [net]);

  async function stopActive() {
    const h = handleRef.current;
    if (!h || !activeId) return;
    setPhase("closing");
    try {
      const s = await h.stop();
      if (s) setSummaries((m) => ({ ...m, [activeId]: s }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    handleRef.current = null;
    setActiveId(null);
    setPhase(null);
    setSpentUsd(0);
    setTick(null);
  }

  async function onWatch(clip: Clip) {
    setError(null);
    // Seamless switch: close the currently-playing clip first.
    if (handleRef.current) await stopActive();
    setActiveId(clip.id);
    setPhase("opening");
    setSpentUsd(0);
    setTick(null);
    setSummaries((m) => {
      const { [clip.id]: _drop, ...rest } = m;
      return rest;
    });
    try {
      handleRef.current = await watchClip(
        clip,
        (t) => {
          setPhase("watching");
          setTick(t);
          setSpentUsd(t.spentUsd);
        },
        () => {},
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setActiveId(null);
      setPhase(null);
    }
  }

  const netUsd = net?.netUsd ?? 0;

  return (
    <div style={styles.page}>
      <style>{FLOW_CSS}</style>
      <div style={styles.phone}>
        <header style={styles.header}>
          <h1 style={{ margin: 0, fontSize: 22 }}>FLOW</h1>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            {viewerAddress ? `${viewerAddress.slice(0, 6)}…${viewerAddress.slice(-4)}` : "no key"}
          </span>
        </header>

        {/* NET balance */}
        <div style={styles.netCard}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>net balance</div>
          <div style={{ ...styles.netAmount, color: netUsd >= 0 ? "#46d39a" : "#ff7a7a" }}>
            {netUsd >= 0 ? "+" : "−"}${Math.abs(netUsd).toFixed(3)}
          </div>
          <div style={styles.netBreak}>
            <span style={{ color: "#46d39a" }}>▲ in ${net?.inUsd.toFixed(3) ?? "0.000"}</span>
            <span style={{ color: "#ff7a7a" }}>▼ out ${net?.outUsd.toFixed(3) ?? "0.000"}</span>
            <button style={styles.reset} onClick={() => resetNet()}>reset</button>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* Scrollable feed */}
        <div style={styles.feed}>
          {clips.map((clip) => {
            const active = activeId === clip.id;
            const summary = summaries[clip.id];
            const isCollab = clip.recipients.length > 1;
            return (
              <div key={clip.id} style={{ ...styles.clipCard, ...(active ? styles.clipActive : {}) }}>
                <div style={styles.tag}>creator · money out</div>
                <div style={{ fontWeight: 600 }}>🎬 {clip.title}</div>
                <div style={{ opacity: 0.7, fontSize: 13 }}>
                  @{clip.creator} · ${clip.pricePerSec}/sec
                </div>

                {isCollab && (
                  <div style={styles.split}>
                    split:{" "}
                    {clip.recipients.map((r, i) => (
                      <span key={i} style={{ opacity: 0.85 }}>
                        {i > 0 ? " · " : ""}
                        {r.label} {r.percentage}%
                      </span>
                    ))}
                  </div>
                )}

                {active && (
                  <>
                    <div style={styles.outAmount}>− ${spentUsd.toFixed(3)}</div>
                    <FlowLane direction="out" active={phase === "watching"} />
                    {tick && <div style={{ fontSize: 12, opacity: 0.6 }}>watched {tick.second}s</div>}
                  </>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    style={styles.btnPrimary}
                    onClick={() => onWatch(clip)}
                    disabled={active && (phase === "opening" || phase === "watching")}
                  >
                    {active && phase === "opening"
                      ? "opening channel…"
                      : active && phase === "watching"
                        ? "watching…"
                        : "▶ Watch"}
                  </button>
                  <button style={styles.btnGhost} onClick={stopActive} disabled={!active || phase !== "watching"}>
                    Skip ⏭
                  </button>
                </div>

                {active && phase === "closing" && (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>settling + refunding…</div>
                )}

                {summary && (
                  <div style={styles.receipt}>
                    ✓ paid ${summary.spentUsd?.toFixed(3) ?? "?"} · refunded ${summary.refundUsd?.toFixed(3) ?? "?"}
                    {isCollab && summary.spentUsd != null && (
                      <div style={{ marginTop: 4, opacity: 0.85 }}>
                        {clip.recipients.map((r, i) => (
                          <div key={i}>
                            → {r.label}: ${((summary.spentUsd! * r.percentage) / 100).toFixed(4)} ({r.percentage}%)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ad card — money IN, attention-gated */}
          {campaign && (
            <div style={styles.adCard}>
              <div style={styles.tag}>ad · money in</div>
              <div style={{ fontWeight: 600 }}>📣 {campaign.advertiser}</div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>
                pays you ${campaign.pricePerSec}/sec for real attention
              </div>
              <div style={styles.inAmount}>+ ${net?.inUsd.toFixed(3) ?? "0.000"}</div>
              <FlowLane direction="in" active={attention && adPaying} />
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {attention ? (adPaying ? "👀 attention proven — advertiser paying you" : "👀 watching — waiting for advertiser…") : "🙈 looked away — payment paused"}
              </div>
              <button style={attention ? styles.btnGhost : styles.btnPrimary} onClick={() => setAttention((a) => !a)}>
                {attention ? "Look away 🙈" : "Look back 👀"}
              </button>
              <div style={{ fontSize: 11, opacity: 0.5 }}>
                run advertiser: <code>pnpm --filter @flow/server spike:attention</code>
              </div>
            </div>
          )}
        </div>

        {clips.length === 0 && !error && (
          <div style={{ opacity: 0.6, textAlign: "center", padding: 20 }}>loading feed…</div>
        )}

        {net && net.events.length > 0 && (
          <div style={styles.events}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, opacity: 0.5, marginBottom: 2 }}>
              live receipts · settled on Tempo
            </div>
            {net.events.slice(0, 5).map((e) => (
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
  page: { minHeight: "100vh", margin: 0, background: "#0b0b12", color: "#f2f2f7", fontFamily: "system-ui, sans-serif", display: "flex", justifyContent: "center" },
  phone: { width: 400, maxWidth: "100%", padding: 16, display: "flex", flexDirection: "column", gap: 12, height: "100vh", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  netCard: { background: "linear-gradient(160deg,#15151f,#101019)", borderRadius: 16, padding: 14, textAlign: "center" },
  netAmount: { fontSize: 36, fontWeight: 800 },
  netBreak: { display: "flex", justifyContent: "center", gap: 12, fontSize: 12, alignItems: "center" },
  reset: { marginLeft: 6, fontSize: 10, background: "transparent", color: "#666", border: "1px solid #333", borderRadius: 6, cursor: "pointer" },
  feed: { display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", scrollSnapType: "y proximity", flex: 1, paddingRight: 4 },
  clipCard: { background: "#15151f", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 8, scrollSnapAlign: "start", border: "1px solid transparent" },
  clipActive: { border: "1px solid #5b8cff", boxShadow: "0 0 24px rgba(91,140,255,0.25)" },
  adCard: { background: "linear-gradient(160deg,#11201a,#15151f)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 8, scrollSnapAlign: "start" },
  tag: { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, opacity: 0.5 },
  split: { fontSize: 11, opacity: 0.8, background: "#0f0f17", borderRadius: 8, padding: "6px 8px" },
  outAmount: { fontSize: 28, fontWeight: 700, color: "#ff7a7a" },
  inAmount: { fontSize: 28, fontWeight: 700, color: "#46d39a" },
  btnPrimary: { flex: 1, padding: "11px 14px", borderRadius: 10, border: "none", background: "#5b8cff", color: "white", fontWeight: 600, cursor: "pointer" },
  btnGhost: { flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #333", background: "transparent", color: "#f2f2f7", cursor: "pointer" },
  receipt: { background: "#0f1a10", border: "1px solid #1f3d22", borderRadius: 10, padding: 10, fontSize: 13 },
  events: { background: "#0f0f17", borderRadius: 12, padding: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 },
  error: { background: "#2a0f12", border: "1px solid #5a1f25", borderRadius: 10, padding: 10, fontSize: 12, wordBreak: "break-all" },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
