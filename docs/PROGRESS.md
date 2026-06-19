# FLOW — Fortschritt (letzter Tag)

Ehrliche Bestandsaufnahme der Geldflüsse + was fertig/offen ist. Quelle der Wahrheit
für MPP-Signaturen: `docs/MPP_NOTES.md` (gegen https://mpp.dev/llms-full.txt geprüft).

## Geldflüsse — was ist echt on-chain?

| Fluss | Pfad | Status |
|---|---|---|
| **Viewer → Creator** (Watchtime) | `GET /watch/:id` · `mppx.session` + `stream.charge()` pro Sekunde; Settlement + Refund beim `manager.close()` | **echt on-chain** (verifiziert) |
| **Advertiser → Viewer** (Attention) | `GET /attention/:campaignId/:viewerId`; der **autonome Advertiser-Agent** (`agent/src/advertiser.ts`, `--escrow`) zahlt aus dem Operator-Escrow pro verifizierter Sekunde | **echt on-chain** (verifiziert: Auszahlung + Escrow-Refund) |
| **Advertiser-Escrow + Refund** | `POST /campaigns/:id/fund` (On-Chain-Deposit → Operator-Vault), `POST /campaigns/:id/stop` (Rest-Refund on-chain) | **echt on-chain** (verifiziert: Deposit/Payout/Refund) |
| **Stripe-Topup** | Checkout → Webhook/Sync → `transferPathUsd` ins Wallet | echt (Fiat-Onramp) |
| **Tips / AI-Token / Pledges** | App-Ledger (`app-ledger.ts`, SQLite) | App-Ledger (nicht jeder Posten on-chain settled — siehe `MPP_NOTES.md`) |

`/api/watch/:id` ist ein **Legacy-App-Ledger-Pfad** und NICHT der Demo-Pfad. Der echte
On-Chain-Pfad ist `/watch/:id` (Direction A).

## Fertig (in Priorität laut Briefing)

- ✅ **Build/Deploy repariert**: ein committeter Merge-Konflikt in `web/src/main.tsx`
  brach den Vercel-Build → aufgelöst. Watch-Bug (`invalid private key`) gefixt:
  `ensureKey()` lädt den Signing-Key für App-Konten beim Login/Restore nach.
- ✅ **Accounts**: jeder kann ein Konto erstellen und sich **später per Private Key
  wieder einloggen** (`POST /users` idempotent per Wallet-Adresse → selbes Konto, kein
  Duplikat). Key wird beim Erstellen einmalig zum Speichern angezeigt + jederzeit unter
  **Settings → Export key** abrufbar.
- ✅ **Social-Layer**: View-Counts, Likes, Kommentare (pro Clip), **Live-Chat** in
  Streams. SQLite-backed (`clip_likes`/`clip_comments`/`chat_messages` + `clips.views`).
- ✅ **§2 Live-Saldo-Screen** (`FlowSession`, Nav „⚡ Live Saldo"): ein Screen, links
  Geld raus an Creator, rechts Geld rein vom Ad, Mitte großer **Netto-Saldo um Null**,
  Sub-Cent-Granularität, Settlement-Moment mit Refund + Tx-Link.
- ✅ **§5 agentische Schicht** (Overlay, kein eigener Screen): die IN-Seite wird vom
  autonomen Advertiser-Agent getrieben; Overlay „N agents bidding · clearing €X/s".
- ✅ **§A Dynamic Attention Pricing**: der IN-Preis ist der **Clearing-Preis** einer
  Sekunden-Auktion (`runAuction`, Second-Price) über konkurrierende Advertiser-Bids +
  simulierte Konkurrenz (`// MOCK:`). **Guardrail A2** by design: Preis hängt nur an
  der Nachfrageseite (Bids + Zeit), **nie** am Attention-Signal (binäres Gate).
- ✅ **§3 Transparenz** (`TransparencyView`, Nav „Ledger"): gläserner Ledger über die
  echten On-Chain-Flows mit sichtbarer Plattform-Marge + Explorer-Link.
- ✅ **§4 Verified Attention**: 3-Layer-Proof (visible/on-screen, Tap-Challenge,
  Session-Token). In UI/Doku ehrlich als „attention check" gelabelt, **nicht** als
  bot-proof.
- ✅ Creator-Dashboard (edit/delete), Live-Lifecycle (nur live solange Creator da),
  Wallet-Dashboard (Adresse sichtbar, Explorer-/App-Links, Key-Export).

## Offen / bewusst nicht gemacht (Scope-Disziplin)

- Plattform-Marge ist **transparent deklariert** über echten Flows (konfigurierbar via
  `PLATFORM_FEE`), aber NICHT als separate On-Chain-Marge auf dem Watch-Channel
  geroutet (mppx 0.7.0 `session` hat kein `splits`; Rerouting am letzten Tag = Risiko
  für den verifizierten Watch-Flow). Mechanik-Optionen siehe `MPP_NOTES.md`.
- Optionaler LLM-Bid-Agent (§5.2) und echter zweiter Bieter-Prozess (§5.3): nicht nötig
  für die These; der deterministische Agent + simulierte Konkurrenz erfüllen §5/§A.
- Merkle-Root des Attention-Logs (§4 optional): ausgelassen.

## Deployment-Hinweis

Vercel deployt `main`. Frontend braucht eine erreichbare Backend-URL: `?server=<https-url>`
(z. B. `pnpm tunnel` → cloudflared) → wird in `localStorage` gemerkt; sonst zeigt die App
den „Backend needed"-Screen. ⚠️ Nur Testnet.
