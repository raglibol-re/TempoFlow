/**
 * FLOW — multi-user, role-based dashboard (YouTube/Twitch-style).
 *  - Login as a viewer, creator, advertiser or admin.
 *  - Viewers watch videos (money OUT per second; video pauses if funding stops).
 *  - Creators upload videos (Studio) and earn.
 *  - Advertisers run campaigns that pay viewers for attention (money IN).
 *  - Admin manages users + adds test funds.
 *  - "Get test funds" faucet for everyone. Fancy canvas money-flow viz.
 * ⚠️ TESTNET ONLY.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Clip, Campaign } from "@flow/shared";
import {
  fetchUsers, fetchFeed, fetchCampaigns, fetchNet, fetchAdminUsers, fundUser,
  resetNet, sendHeartbeat, runAd, createCampaign, uploadClip, watchClip, videoSrc, diagnose,
  type DemoUser, type AdminUser, type Tick, type CloseSummary, type WatchHandle, type NetSnapshot,
} from "./flow";

// ─────────────────────────── Fancy money-flow canvas ───────────────────────
function MoneyFlow({ dir, active, label }: { dir: "in" | "out"; active: boolean; label: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const W = (cv.width = cv.offsetWidth * dpr);
    const H = (cv.height = 46 * dpr);
    const color = dir === "out" ? [255, 122, 122] : [70, 211, 154];
    const parts: { x: number; y: number; v: number; r: number; a: number }[] = [];
    let raf = 0;
    const spawn = () => {
      const fromLeft = dir === "in";
      parts.push({ x: fromLeft ? -8 : W + 8, y: Math.random() * H, v: (1.5 + Math.random() * 2.5) * dpr * (fromLeft ? 1 : -1), r: (1.5 + Math.random() * 2.5) * dpr, a: 1 });
    };
    let acc = 0;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      if (activeRef.current && (acc += 1) % 3 === 0) spawn();
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        p.x += p.v;
        p.a -= 0.004;
        if (p.a <= 0 || p.x < -12 || p.x > W + 12) { parts.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${p.a})`;
        ctx.shadowBlur = 8 * dpr; ctx.shadowColor = `rgba(${color[0]},${color[1]},${color[2]},0.9)`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [dir]);
  return (
    <div style={{ position: "relative" }}>
      <canvas ref={ref} style={{ width: "100%", height: 46, display: "block", borderRadius: 10, background: "#0c0c14" }} />
      <span style={{ position: "absolute", top: 14, [dir === "out" ? "right" : "left"]: 10, fontSize: 11, color: dir === "out" ? "#ff7a7a" : "#46d39a", opacity: active ? 0.95 : 0.4 } as any}>
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────── Login ─────────────────────────────────────
const ROLE_LABEL: Record<string, string> = { viewer: "Viewers", creator: "Creators", advertiser: "Advertisers", admin: "Admin" };
function Login({ users, onPick }: { users: DemoUser[]; onPick: (u: DemoUser) => void }) {
  const roles = ["viewer", "creator", "advertiser", "admin"];
  return (
    <div style={s.page}>
      <div style={{ ...s.col, maxWidth: 460, paddingTop: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 30, color: "#5b8cff" }}>FLOW</div>
          <div style={{ opacity: 0.6, fontSize: 13 }}>pick an account to log in (TESTNET demo)</div>
        </div>
        {roles.map((role) => {
          const us = users.filter((u) => u.role === role);
          if (!us.length) return null;
          return (
            <div key={role} style={s.card}>
              <div style={s.tag}>{ROLE_LABEL[role]}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {us.map((u) => (
                  <button key={u.id} style={s.loginBtn} onClick={() => onPick(u)}>
                    <span style={{ fontSize: 20 }}>{u.avatar}</span>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                      <b style={{ fontSize: 13 }}>{u.name}</b>
                      <span style={{ fontSize: 11, opacity: 0.6 }}>@{u.handle}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────── Clip player (gated) ───────────────────────────
function ClipCard({ clip, me, lowFunds, onError }: { clip: Clip; me: DemoUser; lowFunds: boolean; onError: (e: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "opening" | "watching" | "paused" | "closing" | "done">("idle");
  const [spent, setSpent] = useState(0);
  const [reason, setReason] = useState<"ended" | "out-of-funds" | null>(null);
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const handle = useRef<WatchHandle | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const lastTick = useRef(0);
  const capping = useRef(false);
  const collab = clip.recipients.length > 1;
  const LOW_FUNDS_CAP = 0.012; // ~6 seconds of watchtime

  // Stall detector: pause video if payments stop flowing.
  useEffect(() => {
    if (phase !== "watching") return;
    const id = setInterval(() => {
      if (Date.now() - lastTick.current > 2500) { setPhase("paused"); video.current?.pause(); }
    }, 500);
    return () => clearInterval(id);
  }, [phase]);

  async function start() {
    setSummary(null); setSpent(0); setReason(null); capping.current = false; setPhase("opening");
    try {
      handle.current = await watchClip(clip, me,
        (t: Tick) => {
          lastTick.current = Date.now(); setSpent(t.spentUsd); setPhase("watching"); video.current?.play().catch(() => {});
          // Low-funds demo: the viewer's session budget runs out → stop paying → stop video.
          if (lowFunds && t.spentUsd >= LOW_FUNDS_CAP && !capping.current) { capping.current = true; closeOut("out-of-funds"); }
        },
        (r) => { if (!capping.current) { setReason(r); setPhase("paused"); video.current?.pause(); } });
    } catch (e: any) {
      onError(e?.message ?? String(e)); setPhase("idle");
      diagnose("watch-open-failed", { clip: clip.id, me: me.id, err: String(e?.message ?? e) }).catch(() => {});
    }
  }
  async function closeOut(why: "ended" | "out-of-funds") {
    if (!handle.current) return;
    setReason(why); video.current?.pause(); setPhase("closing");
    try { setSummary((await handle.current.stop()) ?? null); } catch (e: any) { onError(e?.message ?? String(e)); }
    handle.current = null; setPhase(why === "out-of-funds" ? "paused" : "done");
  }
  const watching = phase === "watching" || phase === "paused" || phase === "opening";

  return (
    <div style={{ ...s.card, ...(watching ? s.cardActive : {}) }}>
      <div style={s.tag}>creator · money out</div>
      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#0c0c14", aspectRatio: "16/9", display: "grid", placeItems: "center" }}>
        {clip.hasVideo ? (
          <video ref={video} src={videoSrc(clip.id)} muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover", opacity: phase === "paused" ? 0.5 : 1 }} />
        ) : (
          <div style={{ fontSize: 54, opacity: phase === "watching" ? 1 : 0.5 }}>{clip.thumb ?? "🎬"}</div>
        )}
        {phase === "paused" && <div style={s.overlay}>{reason === "out-of-funds" ? "⛔ out of funds — payment stopped, so the video stopped. Press ▶ Watch to continue." : "⏸ payment paused — press ▶ Watch to resume"}</div>}
        {phase === "opening" && <div style={s.overlay}>opening payment channel…</div>}
      </div>
      <div style={{ fontWeight: 600 }}>{clip.title}</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>@{clip.creator} · ${clip.pricePerSec}/sec{clip.hasVideo ? "" : " · (placeholder)"}</div>
      {collab && <div style={s.split}>split: {clip.recipients.map((r, i) => <span key={i}>{i ? " · " : ""}{r.label} {r.percentage}%</span>)}</div>}
      {watching && <><div style={s.out}>− ${spent.toFixed(3)}</div><MoneyFlow dir="out" active={phase === "watching"} label="→ creator" /></>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={s.btn} onClick={start} disabled={phase === "opening" || phase === "watching" || phase === "closing"}>
          {phase === "opening" ? "opening…" : phase === "watching" ? "watching…" : phase === "paused" ? "▶ Resume" : "▶ Watch"}
        </button>
        <button style={s.ghost} onClick={() => closeOut("ended")} disabled={phase !== "watching"}>Skip ⏭</button>
      </div>
      {summary && <div style={s.receipt}>✓ paid ${summary.spentUsd?.toFixed(3)} · refunded ${summary.refundUsd?.toFixed(3)}{collab && summary.spentUsd != null && clip.recipients.map((r, i) => <div key={i} style={{ opacity: 0.85 }}>→ {r.label}: ${((summary.spentUsd! * r.percentage) / 100).toFixed(4)}</div>)}</div>}
    </div>
  );
}

// ─────────────────────────────── App ───────────────────────────────────────
function App() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [me, setMe] = useState<DemoUser | null>(null);
  const [feed, setFeed] = useState<Clip[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [net, setNet] = useState<NetSnapshot | null>(null);
  const [tab, setTab] = useState("home");
  const [error, setError] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [lowFunds, setLowFunds] = useState(false);
  const [myBalance, setMyBalance] = useState<number | null>(null);

  // ad
  const [adCampaign, setAdCampaign] = useState<string | null>(null);
  const [attention, setAttention] = useState(true);
  const [adPaying, setAdPaying] = useState(false);
  const inPrev = useRef(0);
  // studio
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // admin
  const [admins, setAdmins] = useState<AdminUser[]>([]);

  useEffect(() => {
    fetchUsers().then((us) => {
      setUsers(us);
      const saved = localStorage.getItem("flow-me");
      const found = saved && us.find((u) => u.id === saved);
      if (found) setMe(found);
    }).catch((e) => setError(e.message));
    fetchFeed().then(setFeed).catch((e) => setError(e.message));
    fetchCampaigns().then(setCampaigns).catch(() => {});
    diagnose("app-load").catch(() => {});
  }, []);

  useEffect(() => {
    if (!me) return;
    setTab(me.role === "advertiser" ? "campaigns" : me.role === "admin" ? "admin" : "home");
    const id = setInterval(() => fetchNet(me.id).then(setNet).catch(() => {}), 1000);
    return () => clearInterval(id);
  }, [me]);

  useEffect(() => {
    if (!me || !adCampaign) return;
    const beat = setInterval(() => { if (attention) sendHeartbeat(adCampaign, me.id); }, 1000);
    const pump = setInterval(() => { if (attention) runAd(adCampaign, me.id); }, 4000);
    if (attention) { sendHeartbeat(adCampaign, me.id); runAd(adCampaign, me.id); }
    return () => { clearInterval(beat); clearInterval(pump); };
  }, [adCampaign, attention, me]);

  useEffect(() => { if (net) { setAdPaying(net.inUsd > inPrev.current); inPrev.current = net.inUsd; } }, [net]);

  function login(u: DemoUser) { localStorage.setItem("flow-me", u.id); setMe(u); setError(null); }
  function logout() { localStorage.removeItem("flow-me"); setMe(null); setAdCampaign(null); }

  async function getFunds() {
    if (!me) return;
    setFunding(true);
    try { const r = await fundUser(me.id); setMyBalance(r.balance ?? null); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    setFunding(false);
  }
  async function refreshAdmin() { try { setAdmins(await fetchAdminUsers()); } catch (e: any) { setError(e?.message); } }
  async function submitUpload() {
    if (!me || !file || !title.trim()) return;
    setUploading(true);
    try {
      await uploadClip(me.id, title.trim(), tags.split(",").map((t) => t.trim()).filter(Boolean), file, 60);
      setTitle(""); setTags(""); setFile(null); setFeed(await fetchFeed());
    } catch (e: any) { setError(e?.message ?? String(e)); }
    setUploading(false);
  }

  if (!me) return users.length ? <Login users={users} onPick={login} /> : <div style={s.page}><div style={{ padding: 40, opacity: 0.7 }}>{error ?? "loading…"}</div></div>;

  const netUsd = net?.netUsd ?? 0;
  const myClips = feed.filter((c) => c.ownerId === me.id);
  const tabs: [string, string][] = me.role === "admin" ? [["admin", "🛠️ Users"]]
    : me.role === "advertiser" ? [["campaigns", "📣 Campaigns"], ["earn", "💸 Watch"]]
    : me.role === "creator" ? [["home", "🏠 Home"], ["studio", "🎬 Studio"], ["earn", "💸 Earn"]]
    : [["home", "🏠 Home"], ["earn", "💸 Earn"]];

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <span style={{ fontWeight: 800, fontSize: 20, color: "#5b8cff" }}>FLOW</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12 }}>{me.avatar} <b>{me.name}</b> <span style={{ opacity: 0.5 }}>· {me.role}</span></span>
          <button style={s.faucet} onClick={getFunds} disabled={funding}>{funding ? "funding…" : "🚰 Get test funds"}</button>
          <button style={s.reset} onClick={logout}>logout</button>
        </div>
      </div>

      <div style={s.idbar}>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          @{me.handle} · {me.address.slice(0, 6)}…{me.address.slice(-4)}{myBalance != null ? ` · wallet $${myBalance.toFixed(2)}` : ""}
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: 10, opacity: 0.6 }}>net </span>
          <span style={{ fontSize: 18, fontWeight: 800, color: netUsd >= 0 ? "#46d39a" : "#ff7a7a" }}>{netUsd >= 0 ? "+" : "−"}${Math.abs(netUsd).toFixed(3)}</span>
          <span style={{ fontSize: 10 }}> <span style={{ color: "#46d39a" }}>▲{net?.inUsd.toFixed(3) ?? "0"}</span> <span style={{ color: "#ff7a7a" }}>▼{net?.outUsd.toFixed(3) ?? "0"}</span> <button style={s.reset} onClick={() => resetNet()}>reset</button></span>
        </div>
      </div>

      {tabs.length > 1 && (
        <div style={s.tabs}>{tabs.map(([t, lbl]) => <button key={t} onClick={() => setTab(t)} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>{lbl}</button>)}</div>
      )}

      {error && <div style={s.error}>⚠ {error} <button style={s.reset} onClick={() => setError(null)}>dismiss</button></div>}

      <div style={s.body}>
        {/* Home — feed */}
        {tab === "home" && (
          <label style={{ ...s.card, flexDirection: "row", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={lowFunds} onChange={(e) => setLowFunds(e.target.checked)} />
            <span style={{ fontSize: 13 }}>⚡ <b>Low-funds demo</b> — cap the channel so payment runs out after ~6s and the video stops</span>
          </label>
        )}
        {tab === "home" && feed.map((clip) => <ClipCard key={clip.id} clip={clip} me={me} lowFunds={lowFunds} onError={setError} />)}

        {/* Studio — upload */}
        {tab === "studio" && (
          <>
            <div style={s.card}>
              <div style={s.tag}>upload to your channel</div>
              <input style={s.input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <input style={s.input} placeholder="tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
              <input style={s.input} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button style={s.btn} onClick={submitUpload} disabled={!file || !title.trim() || uploading}>{uploading ? "uploading…" : "⬆ Upload video"}</button>
              <div style={{ fontSize: 11, opacity: 0.6 }}>stored locally (SQLite + file); viewers pay you ${"0.002"}/sec to your wallet</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.6, margin: "2px" }}>your clips ({myClips.length})</div>
            {myClips.map((c) => <div key={c.id} style={s.card}><div style={{ fontWeight: 600 }}>{c.hasVideo ? "🎬" : "📄"} {c.title}</div><div style={{ fontSize: 12, opacity: 0.6 }}>{c.tags.join(" · ") || "—"}{c.hasVideo ? " · video" : " · no video"}</div></div>)}
            <div style={s.receipt}>channel earnings this session: <b>${net?.inUsd.toFixed(3) ?? "0.000"}</b></div>
          </>
        )}

        {/* Earn — ads */}
        {tab === "earn" && campaigns.map((c) => {
          const w = adCampaign === c.id;
          return (
            <div key={c.id} style={{ ...s.adcard, ...(w ? s.cardActive : {}) }}>
              <div style={s.tag}>ad · money in</div>
              <div style={{ fontWeight: 600 }}>📣 {c.advertiser}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>pays ${c.pricePerSec}/sec for attention</div>
              {w && <><div style={s.in}>+ ${net?.inUsd.toFixed(3) ?? "0.000"}</div><MoneyFlow dir="in" active={attention && adPaying} label="← advertiser" />
                <div style={{ fontSize: 12, opacity: 0.75 }}>{attention ? (adPaying ? "👀 attention proven — being paid" : "👀 connecting advertiser…") : "🙈 looked away — paused"}</div></>}
              <div style={{ display: "flex", gap: 8 }}>
                {!w ? <button style={s.btn} onClick={() => { setAdCampaign(c.id); setAttention(true); }}>▶ Watch ad</button>
                  : <><button style={attention ? s.ghost : s.btn} onClick={() => setAttention((a) => !a)}>{attention ? "Look away 🙈" : "Look back 👀"}</button><button style={s.ghost} onClick={() => setAdCampaign(null)}>Stop</button></>}
              </div>
            </div>
          );
        })}

        {/* Campaigns — advertiser */}
        {tab === "campaigns" && (
          <>
            <div style={s.card}>
              <div style={s.tag}>advertiser · money out</div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>Your campaigns pay viewers per second of <b>proven attention</b>. When a viewer watches your ad (Earn tab), you pay them automatically.</div>
              <button style={s.btn} onClick={async () => { try { await createCampaign(me.id, ["sponsored"]); setCampaigns(await fetchCampaigns()); } catch (e: any) { setError(e?.message); } }}>＋ New campaign</button>
            </div>
            {campaigns.filter((c) => c.ownerId === me.id).map((c) => <div key={c.id} style={s.card}><div style={{ fontWeight: 600 }}>📣 {c.id}</div><div style={{ fontSize: 12, opacity: 0.7 }}>${c.pricePerSec}/sec · budget ${c.maxBudget} · {c.tags.join(", ")}</div></div>)}
            <div style={s.receipt}>spent this session: <b>${net?.outUsd.toFixed(3) ?? "0.000"}</b></div>
          </>
        )}

        {/* Admin — user management */}
        {tab === "admin" && (
          <>
            <div style={s.card}>
              <div style={s.tag}>admin · user management</div>
              <button style={s.btn} onClick={refreshAdmin}>↻ Load users + balances</button>
            </div>
            {admins.map((u) => (
              <div key={u.id} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div><b>{u.avatar} {u.name}</b> <span style={{ opacity: 0.5, fontSize: 12 }}>· {u.role}</span><div style={{ fontSize: 11, opacity: 0.6 }}>@{u.handle} · {u.address.slice(0, 8)}…</div></div>
                  <div style={{ textAlign: "right" }}><div style={{ fontWeight: 700 }}>${u.balance.toFixed(2)}</div>
                    <button style={s.faucet} onClick={async () => { try { await fundUser(u.id); await refreshAdmin(); } catch (e: any) { setError(e?.message); } }}>+ add funds</button></div>
                </div>
              </div>
            ))}
            {!admins.length && <div style={{ opacity: 0.6, fontSize: 13, padding: 8 }}>Click "Load users + balances".</div>}
          </>
        )}

        {/* receipts (non-admin) */}
        {tab !== "admin" && net && net.events.length > 0 && (
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

const s: Record<string, any> = {
  page: { minHeight: "100vh", margin: 0, background: "#0b0b12", color: "#f2f2f7", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", alignItems: "center" },
  col: { width: "100%", display: "flex", flexDirection: "column", gap: 12, padding: 16 },
  topbar: { width: "100%", maxWidth: 480, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", flexWrap: "wrap", gap: 8 },
  idbar: { width: "100%", maxWidth: 480, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 16px 8px" },
  tabs: { width: "100%", maxWidth: 480, display: "flex", gap: 6, padding: "0 16px 8px" },
  tab: { flex: 1, padding: "8px", borderRadius: 9, border: "1px solid #2a2a3a", background: "#15151f", color: "#f2f2f7", cursor: "pointer", fontSize: 13 },
  tabActive: { border: "1px solid #5b8cff", background: "#1a2240" },
  body: { width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 10, padding: "0 16px 28px", overflowY: "auto", flex: 1 },
  card: { background: "#15151f", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 7, border: "1px solid transparent" },
  adcard: { background: "linear-gradient(160deg,#11201a,#15151f)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 7, border: "1px solid transparent" },
  cardActive: { border: "1px solid #5b8cff", boxShadow: "0 0 20px rgba(91,140,255,0.22)" },
  tag: { fontSize: 10, textTransform: "uppercase", letterSpacing: 1, opacity: 0.45 },
  split: { fontSize: 11, opacity: 0.8, background: "#0f0f17", borderRadius: 7, padding: "5px 7px" },
  out: { fontSize: 24, fontWeight: 700, color: "#ff7a7a" },
  in: { fontSize: 24, fontWeight: 700, color: "#46d39a" },
  overlay: { position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 12, background: "rgba(0,0,0,0.55)", fontSize: 13, fontWeight: 600 },
  btn: { flex: 1, padding: "10px 14px", borderRadius: 9, border: "none", background: "#5b8cff", color: "white", fontWeight: 600, cursor: "pointer" },
  ghost: { flex: 1, padding: "10px 14px", borderRadius: 9, border: "1px solid #333", background: "transparent", color: "#f2f2f7", cursor: "pointer" },
  loginBtn: { display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: 10, border: "1px solid #2a2a3a", background: "#0f0f17", color: "#f2f2f7", cursor: "pointer" },
  faucet: { padding: "6px 10px", borderRadius: 8, border: "1px solid #2a5a3a", background: "#10301e", color: "#7fe0a8", cursor: "pointer", fontSize: 12 },
  reset: { fontSize: 11, background: "transparent", color: "#888", border: "1px solid #333", borderRadius: 6, cursor: "pointer", padding: "2px 6px" },
  input: { padding: "10px", borderRadius: 9, border: "1px solid #2a2a3a", background: "#0f0f17", color: "#f2f2f7", fontSize: 14 },
  receipt: { background: "#0f1a10", border: "1px solid #1f3d22", borderRadius: 10, padding: 10, fontSize: 13 },
  events: { background: "#0f0f17", borderRadius: 12, padding: 10, fontSize: 12, display: "flex", flexDirection: "column", gap: 3 },
  error: { width: "100%", maxWidth: 480, background: "#2a0f12", border: "1px solid #5a1f25", borderRadius: 10, padding: 10, fontSize: 12, margin: "0 16px 8px", wordBreak: "break-word" },
};

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
