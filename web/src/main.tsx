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
  fundUser, resetNet, sendHeartbeat, runAd, uploadAd, fundCampaign, uploadClip, watchClip,
  videoSrc, connectTempoAccount, createCampaign,
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
  const [key, setKey] = useState(""); const [role, setRole] = useState<"viewer" | "creator" | "advertiser">("creator"); const [busy, setBusy] = useState(false);
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
              <option value="advertiser">as Advertiser (run ads — pays from your wallet)</option>
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

// ───────────────────────── ad watch (earn) ─────────────────────────
/** Watch a red-framed ad video and get PAID per second of proven attention.
 *  The money is pulled automatically from the advertiser's wallet (server-spawned
 *  payer); when the ad's funded budget runs out it simply stops paying. */
function AdWatch({ ad, me, onBack }: { ad: Campaign; me: DemoUser; onBack: () => void }) {
  const [attention, setAttention] = useState(true);
  const [earned, setEarned] = useState(0);
  const [paying, setPaying] = useState(false);
  const baseline = useRef<number | null>(null);
  const prev = useRef(0);
  const video = useRef<HTMLVideoElement | null>(null);

  // Drive attention: heartbeats gate the payout; runAd spawns the advertiser payer.
  useEffect(() => {
    const beat = setInterval(() => { if (attention) sendHeartbeat(ad.id, me.id); }, 1000);
    const pump = setInterval(() => { if (attention) runAd(ad.id, me.id); }, 4000);
    if (attention) { sendHeartbeat(ad.id, me.id); runAd(ad.id, me.id); }
    return () => { clearInterval(beat); clearInterval(pump); };
  }, [attention, ad.id, me.id]);

  // Poll my on-chain earnings → delta since this ad opened.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const n = await fetchNet(me.id);
        if (baseline.current == null) baseline.current = n.inUsd;
        const e = +(n.inUsd - (baseline.current ?? 0)).toFixed(6);
        setPaying(e > prev.current); prev.current = e; setEarned(e);
      } catch { /* keep last */ }
    }, 1500);
    return () => clearInterval(id);
  }, [me.id]);

  useEffect(() => { if (attention) video.current?.play().catch(() => {}); else video.current?.pause(); }, [attention]);

  const price = Number(ad.pricePerSec);
  const budget = Number(ad.maxBudget);
  const spent = ad.spentUsd ?? 0;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const funded = ad.funded ?? budget - spent >= price;

  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back to ads</button><span className="muted">earning from an ad</span></div>
      <div className="watch">
        <div>
          <div className="player ad">
            {ad.hasVideo
              ? <video ref={video} src={videoSrc(ad.id)} loop muted playsInline style={{ opacity: attention ? 1 : 0.4 }} />
              : <span className="emoji" style={{ opacity: attention ? 1 : 0.4 }}>{ad.thumb ?? "📣"}</span>}
            <span className="adtag">● AD</span>
            {!attention && <div className="ov">🙈 looked away — you’re not earning</div>}
            {!funded && <div className="ov">⛔ This ad is out of funding — it can’t pay right now.</div>}
          </div>
          <div className="w-title">{ad.title ?? ad.advertiser}</div>
          <div className="w-chan">
            <div className="a">{ad.thumb ?? "📣"}</div>
            <div><b>{ad.advertiser}</b><div className="muted" style={{ fontSize: 12.5 }}>sponsored · pays you to watch · {ad.tags.map((t) => "#" + t).join(" ")}</div></div>
          </div>
        </div>

        <div className="panel">
          <h3><span className={"livedot in" + (paying ? " on" : "")} /> earning — paid by advertiser</h3>
          <div className="bignum in">+ {usd(earned)}</div>
          <div className="statline"><span className="k">rate</span><span>{usd(price)}/sec</span></div>
          <div>
            <div className="statline" style={{ marginBottom: 5 }}><span className="k">ad funding used</span><span>{usd(spent)} / {usd(budget)}</span></div>
            <div className="bar"><i style={{ width: pct + "%", background: "linear-gradient(90deg,var(--out),#ff9356)" }} /></div>
            <div className="statline" style={{ marginTop: 5 }}><span className="k">budget left</span><span style={{ color: funded ? "var(--in)" : "var(--out)" }}>{usd(Math.max(0, budget - spent))}</span></div>
          </div>
          <MoneyFlow dir="in" active={attention && paying} />
          <div className="receipt" style={{ background: "#0f141f", borderColor: "#22304a" }}>💸 Money comes straight from <b>{ad.advertiser}</b>’s wallet — automatically, per second you watch.</div>
          <div className="row">
            <button className={attention ? "btn btn-ghost" : "btn"} style={{ flex: 1 }} onClick={() => setAttention((a) => !a)}>{attention ? "Look away 🙈" : "Look back 👀"}</button>
            <button className="btn btn-ghost" onClick={onBack}>Stop</button>
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>{!funded ? "⛔ unfunded — ask the advertiser to fund it" : attention ? (paying ? "👀 attention proven — being paid" : "👀 connecting advertiser payer…") : "🙈 paused — look back to keep earning"}</div>
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
  // ad (earn)
  const [adCampaign, setAdCampaign] = useState<string | null>(null);
  // studio (creator upload)
  const [title, setTitle] = useState(""); const [tags, setTags] = useState(""); const [file, setFile] = useState<File | null>(null); const [uploading, setUploading] = useState(false);
  // ad studio (advertiser upload)
  const [adTitle, setAdTitle] = useState(""); const [adTags, setAdTags] = useState(""); const [adFile, setAdFile] = useState<File | null>(null); const [adBudget, setAdBudget] = useState("0.20"); const [publishingAd, setPublishingAd] = useState(false); const [fundingAd, setFundingAd] = useState<string | null>(null);
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
    const tick = () => {
      fetchNet(me.id).then(setNet).catch(() => {});
      fetchBalance(me.id).then(setBalance).catch(() => {});
      fetchCampaigns().then(setCampaigns).catch(() => {}); // live funding status
    };
    tick(); const id = setInterval(tick, 3000); return () => clearInterval(id);
  }, [me]);

  function login(u: DemoUser) { localStorage.setItem("tempoflow-me", JSON.stringify(u)); setMe(u); setError(null); }
  function logout() { localStorage.removeItem("tempoflow-me"); setMe(null); setAdCampaign(null); setView("home"); }
  async function submitAd() {
    if (!me || !adTitle.trim()) return; setPublishingAd(true);
    try { await uploadAd(me.id, adTitle.trim(), adTags.split(",").map((t) => t.trim()).filter(Boolean), adFile, Number(adBudget) || 0); setAdTitle(""); setAdTags(""); setAdFile(null); setAdBudget("0.20"); setCampaigns(await fetchCampaigns()); }
    catch (e: any) { setError(e?.message ?? String(e)); } setPublishingAd(false);
  }
  async function doFundAd(id: string) {
    setFundingAd(id);
    try { await fundCampaign(id, 0.2); setCampaigns(await fetchCampaigns()); if (me) setBalance(await fetchBalance(me.id)); }
    catch (e: any) { setError(e?.message ?? String(e)); } setFundingAd(null);
  }
  async function getFunds() { if (!me) return; setFunding(true); try { await fundUser(me.id); setBalance(await fetchBalance(me.id)); } catch (e: any) { setError(e?.message); } setFunding(false); }
  async function refreshAdmin() { try { setAdmins(await fetchAdminUsers()); } catch (e: any) { setError(e?.message); } }
  async function submitUpload() {
    if (!me || !file || !title.trim()) return; setUploading(true);
    try { await uploadClip(me.id, title.trim(), tags.split(",").map((t) => t.trim()).filter(Boolean), file, 60); setTitle(""); setTags(""); setFile(null); refreshFeed(); }
    catch (e: any) { setError(e?.message ?? String(e)); } setUploading(false);
  }

  if (!me) return users.length ? <><Login users={users} onLogin={login} onError={setError} />{error && <div className="login"><div className="toast-err">{error}<button className="btn-ghost btn btn-sm" onClick={() => setError(null)}>×</button></div></div>}</> : <div className="login"><div className="muted" style={{ padding: 40, textAlign: "center" }}>{error ?? "loading TempoFlow…"}</div></div>;

  const myClips = feed.filter((c) => c.ownerId === me.id);
  const myAds = campaigns.filter((c) => c.ownerId === me.id);
  const activeAd = adCampaign ? campaigns.find((c) => c.id === adCampaign) ?? null : null;
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
        : view === "earn" && activeAd
        ? <AdWatch key={activeAd.id} ad={activeAd} me={me} onBack={() => setAdCampaign(null)} />
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
              <div className="section-title">Earn — watch ads, get paid for your attention</div>
              <div className="muted" style={{ margin: "-8px 2px 14px", fontSize: 13 }}>Each ad pays you per second straight from the advertiser’s wallet. Ads with no funding can’t pay.</div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
                {campaigns.map((c) => {
                  const spent = c.spentUsd ?? 0, budget = Number(c.maxBudget);
                  const funded = c.funded ?? budget - spent >= Number(c.pricePerSec);
                  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                  return (
                    <div key={c.id} className="vcard" onClick={() => funded && setAdCampaign(c.id)} style={{ cursor: funded ? "pointer" : "default" }}>
                      <div className="vthumb ad">
                        {c.hasVideo ? <video src={videoSrc(c.id) + "#t=0.1"} preload="metadata" muted playsInline /> : <span className="emoji">{c.thumb ?? "📣"}</span>}
                        <span className="adtag">● AD</span>
                        <span className="badge in-badge">+{usd(Number(c.pricePerSec))}/s</span>
                        {funded ? <div className="play">▶</div> : <div className="ov" style={{ fontSize: 13 }}>⛔ needs funding</div>}
                      </div>
                      <div className="vmeta">
                        <div className="a">{c.thumb ?? "📣"}</div>
                        <div style={{ flex: 1 }}>
                          <div className="vtitle">{c.title ?? c.advertiser}</div>
                          <div className="vchan">{c.advertiser} · sponsored</div>
                          <div className="bar" style={{ marginTop: 7 }}><i style={{ width: pct + "%", background: "linear-gradient(90deg,var(--out),#ff9356)" }} /></div>
                          <div className="vchan" style={{ marginTop: 4 }}>{funded ? <>funded · {usd(Math.max(0, budget - spent))} left</> : <span style={{ color: "var(--out)" }}>out of funding</span>}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>)}

            {view === "campaigns" && (<>
              <div className="section-title">Ad Studio</div>
              <div className="login-card" style={{ marginTop: 0, marginBottom: 18 }}>
                <h3 style={{ marginTop: 0 }}>Upload an ad</h3>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Your ad pays viewers per second of proven attention — <b>straight from your wallet, automatically</b>. Set a funded budget; when it runs out the ad stops paying.</div>
                <div className="row" style={{ flexDirection: "column", gap: 9 }}>
                  <input className="input" placeholder="Ad title" value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
                  <input className="input" placeholder="tags (comma separated)" value={adTags} onChange={(e) => setAdTags(e.target.value)} />
                  <input className="input" type="file" accept="video/*" onChange={(e) => setAdFile(e.target.files?.[0] ?? null)} />
                  <div className="row">
                    <input className="input" type="number" step="0.05" min="0" placeholder="budget $" value={adBudget} onChange={(e) => setAdBudget(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn" onClick={submitAd} disabled={!adTitle.trim() || publishingAd}>{publishingAd ? "publishing…" : "⬆ Publish ad"}</button>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>Budget is your committed spend cap — top up anytime. Need test funds in your wallet? Use 🚰 above.</div>
                </div>
              </div>
              <div className="section-title">Your ads ({myAds.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {myAds.map((c) => {
                  const spent = c.spentUsd ?? 0, budget = Number(c.maxBudget), left = Math.max(0, budget - spent);
                  const funded = c.funded ?? left >= Number(c.pricePerSec);
                  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                  return (
                    <div key={c.id} className="adrow">
                      <div className="adrow-thumb ad">
                        {c.hasVideo ? <video src={videoSrc(c.id) + "#t=0.1"} muted playsInline /> : <span style={{ fontSize: 30 }}>{c.thumb ?? "📣"}</span>}
                        <span className="adtag">● AD</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{c.title ?? c.id}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{usd(Number(c.pricePerSec))}/sec · {c.tags.join(", ") || "untargeted"}</div>
                        <div className="bar" style={{ marginTop: 7 }}><i style={{ width: pct + "%", background: "linear-gradient(90deg,var(--out),#ff9356)" }} /></div>
                        <div className="statline" style={{ marginTop: 5 }}><span className="k">funded budget</span><span>{usd(spent)} / {usd(budget)} · {usd(left)} left</span></div>
                        <div className="statline"><span className="k">your wallet (pays the ad)</span><span>{c.advertiserBalance != null ? fmtBal(c.advertiserBalance) : "…"}</span></div>
                      </div>
                      <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                        <span className={"chip " + (funded ? "chip-ok" : "chip-bad")}>{funded ? "✓ funded" : "⛔ unfunded"}</span>
                        <button className="btn btn-faucet btn-sm" onClick={() => doFundAd(c.id)} disabled={fundingAd === c.id}>{fundingAd === c.id ? "funding…" : "＋ Fund $0.20"}</button>
                      </div>
                    </div>
                  );
                })}
                {!myAds.length && <div className="muted">No ads yet — upload one above.</div>}
              </div>
              <div className="receipt" style={{ marginTop: 12 }}>paid to viewers this session (from your wallet): <b>{usd(net?.outUsd ?? 0)}</b></div>
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
