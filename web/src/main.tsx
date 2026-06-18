/**
 * FLOW — multi-user dashboard (YouTube/Twitch-style).
 *  - People: watch creators (money OUT, per second), post clips (Studio),
 *    and earn from ads (money IN, attention-gated).
 *  - Companies: run ad campaigns that pay viewers.
 * Account switcher picks who you are; you pay/earn from that user's wallet.
 * ⚠️ TESTNET ONLY.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Clip, Campaign } from "@flow/shared";
import {
  fetchUsers, fetchFeed, fetchCampaigns, fetchNet, resetNet, sendHeartbeat,
  postClip, createCampaign, runAd, watchClip,
  type DemoUser, type Tick, type CloseSummary, type WatchHandle, type NetSnapshot,
} from "./flow";

const FLOW_CSS = `
@keyframes flowR { from{transform:translateX(-10px);opacity:0} 10%{opacity:1} 90%{opacity:1} to{transform:translateX(300px);opacity:0} }
@keyframes flowL { from{transform:translateX(300px);opacity:0} 10%{opacity:1} 90%{opacity:1} to{transform:translateX(-10px);opacity:0} }
*{box-sizing:border-box}
.lane{position:relative;height:16px;overflow:hidden;border-radius:8px;background:#0f0f17}
.dot{position:absolute;top:5px;width:6px;height:6px;border-radius:50%}
`;

function FlowLane({ dir, on }: { dir: "in" | "out"; on: boolean }) {
  const color = dir === "out" ? "#ff7a7a" : "#46d39a";
  const anim = dir === "out" ? "flowR" : "flowL";
  return (
    <div className="lane" style={{ opacity: on ? 1 : 0.2 }}>
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} className="dot" style={{ background: color, boxShadow: `0 0 6px ${color}`, left: 0, animation: on ? `${anim} 1.8s linear ${(i * 1.8) / 7}s infinite` : "none" }} />
      ))}
      <span style={{ position: "absolute", right: 8, top: 0, fontSize: 10, color, opacity: 0.8 }}>{dir === "out" ? "→ creator" : "← advertiser"}</span>
    </div>
  );
}

function App() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [meId, setMeId] = useState<string>("");
  const [feed, setFeed] = useState<Clip[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [net, setNet] = useState<NetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"home" | "studio" | "earn">("home");

  // watch state
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const [phase, setPhase] = useState<"opening" | "watching" | "closing" | null>(null);
  const [spent, setSpent] = useState(0);
  const [summaries, setSummaries] = useState<Record<string, CloseSummary>>({});
  const handleRef = useRef<WatchHandle | null>(null);

  // ad state
  const [adCampaign, setAdCampaign] = useState<string | null>(null);
  const [attention, setAttention] = useState(true);
  const [adPaying, setAdPaying] = useState(false);
  const inPrev = useRef(0);

  // studio form
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");

  const me = users.find((u) => u.id === meId);

  useEffect(() => {
    fetchUsers().then((us) => { setUsers(us); setMeId(us.find((u) => u.kind === "person")?.id ?? us[0]?.id ?? ""); }).catch((e) => setError(String(e.message ?? e)));
    fetchFeed().then(setFeed).catch((e) => setError(String(e.message ?? e)));
    fetchCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  useEffect(() => {
    if (!me) return;
    const id = setInterval(() => fetchNet(me.id).then(setNet).catch(() => {}), 1000);
    return () => clearInterval(id);
  }, [meId]);

  // ad heartbeats + (re)start the advertiser while watching
  useEffect(() => {
    if (!me || !adCampaign) return;
    const beat = setInterval(() => { if (attention) sendHeartbeat(adCampaign, me.id); }, 1000);
    const pump = setInterval(() => { if (attention) runAd(adCampaign, me.id); }, 4000);
    if (attention) { sendHeartbeat(adCampaign, me.id); runAd(adCampaign, me.id); }
    return () => { clearInterval(beat); clearInterval(pump); };
  }, [adCampaign, attention, meId]);

  useEffect(() => { if (net) { setAdPaying(net.inUsd > inPrev.current); inPrev.current = net.inUsd; } }, [net]);

  async function stopActive() {
    const h = handleRef.current;
    if (!h || !activeClip) return;
    setPhase("closing");
    try { const s = await h.stop(); if (s) setSummaries((m) => ({ ...m, [activeClip]: s })); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    handleRef.current = null; setActiveClip(null); setPhase(null); setSpent(0);
  }

  async function watch(clip: Clip) {
    if (!me) return;
    setError(null);
    if (handleRef.current) await stopActive();
    setActiveClip(clip.id); setPhase("opening"); setSpent(0);
    setSummaries((m) => { const { [clip.id]: _d, ...r } = m; return r; });
    try {
      handleRef.current = await watchClip(clip, me, (t: Tick) => { setPhase("watching"); setSpent(t.spentUsd); }, () => {});
    } catch (e: any) { setError(e?.message ?? String(e)); setActiveClip(null); setPhase(null); }
  }

  async function switchUser(id: string) {
    if (handleRef.current) await stopActive();
    setAdCampaign(null); setMeId(id); setError(null);
    setTab(users.find((u) => u.id === id)?.kind === "company" ? "home" : "home");
  }

  async function submitClip() {
    if (!me || !title.trim()) return;
    try {
      await postClip(me.id, title.trim(), tags.split(",").map((s) => s.trim()).filter(Boolean), 60);
      setTitle(""); setTags(""); setFeed(await fetchFeed());
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }

  if (!me) return <div style={s.page}><style>{FLOW_CSS}</style><div style={{ padding: 30, opacity: 0.7 }}>{error ?? "loading…"}</div></div>;

  const netUsd = net?.netUsd ?? 0;
  const myClips = feed.filter((c) => c.ownerId === me.id);
  const isCompany = me.kind === "company";

  return (
    <div style={s.page}>
      <style>{FLOW_CSS}</style>

      {/* Top bar */}
      <div style={s.topbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: "#5b8cff" }}>FLOW</span>
          <span style={{ fontSize: 11, opacity: 0.5 }}>pay-per-second feed on Tempo</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {users.map((u) => (
            <button key={u.id} onClick={() => switchUser(u.id)} title={`${u.name} · ${u.kind}`}
              style={{ ...s.avatar, ...(u.id === meId ? s.avatarActive : {}) }}>
              <span style={{ fontSize: 16 }}>{u.avatar}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Identity + net */}
      <div style={s.idbar}>
        <div>
          <div style={{ fontWeight: 700 }}>{me.avatar} {me.name}</div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>@{me.handle} · {me.kind} · {me.address.slice(0, 6)}…{me.address.slice(-4)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, opacity: 0.6 }}>net (session)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: netUsd >= 0 ? "#46d39a" : "#ff7a7a" }}>{netUsd >= 0 ? "+" : "−"}${Math.abs(netUsd).toFixed(3)}</div>
          <div style={{ fontSize: 10 }}>
            <span style={{ color: "#46d39a" }}>▲{net?.inUsd.toFixed(3) ?? "0.000"}</span>{" "}
            <span style={{ color: "#ff7a7a" }}>▼{net?.outUsd.toFixed(3) ?? "0.000"}</span>{" "}
            <button style={s.reset} onClick={() => resetNet()}>reset</button>
          </div>
        </div>
      </div>

      {error && <div style={s.error}>⚠ {error}</div>}

      {/* Tabs (person only) */}
      {!isCompany && (
        <div style={s.tabs}>
          {(["home", "studio", "earn"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>
              {t === "home" ? "🏠 Home" : t === "studio" ? "🎬 Studio" : "💸 Earn"}
            </button>
          ))}
        </div>
      )}

      <div style={s.body}>
        {/* ───────── Company: campaigns ───────── */}
        {isCompany && (
          <CompanyView me={me} campaigns={campaigns.filter((c) => c.ownerId === me.id)} allCampaigns={campaigns}
            onCreate={async () => { try { await createCampaign(me.id, ["sponsored"]); setCampaigns(await fetchCampaigns()); } catch (e: any) { setError(e?.message); } }} />
        )}

        {/* ───────── Person: Home feed ───────── */}
        {!isCompany && tab === "home" && feed.map((clip) => {
          const active = activeClip === clip.id;
          const sum = summaries[clip.id];
          const collab = clip.recipients.length > 1;
          return (
            <div key={clip.id} style={{ ...s.card, ...(active ? s.cardActive : {}) }}>
              <div style={s.tagline}>creator · money out</div>
              <div style={{ fontWeight: 600 }}>🎬 {clip.title}</div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>@{clip.creator} · ${clip.pricePerSec}/sec</div>
              {collab && <div style={s.split}>split: {clip.recipients.map((r, i) => <span key={i}>{i ? " · " : ""}{r.label} {r.percentage}%</span>)}</div>}
              {active && <><div style={s.out}>− ${spent.toFixed(3)}</div><FlowLane dir="out" on={phase === "watching"} /></>}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={s.btn} onClick={() => watch(clip)} disabled={active && phase !== null && phase !== "closing"}>
                  {active && phase === "opening" ? "opening…" : active && phase === "watching" ? "watching…" : "▶ Watch"}
                </button>
                <button style={s.ghost} onClick={stopActive} disabled={!active || phase !== "watching"}>Skip ⏭</button>
              </div>
              {sum && <div style={s.receipt}>✓ paid ${sum.spentUsd?.toFixed(3)} · refunded ${sum.refundUsd?.toFixed(3)}{collab && sum.spentUsd != null && clip.recipients.map((r, i) => <div key={i} style={{ opacity: 0.85 }}>→ {r.label}: ${((sum.spentUsd! * r.percentage) / 100).toFixed(4)}</div>)}</div>}
            </div>
          );
        })}

        {/* ───────── Person: Studio ───────── */}
        {!isCompany && tab === "studio" && (
          <>
            <div style={s.card}>
              <div style={s.tagline}>post to your channel</div>
              <input style={s.input} placeholder="Clip title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <input style={s.input} placeholder="tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
              <button style={s.btn} onClick={submitClip} disabled={!title.trim()}>＋ Post clip</button>
              <div style={{ fontSize: 11, opacity: 0.6 }}>viewers pay you ${"0.002"}/sec to your wallet</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.6, margin: "4px 2px" }}>your clips ({myClips.length})</div>
            {myClips.map((c) => <div key={c.id} style={s.card}><div style={{ fontWeight: 600 }}>🎬 {c.title}</div><div style={{ fontSize: 12, opacity: 0.6 }}>{c.tags.join(" · ") || "—"}</div></div>)}
            <div style={s.receipt}>channel earnings this session: <b>${net?.inUsd.toFixed(3) ?? "0.000"}</b></div>
          </>
        )}

        {/* ───────── Person: Earn (ads) ───────── */}
        {!isCompany && tab === "earn" && (
          <>
            <div style={{ fontSize: 12, opacity: 0.6, margin: "2px" }}>watch an ad — the advertiser pays you for proven attention</div>
            {campaigns.map((c) => {
              const watching = adCampaign === c.id;
              return (
                <div key={c.id} style={{ ...s.adcard, ...(watching ? s.cardActive : {}) }}>
                  <div style={s.tagline}>ad · money in</div>
                  <div style={{ fontWeight: 600 }}>📣 {c.advertiser}</div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>pays ${c.pricePerSec}/sec for attention</div>
                  {watching && <><div style={s.in}>+ ${net?.inUsd.toFixed(3) ?? "0.000"}</div><FlowLane dir="in" on={attention && adPaying} />
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{attention ? (adPaying ? "👀 attention proven — being paid" : "👀 connecting advertiser…") : "🙈 looked away — paused"}</div></>}
                  <div style={{ display: "flex", gap: 8 }}>
                    {!watching ? <button style={s.btn} onClick={() => { setAdCampaign(c.id); setAttention(true); }}>▶ Watch ad</button>
                      : <><button style={attention ? s.ghost : s.btn} onClick={() => setAttention((a) => !a)}>{attention ? "Look away 🙈" : "Look back 👀"}</button>
                         <button style={s.ghost} onClick={() => setAdCampaign(null)}>Stop</button></>}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* receipts */}
        {net && net.events.length > 0 && (
          <div style={s.events}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, opacity: 0.5 }}>your live receipts · settled on Tempo</div>
            {net.events.slice(0, 6).map((e) => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: e.direction === "in" ? "#46d39a" : "#ff7a7a" }}>{e.direction === "in" ? "▲ from" : "▼ to"} {e.counterparty}</span>
                <span style={{ opacity: 0.7 }}>${Number(e.amount).toFixed(3)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CompanyView({ me, campaigns, onCreate }: { me: DemoUser; campaigns: Campaign[]; allCampaigns: Campaign[]; onCreate: () => void }) {
  return (
    <>
      <div style={s.card}>
        <div style={s.tagline}>advertiser · money out</div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Your campaigns pay viewers per second of <b>proven attention</b>. When a viewer watches your ad (in the Earn tab), you pay them automatically — gated by their heartbeats.</div>
        <button style={s.btn} onClick={onCreate}>＋ New campaign</button>
      </div>
      <div style={{ fontSize: 12, opacity: 0.6, margin: "4px 2px" }}>your campaigns ({campaigns.length})</div>
      {campaigns.map((c) => (
        <div key={c.id} style={s.card}>
          <div style={{ fontWeight: 600 }}>📣 {c.advertiser} — {c.id}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>${c.pricePerSec}/sec · budget ${c.maxBudget} · tags {c.tags.join(", ") || "—"}</div>
        </div>
      ))}
      <div style={s.receipt}>tip: switch to a person (top-right) → Earn tab → Watch your ad to see money flow to them.</div>
    </>
  );
}

const s: Record<string, any> = {
  page: { minHeight: "100vh", margin: 0, background: "#0b0b12", color: "#f2f2f7", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center" },
  topbar: { width: "100%", maxWidth: 460, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", gap: 8 },
  idbar: { width: "100%", maxWidth: 460, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px 8px" },
  avatar: { width: 34, height: 34, borderRadius: "50%", border: "1px solid #2a2a3a", background: "#15151f", cursor: "pointer", display: "grid", placeItems: "center" },
  avatarActive: { border: "2px solid #5b8cff", background: "#1a2240" },
  reset: { fontSize: 9, background: "transparent", color: "#666", border: "1px solid #333", borderRadius: 5, cursor: "pointer" },
  tabs: { width: "100%", maxWidth: 460, display: "flex", gap: 6, padding: "0 16px 8px" },
  tab: { flex: 1, padding: "8px", borderRadius: 9, border: "1px solid #2a2a3a", background: "#15151f", color: "#f2f2f7", cursor: "pointer", fontSize: 13 },
  tabActive: { border: "1px solid #5b8cff", background: "#1a2240" },
  body: { width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 10, padding: "0 16px 24px", overflowY: "auto", flex: 1 },
  card: { background: "#15151f", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 7, border: "1px solid transparent" },
  adcard: { background: "linear-gradient(160deg,#11201a,#15151f)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 7, border: "1px solid transparent" },
  cardActive: { border: "1px solid #5b8cff", boxShadow: "0 0 20px rgba(91,140,255,0.22)" },
  tagline: { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, opacity: 0.45 },
  split: { fontSize: 11, opacity: 0.8, background: "#0f0f17", borderRadius: 7, padding: "5px 7px" },
  out: { fontSize: 26, fontWeight: 700, color: "#ff7a7a" },
  in: { fontSize: 26, fontWeight: 700, color: "#46d39a" },
  btn: { flex: 1, padding: "10px 14px", borderRadius: 9, border: "none", background: "#5b8cff", color: "white", fontWeight: 600, cursor: "pointer" },
  ghost: { flex: 1, padding: "10px 14px", borderRadius: 9, border: "1px solid #333", background: "transparent", color: "#f2f2f7", cursor: "pointer" },
  input: { padding: "10px", borderRadius: 9, border: "1px solid #2a2a3a", background: "#0f0f17", color: "#f2f2f7", fontSize: 14 },
  receipt: { background: "#0f1a10", border: "1px solid #1f3d22", borderRadius: 10, padding: 10, fontSize: 13 },
  events: { background: "#0f0f17", borderRadius: 12, padding: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 3 },
  error: { width: "100%", maxWidth: 460, background: "#2a0f12", border: "1px solid #5a1f25", borderRadius: 10, padding: 10, fontSize: 12, margin: "0 16px 8px", wordBreak: "break-word" },
};

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
