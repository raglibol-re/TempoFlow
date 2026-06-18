/**
 * TempoFlow — pay-per-second streaming (Twitch/YouTube/DAZN-style).
 * Watch creators (money out/sec), earn from ads (money in/sec), upload videos,
 * run campaigns, admin user management. Log in as a demo account or your own
 * Tempo wallet. ⚠️ TESTNET ONLY.
 */
import "./styles.css";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Clip, Campaign } from "@flow/shared";
import {
  fetchUsers, fetchFeed, fetchCampaigns, fetchNet, fetchBalance, fetchAdminUsers,
  fundUser, resetNet, sendHeartbeat, runAd, createCampaign, uploadClip, watchClip,
  videoSrc, connectTempoAccount,
  type DemoUser, type AdminUser, type Tick, type CloseSummary, type WatchHandle, type NetSnapshot,
} from "./flow";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const fmtBal = (n: number) => "$" + compact.format(n);
const usd = (n: number) => "$" + n.toFixed(3);

// ───────────────────────── money-flow canvas ─────────────────────────
function MoneyFlow({ dir, active }: { dir: "in" | "out"; active: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const on = useRef(active); on.current = active;
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const W = (cv.width = cv.offsetWidth * dpr), H = (cv.height = 44 * dpr);
    const col = dir === "out" ? [255, 93, 115] : [43, 217, 160];
    const ps: { x: number; y: number; v: number; r: number; a: number }[] = [];
    let raf = 0, acc = 0;
    const loop = () => {
      ctx.clearRect(0, 0, W, H);
      if (on.current && ++acc % 3 === 0) {
        const fl = dir === "in";
        ps.push({ x: fl ? -6 : W + 6, y: Math.random() * H, v: (1.6 + Math.random() * 2.6) * dpr * (fl ? 1 : -1), r: (1.4 + Math.random() * 2.4) * dpr, a: 1 });
      }
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]!; p.x += p.v; p.a -= 0.004;
        if (p.a <= 0 || p.x < -10 || p.x > W + 10) { ps.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${p.a})`;
        ctx.shadowBlur = 8 * dpr; ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},.9)`; ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    loop(); return () => cancelAnimationFrame(raf);
  }, [dir]);
  return <canvas ref={ref} className="flowcanvas" />;
}

// ───────────────────────── login ─────────────────────────
const ROLES: Record<string, string> = { viewer: "Viewers", creator: "Creators", advertiser: "Advertisers", admin: "Admin" };
function Login({ users, onLogin, onError }: { users: DemoUser[]; onLogin: (u: DemoUser) => void; onError: (e: string) => void }) {
  const [key, setKey] = useState(""); const [role, setRole] = useState<"viewer" | "creator">("creator"); const [busy, setBusy] = useState(false);
  const demo = users.filter((u) => u.key); // exclude registered external accounts (no key here)
  async function connect() {
    if (!key.trim()) return; setBusy(true);
    try { onLogin(await connectTempoAccount(key, role)); } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  return (
    <div className="login">
      <div className="brand" style={{ fontSize: 30, justifyContent: "center" }}><span className="dot" />Tempo<b>Flow</b></div>
      <div className="muted" style={{ textAlign: "center", marginTop: 6 }}>Pay-per-second streaming on Tempo. Log in to start.</div>

      <div className="login-card">
        <h3 style={{ marginTop: 0 }}>🪪 Log in with your Tempo account</h3>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Paste your Tempo <b>testnet</b> private key — it stays in your browser (never sent to the server). Don't use a mainnet key.</div>
        <div className="row" style={{ flexDirection: "column", gap: 8 }}>
          <input className="input" type="password" placeholder="0x… testnet private key" value={key} onChange={(e) => setKey(e.target.value)} />
          <div className="row">
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as any)} style={{ flex: 1 }}>
              <option value="creator">as Creator (watch + upload + earn)</option>
              <option value="viewer">as Viewer (watch + earn)</option>
            </select>
            <button className="btn" onClick={connect} disabled={busy || !key.trim()}>{busy ? "connecting…" : "Connect"}</button>
          </div>
        </div>
      </div>

      <div className="login-card">
        <h3 style={{ marginTop: 0 }}>Or use a demo account</h3>
        {["viewer", "creator", "advertiser", "admin"].map((r) => {
          const us = demo.filter((u) => u.role === r); if (!us.length) return null;
          return (
            <div key={r} style={{ marginBottom: 10 }}>
              <div className="role-chip" style={{ marginBottom: 6 }}>{ROLES[r]}</div>
              <div className="login-grid">
                {us.map((u) => (
                  <button key={u.id} className="login-acct" onClick={() => onLogin(u)}>
                    <span style={{ fontSize: 18 }}>{u.avatar}</span>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                      <b style={{ fontSize: 13 }}>{u.name}</b><span className="muted" style={{ fontSize: 11 }}>@{u.handle}</span>
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

// ───────────────────────── video card / grid ─────────────────────────
function VideoCard({ clip, onOpen }: { clip: Clip; onOpen: () => void }) {
  return (
    <div className="vcard" onClick={onOpen}>
      <div className="vthumb">
        {clip.hasVideo
          ? <video src={videoSrc(clip.id) + "#t=0.1"} preload="metadata" muted playsInline />
          : <span className="emoji">{clip.thumb ?? "🎬"}</span>}
        <div className="play">▶</div>
        <span className="badge">${clip.pricePerSec}/s</span>
        {clip.tags.includes("live") && <span className="badge live">● LIVE</span>}
      </div>
      <div className="vmeta">
        <div className="a">{clip.thumb ?? "🎬"}</div>
        <div>
          <div className="vtitle">{clip.title}</div>
          <div className="vchan">@{clip.creator}{clip.recipients.length > 1 ? " · collab" : ""}</div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── watch view (payment panel) ─────────────────────────
const LOW_CAP = 0.012;
function WatchView({ clip, me, onBack, onError, onSettled }: { clip: Clip; me: DemoUser; onBack: () => void; onError: (e: string) => void; onSettled: () => void }) {
  const [phase, setPhase] = useState<"idle" | "opening" | "watching" | "paused" | "closing">("idle");
  const [spent, setSpent] = useState(0);
  const [secs, setSecs] = useState(0);
  const [reason, setReason] = useState<"ended" | "out-of-funds" | null>(null);
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const [low, setLow] = useState(false);
  const handle = useRef<WatchHandle | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const capping = useRef(false);
  const deposit = low ? LOW_CAP : 0.5;
  const collab = clip.recipients.length > 1;

  useEffect(() => () => { handle.current?.stop().catch(() => {}); }, []);

  async function start() {
    setSummary(null); setSpent(0); setSecs(0); setReason(null); capping.current = false; setPhase("opening");
    try {
      handle.current = await watchClip(clip, me,
        (t: Tick) => {
          setPhase("watching"); setSpent(t.spentUsd); setSecs(t.second); video.current?.play().catch(() => {});
          if (low && t.spentUsd >= LOW_CAP && !capping.current) { capping.current = true; closeOut("out-of-funds"); }
        },
        (r) => { if (!capping.current) { setReason(r); setPhase("paused"); video.current?.pause(); } });
    } catch (e: any) { onError(e?.message ?? String(e)); setPhase("idle"); }
  }
  async function closeOut(why: "ended" | "out-of-funds") {
    if (!handle.current) return;
    setReason(why); video.current?.pause(); setPhase("closing");
    try { setSummary((await handle.current.stop()) ?? null); } catch (e: any) { onError(e?.message ?? String(e)); }
    handle.current = null; setPhase("paused"); onSettled();
  }
  const live = phase === "watching";
  const pct = Math.min(100, (spent / deposit) * 100);

  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back</button><span className="muted">watching</span></div>
      <div className="watch">
        <div>
          <div className="player">
            {clip.hasVideo
              ? <video ref={video} src={videoSrc(clip.id)} loop muted playsInline style={{ opacity: phase === "paused" ? 0.4 : 1 }} />
              : <span className="emoji" style={{ opacity: live ? 1 : 0.5 }}>{clip.thumb ?? "🎬"}</span>}
            {phase === "idle" && <div className="ov">▶ Press “Watch” to start — you’ll pay {usd(Number(clip.pricePerSec))}/sec to the creator</div>}
            {phase === "opening" && <div className="ov">opening payment channel on Tempo… (~3–6s)</div>}
            {phase === "paused" && <div className="ov">{reason === "out-of-funds" ? "⛔ Out of funds — payment stopped, so playback stopped." : "⏸ Paused — payment stopped."}</div>}
          </div>
          <div className="w-title">{clip.title}</div>
          <div className="w-chan">
            <div className="a">{clip.thumb ?? "🎬"}</div>
            <div><b>@{clip.creator}</b><div className="muted" style={{ fontSize: 12.5 }}>{clip.tags.map((t) => "#" + t).join(" ")}</div></div>
          </div>
          {collab && <div className="receipt" style={{ marginTop: 12 }}>Revenue split: {clip.recipients.map((r, i) => <span key={i}>{i ? " · " : ""}<b>{r.label}</b> {r.percentage}%</span>)}</div>}
        </div>

        {/* payment panel */}
        <div className="panel">
          <h3><span className={"livedot" + (live ? " on" : "")} /> pay-per-second → creator</h3>
          <div className="bignum out">− {usd(spent)}</div>
          <div className="statline"><span className="k">rate</span><span>{usd(Number(clip.pricePerSec))}/sec</span></div>
          <div className="statline"><span className="k">watched</span><span>{secs}s</span></div>
          <div>
            <div className="statline" style={{ marginBottom: 5 }}><span className="k">channel deposit</span><span>{usd(spent)} / {usd(deposit)}</span></div>
            <div className="bar"><i style={{ width: pct + "%" }} /></div>
            <div className="statline" style={{ marginTop: 5 }}><span className="k">refundable on stop</span><span style={{ color: "var(--in)" }}>{usd(Math.max(0, deposit - spent))}</span></div>
          </div>
          <MoneyFlow dir="out" active={live} />
          <div className="row">
            {phase === "idle" || phase === "paused"
              ? <button className="btn" onClick={start} style={{ flex: 1 }}>{phase === "paused" ? "▶ Resume" : "▶ Watch"}</button>
              : <button className="btn" disabled style={{ flex: 1 }}>{phase === "opening" ? "opening…" : "watching…"}</button>}
            <button className="btn btn-ghost" onClick={() => closeOut("ended")} disabled={phase !== "watching"}>Stop</button>
          </div>
          <label className="toggle"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Demo: limited funds (stops after ~6s)</label>
          {summary && (
            <div className="receipt">✓ settled on Tempo · paid <b>{usd(summary.spentUsd ?? 0)}</b> · refunded <b>{usd(summary.refundUsd ?? 0)}</b>
              {summary.txHash && <div className="tx">tx {summary.txHash}</div>}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── app ─────────────────────────
function App() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [me, setMe] = useState<DemoUser | null>(null);
  const [feed, setFeed] = useState<Clip[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [net, setNet] = useState<NetSnapshot | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [view, setView] = useState("home");
  const [current, setCurrent] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  // ad
  const [adCampaign, setAdCampaign] = useState<string | null>(null);
  const [attention, setAttention] = useState(true);
  const [adPaying, setAdPaying] = useState(false);
  const inPrev = useRef(0);
  // studio
  const [title, setTitle] = useState(""); const [tags, setTags] = useState(""); const [file, setFile] = useState<File | null>(null); const [uploading, setUploading] = useState(false);
  const [admins, setAdmins] = useState<AdminUser[]>([]);

  useEffect(() => {
    fetchUsers().then(setUsers).catch((e) => setError(e.message));
    refreshFeed();
    fetchCampaigns().then(setCampaigns).catch(() => {});
    try { const saved = localStorage.getItem("tempoflow-me"); if (saved) setMe(JSON.parse(saved)); } catch {}
  }, []);
  function refreshFeed() { fetchFeed().then(setFeed).catch((e) => setError(e.message)); }

  useEffect(() => {
    if (!me) return;
    setView(me.role === "advertiser" ? "campaigns" : me.role === "admin" ? "admin" : "home");
    const tick = () => { fetchNet(me.id).then(setNet).catch(() => {}); fetchBalance(me.id).then(setBalance).catch(() => {}); };
    tick(); const id = setInterval(tick, 3000); return () => clearInterval(id);
  }, [me]);

  useEffect(() => {
    if (!me || !adCampaign) return;
    const beat = setInterval(() => { if (attention) sendHeartbeat(adCampaign, me.id); }, 1000);
    const pump = setInterval(() => { if (attention) runAd(adCampaign, me.id); }, 4000);
    if (attention) { sendHeartbeat(adCampaign, me.id); runAd(adCampaign, me.id); }
    return () => { clearInterval(beat); clearInterval(pump); };
  }, [adCampaign, attention, me]);
  useEffect(() => { if (net) { setAdPaying(net.inUsd > inPrev.current); inPrev.current = net.inUsd; } }, [net]);

  function login(u: DemoUser) { localStorage.setItem("tempoflow-me", JSON.stringify(u)); setMe(u); setError(null); }
  function logout() { localStorage.removeItem("tempoflow-me"); setMe(null); setAdCampaign(null); setView("home"); }
  async function getFunds() { if (!me) return; setFunding(true); try { await fundUser(me.id); setBalance(await fetchBalance(me.id)); } catch (e: any) { setError(e?.message); } setFunding(false); }
  async function refreshAdmin() { try { setAdmins(await fetchAdminUsers()); } catch (e: any) { setError(e?.message); } }
  async function submitUpload() {
    if (!me || !file || !title.trim()) return; setUploading(true);
    try { await uploadClip(me.id, title.trim(), tags.split(",").map((t) => t.trim()).filter(Boolean), file, 60); setTitle(""); setTags(""); setFile(null); refreshFeed(); }
    catch (e: any) { setError(e?.message ?? String(e)); } setUploading(false);
  }

  if (!me) return users.length ? <><Login users={users} onLogin={login} onError={setError} />{error && <div className="login"><div className="toast-err">{error}<button className="btn-ghost btn btn-sm" onClick={() => setError(null)}>×</button></div></div>}</> : <div className="login"><div className="muted" style={{ padding: 40, textAlign: "center" }}>{error ?? "loading TempoFlow…"}</div></div>;

  const myClips = feed.filter((c) => c.ownerId === me.id);
  const person = me.role === "viewer" || me.role === "creator";
  const nav: [string, string][] = [];
  if (person || me.role === "advertiser") nav.push(["home", "Home"]);
  if (me.role === "creator") nav.push(["studio", "Studio"]);
  if (person) nav.push(["earn", "Earn"]);
  if (me.role === "advertiser") nav.push(["campaigns", "Campaigns"]);
  if (me.role === "admin") nav.push(["admin", "Users"]);
  const go = (v: string) => { setView(v); setCurrent(null); };

  return (
    <>
      <div className="nav">
        <div className="brand"><span className="dot" />Tempo<b>Flow</b></div>
        <div className="nav-links">{nav.map(([v, l]) => <button key={v} className={"nav-link" + (view === v ? " active" : "")} onClick={() => go(v)}>{l}</button>)}</div>
        <div className="nav-right">
          <span className="pill"><span className="coin">◎</span> {balance != null ? fmtBal(balance) : "…"}</span>
          <span className="pill" title="net this session">net <b style={{ color: (net?.netUsd ?? 0) >= 0 ? "var(--in)" : "var(--out)" }}>{(net?.netUsd ?? 0) >= 0 ? "+" : "−"}{usd(Math.abs(net?.netUsd ?? 0))}</b></span>
          <button className="btn btn-faucet btn-sm" onClick={getFunds} disabled={funding}>{funding ? "funding…" : "🚰 Test funds"}</button>
          <div className="avatar" title={`${me.name} · ${me.role} — click to log out`} onClick={logout}>{me.avatar}</div>
        </div>
      </div>

      {error && <div className="page" style={{ paddingBottom: 0 }}><div className="toast-err">⚠ {error}<button className="btn-ghost btn btn-sm" onClick={() => setError(null)}>×</button></div></div>}

      {view === "watch" && current
        ? <WatchView key={current.id} clip={current} me={me} onBack={() => go("home")} onError={setError} onSettled={() => { fetchNet(me.id).then(setNet).catch(() => {}); fetchBalance(me.id).then(setBalance).catch(() => {}); }} />
        : (
          <div className="page">
            {view === "home" && (<>
              <div className="section-title">Browse — pay only while you watch</div>
              {feed.length ? <div className="grid">{feed.map((c) => <VideoCard key={c.id} clip={c} onOpen={() => { setCurrent(c); setView("watch"); }} />)}</div> : <div className="muted">loading feed…</div>}
            </>)}

            {view === "studio" && (<>
              <div className="section-title">Creator Studio</div>
              <div className="login-card" style={{ marginTop: 0, marginBottom: 18 }}>
                <h3 style={{ marginTop: 0 }}>Upload a video</h3>
                <div className="row" style={{ flexDirection: "column", gap: 9 }}>
                  <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <input className="input" placeholder="tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
                  <input className="input" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <button className="btn" onClick={submitUpload} disabled={!file || !title.trim() || uploading}>{uploading ? "uploading…" : "⬆ Publish"}</button>
                  <div className="muted" style={{ fontSize: 12 }}>Stored locally (SQLite + file). Viewers pay you {usd(0.002)}/sec to your wallet.</div>
                </div>
              </div>
              <div className="section-title">Your channel ({myClips.length})</div>
              {myClips.length ? <div className="grid">{myClips.map((c) => <VideoCard key={c.id} clip={c} onOpen={() => { setCurrent(c); setView("watch"); }} />)}</div> : <div className="muted">No clips yet — upload one above.</div>}
            </>)}

            {view === "earn" && (<>
              <div className="section-title">Earn — get paid for your attention</div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
                {campaigns.map((c) => {
                  const w = adCampaign === c.id;
                  return (
                    <div key={c.id} className="adcard">
                      <div className="role-chip">ad · money in</div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>📣 {c.advertiser}</div>
                      <div className="muted" style={{ fontSize: 13 }}>pays {usd(Number(c.pricePerSec))}/sec for proven attention</div>
                      {w && <><div className="bignum in">+ {usd(net?.inUsd ?? 0)}</div><MoneyFlow dir="in" active={attention && adPaying} />
                        <div className="muted" style={{ fontSize: 12.5 }}>{attention ? (adPaying ? "👀 attention proven — being paid" : "👀 connecting advertiser…") : "🙈 looked away — paused"}</div></>}
                      <div className="row">
                        {!w ? <button className="btn" style={{ flex: 1 }} onClick={() => { setAdCampaign(c.id); setAttention(true); }}>▶ Watch ad</button>
                          : <><button className={attention ? "btn btn-ghost" : "btn"} style={{ flex: 1 }} onClick={() => setAttention((a) => !a)}>{attention ? "Look away 🙈" : "Look back 👀"}</button><button className="btn btn-ghost" onClick={() => setAdCampaign(null)}>Stop</button></>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>)}

            {view === "campaigns" && (<>
              <div className="section-title">Advertiser — campaigns</div>
              <div className="login-card" style={{ marginTop: 0, marginBottom: 16 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Your campaigns pay viewers per second of <b>proven attention</b>. When a viewer watches your ad, you pay them automatically.</div>
                <button className="btn" onClick={async () => { try { await createCampaign(me.id, ["sponsored"]); setCampaigns(await fetchCampaigns()); } catch (e: any) { setError(e?.message); } }}>＋ New campaign</button>
              </div>
              {campaigns.filter((c) => c.ownerId === me.id).map((c) => <div key={c.id} className="urow" style={{ marginBottom: 8 }}><div><b>📣 {c.id}</b><div className="muted" style={{ fontSize: 12 }}>{usd(Number(c.pricePerSec))}/sec · budget ${c.maxBudget} · {c.tags.join(", ")}</div></div></div>)}
              <div className="receipt" style={{ marginTop: 8 }}>spent this session: <b>{usd(net?.outUsd ?? 0)}</b></div>
            </>)}

            {view === "admin" && (<>
              <div className="section-title">Admin — user management</div>
              <button className="btn" style={{ marginBottom: 14 }} onClick={refreshAdmin}>↻ Load users + balances</button>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {admins.map((u) => (
                  <div key={u.id} className="urow">
                    <div><b>{u.avatar} {u.name}</b> <span className="role-chip">· {u.role}</span><div className="muted" style={{ fontSize: 11 }}>@{u.handle} · {u.address.slice(0, 10)}…</div></div>
                    <div style={{ textAlign: "right" }}><div style={{ fontWeight: 800 }}>{fmtBal(u.balance)}</div>
                      <button className="btn btn-faucet btn-sm" onClick={async () => { try { await fundUser(u.id); await refreshAdmin(); } catch (e: any) { setError(e?.message); } }}>+ add funds</button></div>
                  </div>
                ))}
                {!admins.length && <div className="muted">Click “Load users + balances”.</div>}
              </div>
            </>)}

            {/* live receipts */}
            {view !== "admin" && net && net.events.length > 0 && (
              <div className="feed-events" style={{ marginTop: 20 }}>
                <div className="role-chip">your live receipts · settled on Tempo</div>
                {net.events.slice(0, 8).map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: e.direction === "in" ? "var(--in)" : "var(--out)" }}>{e.direction === "in" ? "▲ from" : "▼ to"} {e.counterparty}</span>
                    <span className="muted">{usd(Number(e.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
