/**
 * TempoFlow — pay-per-second streaming (Twitch/YouTube/DAZN-style).
 * Watch creators (money out/sec), earn from ads (money in/sec), upload videos,
 * run campaigns, manage your profile. Payments are shown as app credit; Stripe
 * top-ups and Tempo settlement stay on the server.
 */
import "./tailwind.css";
import "./styles.css";
import { StrictMode, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { SparklesCore } from "@/components/ui/sparkles";
import { createRoot } from "react-dom/client";
import type { Clip, Campaign } from "@flow/shared";
import {
  fetchUsers, fetchFeed, fetchCampaigns, fetchNet, fetchBalance,
  fundUser, resetNet, sendHeartbeat, runAd, uploadAd, fundCampaign, uploadClip, setClipPrice, watchClip,
  videoSrc, connectTempoAccount, registerAppAccount, createTopupCheckoutSession, syncCheckoutSession, createCampaign, openAttentionSession, answerChallenge, stopAd,
  fetchProfile, updateProfile, uploadProfilePic, picSrc, followCreator, unfollowCreator,
  type DemoUser, type Tick, type CloseSummary, type WatchHandle, type NetSnapshot, type AttentionChallenge,
  type Profile as ProfileData, type PublicUser,
} from "./flow";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const nf = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 });
const usd = (n: number) => "$" + nf(n);
const fmtBal = usd;
const shortHash = (h: string) => (h.length > 22 ? `${h.slice(0, 12)}…${h.slice(-8)}` : h);
const copy = (t: string) => { try { navigator.clipboard?.writeText(t); } catch { /* no clipboard */ } };

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
const ROLES: Record<string, string> = { viewer: "Viewers", creator: "Creators", advertiser: "Advertisers" };
function Login({ users, onLogin, onError }: { users: DemoUser[]; onLogin: (u: DemoUser) => void; onError: (e: string) => void }) {
  const [key, setKey] = useState(""); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(""); const [handle, setHandle] = useState("");
  const demo = users.filter((u) => u.key && !u.id.startsWith("me-")); // seed accounts only
  async function connect() {
    if (!key.trim()) return; setBusy(true);
    try { onLogin(await connectTempoAccount(key)); } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  async function createAccount() {
    if (!name.trim() || !handle.trim()) return; setBusy(true);
    try { onLogin(await registerAppAccount(name.trim(), handle.trim())); } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  return (
    <div className="login">
      <div className="login-hero">
        <SparklesCore
          background="transparent"
          minSize={0.6}
          maxSize={1.4}
          particleDensity={90}
          speed={1.2}
          particleColor="#9147ff"
          className="login-hero-sparkles"
        />
        <div className="brand" style={{ fontSize: 30, justifyContent: "center", position: "relative", zIndex: 1 }}><span className="dot" />Tempo<b>Flow</b></div>
        {/* fade the sparkle field's edges into the page background */}
        <div className="login-hero-mask" />
      </div>
      <div className="muted" style={{ textAlign: "center", marginTop: 6 }}>Pay per second, earn from ads, and top up with Stripe.</div>

      <div className="login-card">
        <h3 style={{ marginTop: 0 }}>Create your account</h3>
        <div className="row" style={{ flexDirection: "column", gap: 8 }}>
          <input className="input" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <input className="input" placeholder="handle" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createAccount()} />
          <button className="btn" onClick={createAccount} disabled={busy || !name.trim() || !handle.trim()}>{busy ? "creating…" : "Create account"}</button>
        </div>
      </div>

      <div className="login-card">
        <h3 style={{ marginTop: 0 }}>Or use a demo account</h3>
        {["viewer", "creator", "advertiser"].map((r) => {
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
      <details className="login-card">
        <summary>Developer testnet login</summary>
        <div className="muted" style={{ fontSize: 12.5, margin: "10px 0" }}>Optional: connect a testnet key for legacy Tempo/MPP demos. Normal users do not need this.</div>
        <div className="row" style={{ flexDirection: "column", gap: 8 }}>
          <input className="input" type="password" placeholder="0x… testnet private key" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn btn-ghost" onClick={connect} disabled={busy || !key.trim()}>{busy ? "connecting…" : "Connect testnet account"}</button>
        </div>
      </details>
      <div className="login-foot">No payment keys are stored in the browser.</div>
    </div>
  );
}

// ───────────────────────── video card / grid ─────────────────────────
function VideoCard({ clip, owner, onOpen, onProfile }: { clip: Clip; owner?: PublicUser; onOpen: () => void; onProfile?: (id: string) => void }) {
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
        {owner
          ? <Avatar user={owner} size={32} onClick={onProfile ? () => onProfile(owner.id) : undefined} />
          : <div className="a">{clip.thumb ?? "🎬"}</div>}
        <div>
          <div className="vtitle">{clip.title}</div>
          <div className="vchan">
            {owner && onProfile
              ? <span className="chan-link" onClick={(e) => { e.stopPropagation(); onProfile(owner.id); }}>@{clip.creator}</span>
              : <>@{clip.creator}</>}
            {clip.recipients.length > 1 ? " · collab" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── watch view (payment panel) ─────────────────────────
const LOW_CAP = 0.012;
function WatchView({ clip, me, onBack, onError, onSettled, onProfile, balance, onTopup }: { clip: Clip; me: DemoUser; onBack: () => void; onError: (e: string) => void; onSettled: () => void; onProfile?: (id: string) => void; balance: number | null; onTopup: () => void }) {
  const [phase, setPhase] = useState<"idle" | "opening" | "watching" | "paused" | "closing">("idle");
  const [spent, setSpent] = useState(0);
  const [secs, setSecs] = useState(0);
  const [reason, setReason] = useState<"ended" | "out-of-funds" | null>(null);
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const [low, setLow] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsControls, setFsControls] = useState(true);
  const handle = useRef<WatchHandle | null>(null);
  const player = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const capping = useRef(false);
  const hideFsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deposit = low ? LOW_CAP : 0.5;
  const collab = clip.recipients.length > 1;

  useEffect(() => () => { handle.current?.stop().catch(() => {}); }, []);
  useEffect(() => {
    const onFullScreenChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeFullscreen(); };
    document.addEventListener("fullscreenchange", onFullScreenChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullScreenChange);
      document.removeEventListener("keydown", onKey);
      if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    };
  }, []);

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
  function togglePlayback() {
    if (phase === "opening" || phase === "closing") return;
    if (phase === "watching") { void closeOut("ended"); return; }
    void start();
  }
  function revealFsControls() {
    if (!fullscreen) return;
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function openFullscreen(e: MouseEvent) {
    e.stopPropagation();
    setFullscreen(true);
    setFsControls(true);
    await player.current?.requestFullscreen?.().catch(() => {});
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function closeFullscreen(e?: MouseEvent) {
    e?.stopPropagation();
    setFullscreen(false);
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }
  const live = phase === "watching";
  const pct = Math.min(100, (spent / deposit) * 100);

  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back</button><span className="muted">watching</span></div>
      <div className="watch">
        <div>
          <div
            ref={player}
            className={"player click-player" + (fullscreen ? " player-fullscreen" : "")}
            onClick={togglePlayback}
            onMouseMove={revealFsControls}
            title={live ? "click to stop" : "click to start"}
          >
            {clip.hasVideo
              ? <video ref={video} src={videoSrc(clip.id)} loop playsInline style={{ opacity: phase === "paused" ? 0.4 : 1 }} />
              : <span className="emoji" style={{ opacity: live ? 1 : 0.5 }}>{clip.thumb ?? "🎬"}</span>}
            <button className="fs-open" onClick={openFullscreen} title="fullscreen">⛶</button>
            {fullscreen && (
              <div className={"fs-layer" + (fsControls ? " show" : "")}>
                <button className="fs-back" onClick={closeFullscreen}>← Back</button>
                <div className="fs-cost">
                  <span>cost</span>
                  <b>− {usd(spent)}</b>
                  <small>{usd(Number(clip.pricePerSec))}/sec · {secs}s</small>
                </div>
              </div>
            )}
            {phase === "idle" && <div className="ov">{broke ? "⛔ You’re out of credit — add funds to watch this." : `▶ Click the video or press “Watch” — you pay ${usd(price)}/sec to the creator`}</div>}
            {phase === "opening" && <div className="ov">starting stream…</div>}
            {phase === "paused" && <div className="ov">{reason === "out-of-funds" ? "⛔ Out of credit — top up to keep watching." : "⏸ Paused — payment stopped. Click the video to start again."}</div>}
          </div>
          <div className="w-title">{clip.title}</div>
          <div className="w-chan">
            <div className="a">{clip.thumb ?? "🎬"}</div>
            <div><b className={onProfile ? "chan-link" : undefined} onClick={() => onProfile?.(clip.ownerId)}>@{clip.creator}</b><div className="muted" style={{ fontSize: 12.5 }}>{clip.tags.map((t) => "#" + t).join(" ")}</div></div>
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
          {summary && (() => {
            const paid = summary.spentUsd ?? spent;
            const refunded = Math.max(0, deposit - paid);
            return (
              <div className="receipt">
                <div className="receipt-head">✓ Charged from app balance</div>
                <div className="statline"><span className="k">paid to creator</span><span><b>{usd(paid)}</b>{summary.seconds != null ? ` · ${summary.seconds}s` : ""}</span></div>
                <div className="statline"><span className="k">deposit refunded</span><span style={{ color: "var(--in)" }}>{usd(refunded)}</span></div>
                {summary.txHash
                  ? <div className="tx" title="click to copy full tx hash" onClick={() => copy(summary.txHash!)}>tx {shortHash(summary.txHash)} <span className="copy">⧉ copy</span></div>
                  : <div className="tx">transaction recorded in your ledger</div>}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── ad watch (earn) ─────────────────────────
/** Watch a red-framed ad video and get PAID per second of proven attention.
 *  The money is pulled automatically from the advertiser's wallet (server-spawned
 *  payer); when the ad's funded budget runs out it simply stops paying. */
function AdWatch({ ad, me, onBack, onProfile }: { ad: Campaign; me: DemoUser; onBack: () => void; onProfile?: (id: string) => void }) {
  const [watching, setWatching] = useState(false); // user pressed "Watch ad" (explicit start)
  const [attention, setAttention] = useState(true); // manual "look away" toggle
  const [visible, setVisible] = useState(true); // tab foregrounded (Layer 1)
  const [onScreen, setOnScreen] = useState(true); // player in viewport (Layer 1)
  const [challenge, setChallenge] = useState<AttentionChallenge | null>(null); // active proof (Layer 2)
  const [earned, setEarned] = useState(0);
  const [paying, setPaying] = useState(false);
  const [started, setStarted] = useState(false); // payment channel open + actually paying
  const [events, setEvents] = useState<NetSnapshot["events"]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsControls, setFsControls] = useState(true);
  const baseline = useRef<number | null>(null);
  const prev = useRef(0);
  const video = useRef<HTMLVideoElement | null>(null);
  const player = useRef<HTMLDivElement | null>(null);
  const hideFsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef<string | undefined>(undefined); // per-session token (Layer 3)
  const startWatch = () => { baseline.current = null; prev.current = 0; setEarned(0); setStarted(false); setAttention(true); setWatching(true); };
  const toggleAdPlayback = () => {
    if (!watching) { startWatch(); return; }
    if (funded) setAttention((a) => !a);
  };
  function revealFsControls() {
    if (!fullscreen) return;
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function openFullscreen(e: MouseEvent) {
    e.stopPropagation();
    setFullscreen(true);
    setFsControls(true);
    await player.current?.requestFullscreen?.().catch(() => {});
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    hideFsTimer.current = setTimeout(() => setFsControls(false), 1800);
  }
  async function closeFullscreen(e?: MouseEvent) {
    e?.stopPropagation();
    setFullscreen(false);
    setFsControls(true);
    if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  }
  // Truly leaving (Stop / navigate away) closes the channel → advertiser refunded.
  useEffect(() => () => { stopAd(ad.id, me.id); }, [ad.id, me.id]);
  useEffect(() => {
    const onFullScreenChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeFullscreen(); };
    document.addEventListener("fullscreenchange", onFullScreenChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullScreenChange);
      document.removeEventListener("keydown", onKey);
      if (hideFsTimer.current) clearTimeout(hideFsTimer.current);
    };
  }, []);

  // Mirror live attention inputs into refs so the 1s heartbeat reads fresh values
  // without re-subscribing every toggle.
  const attRef = useRef(attention); attRef.current = attention;
  const visRef = useRef(visible); visRef.current = visible;
  const scrRef = useRef(onScreen); scrRef.current = onScreen;

  // Layer 1a: tab visibility.
  useEffect(() => {
    const f = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", f); f();
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  // Layer 1b: is the player actually on-screen?
  useEffect(() => {
    const el = player.current; if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e && e.isIntersecting && e.intersectionRatio > 0.4), { threshold: [0, 0.4, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Open a session, then heartbeat every second with REAL signals (Layer 1) +
  // the session token (Layer 3). The server's reply may carry a challenge (L2).
  useEffect(() => {
    if (!watching) return; // nothing runs until the viewer presses Watch
    let alive = true;
    openAttentionSession(ad.id, me.id).then((t) => { if (alive) token.current = t; });
    const beat = async () => {
      const v = video.current;
      const playing = !!v && !v.paused && !v.ended && v.readyState >= 2;
      // Manual "look away" collapses into the visibility signal.
      const res = await sendHeartbeat(ad.id, me.id, token.current, { visible: visRef.current && attRef.current, playing, onScreen: scrRef.current });
      if (alive) setChallenge(res?.challenge ?? null);
    };
    const beatId = setInterval(beat, 1000);
    const pumpId = setInterval(() => { if (attRef.current && visRef.current && scrRef.current) runAd(ad.id, me.id); }, 4000);
    beat(); runAd(ad.id, me.id);
    return () => { alive = false; clearInterval(beatId); clearInterval(pumpId); };
  }, [ad.id, me.id, watching]);

  // Layer 2: prove you're watching by tapping the target → payment resumes.
  const proveAttention = (id: string) => {
    setChallenge(null); // optimistic; the next heartbeat confirms
    void answerChallenge(ad.id, me.id, token.current, id);
  };

  // Poll my on-chain earnings → delta since this ad opened. The first non-zero
  // earning means the advertiser's payment channel is open AND paying.
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(async () => {
      try {
        const n = await fetchNet(me.id);
        if (baseline.current == null) baseline.current = n.inUsd;
        const e = +(n.inUsd - (baseline.current ?? 0)).toFixed(6);
        setPaying(e > prev.current); prev.current = e; setEarned(e);
        if (e > 0) setStarted(true);
        setEvents(n.events.filter((ev) => ev.direction === "in").slice(0, 6));
      } catch { /* keep last */ }
    }, 1500);
    return () => clearInterval(id);
  }, [me.id, watching]);

  const price = Number(ad.pricePerSec);
  const budget = Number(ad.maxBudget);
  const spent = ad.spentUsd ?? 0;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const funded = ad.funded ?? budget - spent >= price;
  // Channel open, funded, AND provably attentive (manual + tab visible + on-screen).
  const live = watching && attention && started && funded && visible && onScreen;

  // Play the ad ONLY while it's actually being paid for. Try with sound; if the
  // browser blocks unmuted autoplay, fall back to muted so it still plays.
  useEffect(() => {
    const v = video.current; if (!v) return;
    if (live) { v.muted = false; v.play().catch(() => { v.muted = true; v.play().catch(() => {}); }); }
    else v.pause();
  }, [live]);

  // Never get stuck on "opening" — if the ad is funded and you're watching but no
  // payment has registered after a grace period (slow channel / self-watch), start
  // anyway so the ad isn't blocked forever.
  useEffect(() => {
    if (!watching || !funded || !attention || started) return;
    const t = setTimeout(() => setStarted(true), 15000); // backstop only — opening an on-chain channel can take ~8-15s on the public RPC
    return () => clearTimeout(t);
  }, [watching, funded, attention, started]);

  return (
    <div className="page">
      <div className="backbar"><button className="btn-ghost btn btn-sm" onClick={onBack}>← Back to ads</button><span className="muted">earning from an ad</span></div>
      <div className="watch">
        <div>
          <div
            className={"player ad click-player" + (fullscreen ? " player-fullscreen" : "")}
            ref={player}
            onClick={toggleAdPlayback}
            onMouseMove={revealFsControls}
            title={!watching ? "click to start" : attention ? "click to pause" : "click to resume"}
          >
            {ad.hasVideo
              ? <video ref={video} src={videoSrc(ad.id)} loop playsInline style={{ opacity: live ? 1 : 0.35 }} />
              : <span className="emoji" style={{ opacity: live ? 1 : 0.35 }}>{ad.thumb ?? "📣"}</span>}
            <span className="adtag">● AD</span>
            <button className="fs-open" onClick={openFullscreen} title="fullscreen">⛶</button>
            {fullscreen && (
              <div className={"fs-layer" + (fsControls ? " show" : "")}>
                <button className="fs-back" onClick={closeFullscreen}>← Back</button>
                <div className="fs-cost fs-earn">
                  <span>earned</span>
                  <b>+ {usd(earned)}</b>
                  <small>{usd(price)}/sec · {paying ? "paying" : watching ? "ready" : "paused"}</small>
                </div>
              </div>
            )}
            {!watching
              ? <div className="ov ov-watch"><button className="btn btn-lg" onClick={(e) => { e.stopPropagation(); startWatch(); }}>▶ Watch ad</button><div className="muted" style={{ marginTop: 10 }}>or click the video · get paid {usd(price)}/sec</div></div>
              : !funded
              ? <div className="ov">⛔ This ad is out of funding — it can’t pay, so it won’t play.</div>
              : !attention
              ? <div className="ov">🙈 paused. Click the video to resume instantly.</div>
              : !visible
              ? <div className="ov">🛑 tab in the background — attention can’t be proven, paused</div>
              : !onScreen
              ? <div className="ov">⬆️ scroll the ad back into view to keep earning</div>
              : !started
              ? <div className="ov">⏳ preparing reward stream…</div>
              : null}
            {/* Layer 2: random attention challenge — tap it within a few seconds. */}
            {challenge && funded && started && (
              <button
                className="att-challenge"
                style={{ left: challenge.x + "%", top: challenge.y + "%" }}
                onClick={(e) => { e.stopPropagation(); proveAttention(challenge.id); }}
              >👀 still watching? tap to keep earning</button>
            )}
          </div>
          <div className="w-title">{ad.title ?? ad.advertiser}</div>
          <div className="w-chan">
            <div className="a">{ad.thumb ?? "📣"}</div>
            <div><b className={onProfile ? "chan-link" : undefined} onClick={() => onProfile?.(ad.ownerId)}>{ad.advertiser}</b><div className="muted" style={{ fontSize: 12.5 }}>sponsored · pays you to watch · {ad.tags.map((t) => "#" + t).join(" ")}</div></div>
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
          <div className="receipt" style={{ background: "#0f141f", borderColor: "#22304a" }}>Paid per second from <b>{ad.advertiser}</b> while attention is verified. Looking away pauses rewards immediately.</div>
          {events.length > 0 && (
            <div className="feed-events">
              <div className="role-chip">your live receipts</div>
              {events.map((e) => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--in)" }}>▲ from {e.counterparty}</span>
                  <span className="muted">{usd(Number(e.amount))}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            {!watching
              ? <button className="btn" style={{ flex: 1 }} onClick={startWatch}>▶ Watch ad · earn {usd(price)}/sec</button>
              : <>
                  <button className={attention ? "btn btn-ghost" : "btn"} style={{ flex: 1 }} onClick={() => setAttention((a) => !a)}>{attention ? "Look away 🙈" : "Look back 👀"}</button>
                  <button className="btn btn-ghost" onClick={onBack}>Stop</button>
                </>}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>{!watching ? "press ▶ Watch ad to start earning" : !funded ? "⛔ unfunded — ask the advertiser to fund it" : !attention ? "paused — look back to keep earning" : !visible ? "background tab — paused, come back to keep earning" : !onScreen ? "ad scrolled off-screen — paused" : challenge ? "tap the prompt to prove you’re watching" : !started ? "preparing reward stream" : paying ? "attention proven — being paid" : "attention proven"}</div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── avatar (pic or symbol) ─────────────────────────
function Avatar({ user, size = 40, ring, onClick }: { user: { id: string; avatar: string; pic?: string }; size?: number; ring?: boolean; onClick?: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={"av" + (onClick ? " av-link" : "") + (ring ? " av-ring" : "")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      title={onClick ? "view profile" : undefined}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined}
    >
      {user.pic && !broken
        ? <img src={picSrc(user.id)} alt="" onError={() => setBroken(true)} />
        : <span>{user.avatar}</span>}
    </div>
  );
}

const EMOJI_PRESETS = ["🌌","🎹","🍜","🎮","🐧","🦊","🎬","🎨","🚀","🔥","💎","🌊","🎧","📸","⚡","🐉","🌸","🛹","🤖","👾","🎤","🏆","🪐","🍿"];

/** Deterministic banner gradient from a user id (so each profile has its own). */
function bannerFor(id: string): string {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 48) % 360;
  return `linear-gradient(120deg, hsl(${a} 58% 20%), hsl(${b} 60% 32%))`;
}

// ───────────────────────── edit profile modal ─────────────────────────
function EditProfile({ me, onClose, onSaved, onError }: { me: DemoUser; onClose: () => void; onSaved: (u: DemoUser) => void; onError: (e: string) => void }) {
  const [name, setName] = useState(me.name);
  const [handle, setHandle] = useState(me.handle);
  const [bio, setBio] = useState(me.bio ?? "");
  const [avatar, setAvatar] = useState(me.avatar);
  const [price, setPrice] = useState(me.followPrice ?? "0.05");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickFile(f: File | null) { setFile(f); setPreview(f ? URL.createObjectURL(f) : null); }
  async function save() {
    setBusy(true);
    try {
      let u = await updateProfile(me.id, { name: name.trim() || me.name, handle: handle.trim() || me.handle, bio, avatar, followPrice: price });
      if (file) u = await uploadProfilePic(me.id, file);
      onSaved({ ...me, ...u });
      onClose();
    } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Edit profile</h3><button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button></div>
        <div className="edit-pic">
          <div className="av av-ring" style={{ width: 76, height: 76, fontSize: 38 }}>
            {(preview || me.pic) ? <img src={preview ?? picSrc(me.id)} alt="" /> : <span>{avatar}</span>}
          </div>
          <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
            📷 Upload photo<input type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>
          {(preview || me.pic) && <button className="btn btn-ghost btn-sm" onClick={() => pickFile(null)}>use symbol instead</button>}
        </div>
        {!preview && (
          <div className="emoji-picker">
            {EMOJI_PRESETS.map((em) => (
              <button key={em} className={"emoji-opt" + (avatar === em ? " sel" : "")} onClick={() => setAvatar(em)}>{em}</button>
            ))}
          </div>
        )}
        <label className="fld">Display name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="fld">Handle<input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} /></label>
        <label className="fld">Bio<textarea className="input" rows={3} maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people what you create…" /></label>
        <label className="fld">Super-follow price — what supporters pay to follow you<input className="input" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>{busy ? "saving…" : "Save profile"}</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── profile page ─────────────────────────
function ProfileView({ id, me, onBack, onOpenProfile, onWatch, onError, onMeUpdate, onBalance, onLogout }: {
  id: string; me: DemoUser; onBack: () => void; onOpenProfile: (id: string) => void; onWatch: (c: Clip) => void;
  onError: (e: string) => void; onMeUpdate: (u: DemoUser) => void; onBalance: () => void; onLogout: () => void;
}) {
  const [p, setP] = useState<ProfileData | null>(null);
  const [tab, setTab] = useState<"videos" | "supporters" | "following">("videos");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() { try { setP(await fetchProfile(id, me.id)); } catch (e: any) { onError(e?.message ?? String(e)); } }
  useEffect(() => { setP(null); setTab("videos"); setToast(null); load(); /* eslint-disable-next-line */ }, [id]);

  const isMe = id === me.id;
  async function follow() {
    if (!p) return; setBusy(true); setToast(null);
    try {
      const r = await followCreator(me, { id: p.user.id, address: p.user.address, followPrice: p.user.followPrice });
      setToast(Number(r.amountUsd) > 0 ? `★ You're now supporting ${p.user.name} — paid ${usd(Number(r.amountUsd))}` : `Now following ${p.user.name}`);
      await load(); onBalance();
    } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }
  async function unfollow() {
    if (!p) return; setBusy(true);
    try { await unfollowCreator(me.id, p.user.id); setToast(null); await load(); } catch (e: any) { onError(e?.message ?? String(e)); }
    setBusy(false);
  }

  if (!p) return (
    <div className="page"><div className="backbar"><button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button></div><div className="muted">loading profile…</div></div>
  );
  const u = p.user;
  const price = Number(u.followPrice ?? "0");
  const list = tab === "supporters" ? p.supporters : tab === "following" ? p.following : [];

  return (
    <div className="page profile-page">
      <div className="backbar"><button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button><span className="muted">profile</span></div>
      <div className="pbanner" style={{ background: bannerFor(u.id) }} />
      <div className="phead">
        <Avatar user={u} size={104} ring />
        <div className="phead-main">
          <div className="pname">{u.name}<span className="role-chip2">{u.role}</span></div>
          <div className="muted phandle">@{u.handle} · <span className="tx" title="copy address" onClick={() => copy(u.address)}>{u.address.slice(0, 8)}…{u.address.slice(-4)}</span></div>
          {u.bio && <div className="pbio">{u.bio}</div>}
          <div className="pstats">
            <button className={"pstat" + (tab === "supporters" ? " on" : "")} onClick={() => setTab("supporters")}><b>{compact.format(p.followerCount)}</b> supporters</button>
            <button className={"pstat" + (tab === "following" ? " on" : "")} onClick={() => setTab("following")}><b>{compact.format(p.followingCount)}</b> following</button>
            <span className="pstat"><b style={{ color: "var(--in)" }}>{usd(p.followEarnings)}</b> from fans</span>
            <span className="pill" title="app balance">{fmtBal(p.balance)} <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>credit</span></span>
          </div>
        </div>
        <div className="phead-cta">
          {isMe ? (<>
            <button className="btn" onClick={() => setEditing(true)}>✎ Edit profile</button>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>Log out</button>
          </>) : p.viewerFollows ? (
            <button className="btn btn-ghost supporting" onClick={unfollow} disabled={busy} title="click to unfollow">{busy ? "…" : "✓ Supporting"}</button>
          ) : (
            <button className="btn btn-follow" onClick={follow} disabled={busy}>{busy ? "paying…" : price > 0 ? `★ Super-follow · ${usd(price)}` : "＋ Follow"}</button>
          )}
        </div>
      </div>

      {toast && <div className="receipt" style={{ marginTop: 14 }}>{toast}</div>}

      <div className="ptabs">
        {(["videos", "supporters", "following"] as const).map((t) => (
          <button key={t} className={"ptab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
            {t === "videos" ? `Videos (${p.clips.length})` : t === "supporters" ? `Supporters (${p.followerCount})` : `Following (${p.followingCount})`}
          </button>
        ))}
      </div>

      {tab === "videos" ? (
        p.clips.length
          ? <div className="grid">{p.clips.map((c) => <VideoCard key={c.id} clip={c} onOpen={() => onWatch(c)} />)}</div>
          : <div className="muted">{isMe ? "You haven't posted any videos yet." : "No videos yet."}</div>
      ) : (
        list.length
          ? <div className="people">{list.map((s) => (
              <div key={s.id} className="person" onClick={() => onOpenProfile(s.id)}>
                <Avatar user={s} size={44} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="pname2">{s.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>@{s.handle}</div>
                </div>
                {Number(s.amountUsd) > 0 && <span className="supporter-badge">★ {usd(Number(s.amountUsd))}</span>}
              </div>
            ))}</div>
          : <div className="muted">{tab === "supporters" ? "No supporters yet — be the first to super-follow." : "Not following anyone yet."}</div>
      )}

      {editing && <EditProfile me={me} onClose={() => setEditing(false)} onSaved={(uu) => { onMeUpdate(uu); load(); }} onError={onError} />}
    </div>
  );
}

// ───────────────────────── app ─────────────────────────
// ───────────────────────── account menu (profile + logout) ─────────────────────────
function AccountMenu({ me, balance, onProfile, onTopup, onLogout }: { me: DemoUser; balance: number | null; onProfile: () => void; onTopup: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="acct">
      <Avatar user={me} size={34} onClick={() => setOpen((o) => !o)} />
      {open && (
        <>
          <div className="acct-backdrop" onClick={() => setOpen(false)} />
          <div className="acct-menu">
            <div className="acct-head">
              <Avatar user={me} size={42} />
              <div style={{ minWidth: 0 }}>
                <div className="acct-name">{me.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>@{me.handle}</div>
              </div>
            </div>
            <div className="acct-row"><span className="k">balance</span><span><b>{balance != null ? fmtBal(balance) : "…"}</b></span></div>
            <div className="acct-sep" />
            <button className="acct-item" onClick={() => { setOpen(false); onProfile(); }}>👤 View profile</button>
            <button className="acct-item" onClick={() => { setOpen(false); onTopup(); }}>＋ Add credit</button>
            <button className="acct-item danger" onClick={() => { setOpen(false); onLogout(); }}>⎋ Log out</button>
          </div>
        </>
      )}
    </div>
  );
}

function GlobalSearch({
  query,
  users,
  clips,
  userById,
  onQuery,
  onOpenProfile,
  onOpenClip,
}: {
  query: string;
  users: DemoUser[];
  clips: Clip[];
  userById: (uid: string) => DemoUser | undefined;
  onQuery: (q: string) => void;
  onOpenProfile: (id: string) => void;
  onOpenClip: (clip: Clip) => void;
}) {
  const q = query.trim().toLowerCase();
  const profiles = q
    ? users
        .filter((u) => [u.name, u.handle, u.role, u.bio ?? ""].join(" ").toLowerCase().includes(q))
        .slice(0, 5)
    : [];
  const videos = q
    ? clips
        .filter((c) => [c.title, c.creator, ...c.tags].join(" ").toLowerCase().includes(q))
        .slice(0, 6)
    : [];
  const hasResults = profiles.length > 0 || videos.length > 0;
  const openProfile = (id: string) => { onQuery(""); onOpenProfile(id); };
  const openClip = (clip: Clip) => { onQuery(""); onOpenClip(clip); };

  return (
    <div className="global-search">
      <input
        className="search-input"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search profiles or videos"
        aria-label="Search profiles or videos"
      />
      {q && (
        <div className="search-panel">
          {hasResults ? (
            <>
              {profiles.length > 0 && (
                <div className="search-section">
                  <div className="search-label">Profiles</div>
                  {profiles.map((u) => (
                    <button key={u.id} className="search-row" onClick={() => openProfile(u.id)}>
                      <Avatar user={u} size={34} />
                      <span className="search-copy">
                        <b>{u.name}</b>
                        <small>@{u.handle} · {u.role}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {videos.length > 0 && (
                <div className="search-section">
                  <div className="search-label">Videos</div>
                  {videos.map((clip) => {
                    const owner = userById(clip.ownerId);
                    return (
                      <button key={clip.id} className="search-row" onClick={() => openClip(clip)}>
                        <span className="search-thumb">
                          {clip.hasVideo ? <video src={videoSrc(clip.id) + "#t=0.1"} muted playsInline /> : <span>{clip.thumb ?? "🎬"}</span>}
                        </span>
                        <span className="search-copy">
                          <b>{clip.title}</b>
                          <small>@{owner?.handle ?? clip.creator} · {usd(Number(clip.pricePerSec))}/sec</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="search-empty">No profiles or videos found.</div>
          )}
        </div>
      )}
    </div>
  );
}

function TopupModal({ me, onClose, onError }: { me: DemoUser; onClose: () => void; onError: (e: string) => void }) {
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  async function checkout() {
    setBusy(true);
    try {
      const session = await createTopupCheckoutSession(me.id, amount);
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      window.location.href = session.url;
    } catch (e: any) {
      onError(e?.message ?? String(e));
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Add credit · card → pathUSD</h3><button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button></div>
        <div className="muted" style={{ marginBottom: 12 }}>Pay with a card via Stripe — we instantly settle the same amount as real ◎ pathUSD on Tempo, ready to spend per-second on creators. Balance updates once Stripe confirms.</div>
        <div className="topup-grid">
          {[5, 10, 25].map((v) => (
            <button key={v} className={"topup-choice" + (amount === v ? " on" : "")} onClick={() => setAmount(v)}>${v}</button>
          ))}
        </div>
        <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={checkout} disabled={busy}>{busy ? "opening Stripe…" : `Continue to Stripe · $${amount}`}</button>
        <div className="muted" style={{ marginTop: 10, fontSize: 11.5, textAlign: "center" }}>🌉 Stripe (fiat rails) → pathUSD on Tempo · testnet</div>
      </div>
    </div>
  );
}

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
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [search, setSearch] = useState("");
  // ad (earn)
  const [adCampaign, setAdCampaign] = useState<string | null>(null);
  // studio (creator upload)
  const [title, setTitle] = useState(""); const [tags, setTags] = useState(""); const [file, setFile] = useState<File | null>(null); const [uploading, setUploading] = useState(false);
  const [price, setPrice] = useState("0.002"); // creator-set price ($/sec) for new uploads
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({}); const [savingPrice, setSavingPrice] = useState<string | null>(null);
  // ad studio (advertiser upload)
  const [adTitle, setAdTitle] = useState(""); const [adTags, setAdTags] = useState(""); const [adFile, setAdFile] = useState<File | null>(null); const [adBudget, setAdBudget] = useState("0.20"); const [publishingAd, setPublishingAd] = useState(false); const [fundingAd, setFundingAd] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers().then(setUsers).catch((e) => setError(e.message));
    refreshFeed();
    fetchCampaigns().then(setCampaigns).catch(() => {});
    try { const saved = localStorage.getItem("tempoflow-me"); if (saved) setMe(JSON.parse(saved)); } catch {}
    const payment = new URLSearchParams(window.location.search).get("payment");
    if (payment === "success") setPaymentNotice("Payment received. Your balance will refresh after Stripe confirms it.");
    if (payment === "cancel") setPaymentNotice("Payment canceled. No credit was added.");
  }, []);
  function refreshFeed() { fetchFeed().then(setFeed).catch((e) => setError(e.message)); }

  useEffect(() => {
    if (!me) return;
    setView("home");
    const tick = () => {
      fetchNet(me.id).then(setNet).catch(() => {});
      fetchBalance(me.id).then(setBalance).catch(() => {});
      fetchCampaigns().then(setCampaigns).catch(() => {}); // live funding status
    };
    tick(); const id = setInterval(tick, 3000); return () => clearInterval(id);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("payment") !== "success" || !sessionId) return;
    syncCheckoutSession(me.id, sessionId)
      .then(async () => {
        setPaymentNotice("✓ Payment confirmed — settled as ◎ pathUSD on Tempo and added to your balance.");
        setBalance(await fetchBalance(me.id));
      })
      .catch(() => setPaymentNotice("Payment received. Waiting for Stripe confirmation."));
  }, [me]);

  function login(u: DemoUser) { localStorage.setItem("tempoflow-me", JSON.stringify(u)); setMe(u); setError(null); }
  function logout() { localStorage.removeItem("tempoflow-me"); setMe(null); setAdCampaign(null); setProfileId(null); setView("home"); }
  function openProfile(id: string) { setProfileId(id); setCurrent(null); setAdCampaign(null); setError(null); setView("profile"); }
  function onMeUpdate(u: Partial<DemoUser>) { setMe((m) => { if (!m) return m; const merged = { ...m, ...u }; localStorage.setItem("tempoflow-me", JSON.stringify(merged)); return merged; }); }
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
  async function submitUpload() {
    if (!me || !file || !title.trim()) return; setUploading(true);
    try { await uploadClip(me.id, title.trim(), tags.split(",").map((t) => t.trim()).filter(Boolean), file, 60, price); setTitle(""); setTags(""); setFile(null); refreshFeed(); }
    catch (e: any) { setError(e?.message ?? String(e)); } setUploading(false);
  }
  async function savePrice(id: string) {
    if (!me) return; const v = priceEdits[id]; if (v == null) return; setSavingPrice(id);
    try { const updated = await setClipPrice(id, me.id, v); setFeed((fd) => fd.map((c) => (c.id === id ? updated : c))); setPriceEdits((p) => { const nx = { ...p }; delete nx[id]; return nx; }); }
    catch (e: any) { setError(e?.message ?? String(e)); } setSavingPrice(null);
  }

  if (!me) return users.length ? <><Login users={users} onLogin={login} onError={setError} />{error && <div className="login"><div className="toast-err">{error}<button className="btn-ghost btn btn-sm" onClick={() => setError(null)}>×</button></div></div>}</> : <div className="login"><div className="muted" style={{ padding: 40, textAlign: "center" }}>{error ?? "loading TempoFlow…"}</div></div>;

  const myClips = feed.filter((c) => c.ownerId === me.id);
  const myAds = campaigns.filter((c) => c.ownerId === me.id);
  const activeAd = adCampaign ? campaigns.find((c) => c.id === adCampaign) ?? null : null;
  // Every logged-in wallet is full-access: watch, create + upload, advertise, earn.
  const nav: [string, string][] = [
    ["home", "Home"],
    ["studio", "Studio"],
    ["earn", "Earn"],
    ["campaigns", "Ads"],
  ];
  const go = (v: string) => { setView(v); setCurrent(null); setSearch(""); };
  const userById = (uid: string) => users.find((u) => u.id === uid);

  return (
    <>
      <div className="nav">
        <div className="brand"><span className="dot" />Tempo<b>Flow</b></div>
        <div className="nav-links">{nav.map(([v, l]) => <button key={v} className={"nav-link" + (view === v ? " active" : "")} onClick={() => go(v)}>{l}</button>)}</div>
        <GlobalSearch
          query={search}
          users={users}
          clips={feed}
          userById={userById}
          onQuery={setSearch}
          onOpenProfile={openProfile}
          onOpenClip={(clip) => { setCurrent(clip); setAdCampaign(null); setProfileId(null); setView("watch"); }}
        />
        <div className="nav-right">
          <span className="pill" title="your app balance">{balance != null ? fmtBal(balance) : "$…"} <span className="muted" style={{ fontWeight: 600, fontSize: 11 }}>credit</span></span>
          <span className="pill" title="net this session">net <b style={{ color: (net?.netUsd ?? 0) >= 0 ? "var(--in)" : "var(--out)" }}>{(net?.netUsd ?? 0) >= 0 ? "+" : "−"}{usd(Math.abs(net?.netUsd ?? 0))}</b></span>
          <button className="btn btn-sm" onClick={() => setTopupOpen(true)}>＋ Add credit</button>
          <AccountMenu me={me} balance={balance} onProfile={() => openProfile(me.id)} onTopup={() => setTopupOpen(true)} onLogout={logout} />
        </div>
      </div>

      {error && <div className="page" style={{ paddingBottom: 0 }}><div className="toast-err">⚠ {error}<button className="btn-ghost btn btn-sm" onClick={() => setError(null)}>×</button></div></div>}
      {paymentNotice && <div className="page" style={{ paddingBottom: 0 }}><div className="receipt">{paymentNotice}<button className="btn-ghost btn btn-sm" onClick={() => setPaymentNotice(null)}>×</button></div></div>}
      {topupOpen && <TopupModal me={me} onClose={() => setTopupOpen(false)} onError={setError} />}

      {view === "profile" && profileId
        ? <ProfileView key={profileId} id={profileId} me={me} onBack={() => go("home")} onOpenProfile={openProfile} onWatch={(c) => { setCurrent(c); setView("watch"); }} onError={setError} onMeUpdate={onMeUpdate} onBalance={() => fetchBalance(me.id).then(setBalance).catch(() => {})} onLogout={logout} />
        : view === "watch" && current
        ? <WatchView key={current.id} clip={current} me={me} balance={balance} onTopup={() => setTopupOpen(true)} onBack={() => go("home")} onProfile={openProfile} onError={setError} onSettled={() => { fetchNet(me.id).then(setNet).catch(() => {}); fetchBalance(me.id).then(setBalance).catch(() => {}); }} />
        : view === "earn" && activeAd
        ? <AdWatch key={activeAd.id} ad={activeAd} me={me} onBack={() => setAdCampaign(null)} onProfile={openProfile} />
        : (
          <div className="page">
            {view === "home" && (<>
              <div className="section-title">Browse — pay only while you watch</div>
              {feed.length ? <div className="grid">{feed.map((c) => <VideoCard key={c.id} clip={c} owner={userById(c.ownerId)} onProfile={openProfile} onOpen={() => { setCurrent(c); setView("watch"); }} />)}</div> : <div className="muted">loading feed…</div>}
            </>)}

            {view === "studio" && (<>
              <div className="section-title">Creator Studio</div>
              <div className="login-card" style={{ marginTop: 0, marginBottom: 18 }}>
                <h3 style={{ marginTop: 0 }}>Upload a video</h3>
                <div className="row" style={{ flexDirection: "column", gap: 9 }}>
                  <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <input className="input" placeholder="tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
                  <input className="input" type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span className="muted" style={{ fontSize: 13 }}>Your price</span>
                    <span className="muted">$</span>
                    <input className="input" type="number" step="0.001" min="0" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 110 }} title="price per second" />
                    <span className="muted" style={{ fontSize: 13 }}>/ second</span>
                  </div>
                  <button className="btn" onClick={submitUpload} disabled={!file || !title.trim() || uploading}>{uploading ? "uploading…" : "⬆ Publish"}</button>
                  <div className="muted" style={{ fontSize: 12 }}>You set the price — viewers pay <b>{usd(Number(price) || 0)}/sec</b> from their app balance while they watch. You can change it anytime below.</div>
                </div>
              </div>
              <div className="section-title">Your channel ({myClips.length}) · <span className="chan-link" onClick={() => openProfile(me.id)}>view your profile →</span></div>
              {myClips.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {myClips.map((c) => {
                    const edited = priceEdits[c.id] ?? c.pricePerSec;
                    return (
                      <div key={c.id} className="adrow" style={{ borderLeftColor: "var(--accent)" }}>
                        <div className="adrow-thumb" style={{ cursor: "pointer" }} onClick={() => { setCurrent(c); setView("watch"); }}>
                          {c.hasVideo ? <video src={videoSrc(c.id) + "#t=0.1"} muted playsInline /> : <span style={{ fontSize: 30 }}>{c.thumb ?? "🎬"}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700 }}>{c.title}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{c.tags.join(", ") || "untagged"} · {c.durationSec}s</div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>viewers pay <b style={{ color: "var(--out)" }}>{usd(Number(c.pricePerSec))}/sec</b> · ≈ {usd(Number(c.pricePerSec) * c.durationSec)} for the full clip</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <span className="muted" style={{ fontSize: 12 }}>$</span>
                          <input className="input" type="number" step="0.001" min="0" style={{ width: 88 }} value={edited} onChange={(e) => setPriceEdits((p) => ({ ...p, [c.id]: e.target.value }))} />
                          <span className="muted" style={{ fontSize: 12 }}>/sec</span>
                          <button className="btn btn-sm" onClick={() => savePrice(c.id)} disabled={savingPrice === c.id || edited === c.pricePerSec || !(Number(edited) > 0)}>{savingPrice === c.id ? "…" : "Save price"}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <div className="muted">No clips yet — upload one above.</div>}
            </>)}

            {view === "earn" && (<>
              <div className="section-title">Earn — watch ads, get paid for your attention</div>
              <div className="muted" style={{ margin: "-8px 2px 14px", fontSize: 13 }}>Each ad pays per second while attention is verified. Ads with no funding can’t pay.</div>
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
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Your ad pays viewers per second of proven attention from your funded campaign budget. When the budget runs out, the ad stops paying.</div>
                <div className="row" style={{ flexDirection: "column", gap: 9 }}>
                  <input className="input" placeholder="Ad title" value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
                  <input className="input" placeholder="tags (comma separated)" value={adTags} onChange={(e) => setAdTags(e.target.value)} />
                  <input className="input" type="file" accept="video/*" onChange={(e) => setAdFile(e.target.files?.[0] ?? null)} />
                  <div className="row">
                    <input className="input" type="number" step="0.05" min="0" placeholder="budget $" value={adBudget} onChange={(e) => setAdBudget(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn" onClick={submitAd} disabled={!adTitle.trim() || publishingAd}>{publishingAd ? "publishing…" : "⬆ Publish ad"}</button>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>Budget is your committed spend cap. Add app credit from the top bar when you need more.</div>
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
                        <div className="statline"><span className="k">available app credit</span><span>{c.advertiserBalance != null ? fmtBal(c.advertiserBalance) : "…"}</span></div>
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
              <div className="receipt" style={{ marginTop: 12 }}>paid to viewers this session: <b>{usd(net?.outUsd ?? 0)}</b></div>
            </>)}

            {/* live receipts */}
            {net && net.events.length > 0 && (
              <div className="feed-events" style={{ marginTop: 20 }}>
                <div className="role-chip">your live receipts</div>
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
