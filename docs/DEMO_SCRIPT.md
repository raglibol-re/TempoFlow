# FLOW — 3-Minuten-Demo-Skript

Ziel: Die These in unter 3 Minuten zeigen — der selbstfinanzierende Feed, transparent,
mit autonomen Maschinen-Zahlungen. ⚠️ Nur Tempo-Testnet.

## Vorbereitung (vor dem Pitch)

1. Backend läuft + ist öffentlich erreichbar: `pnpm dev:server` und `pnpm tunnel`
   (cloudflared) → HTTPS-URL kopieren.
2. Vercel-Frontend einmal mit Backend verbinden: `https://<vercel-url>/?server=<tunnel-url>`
   öffnen (merkt sich die URL).
3. Mindestens eine **finanzierte Ad** existiert: in **Ads** „Publish + escrow" mit z. B.
   €1 (echter On-Chain-Escrow-Deposit). Sonst bietet kein Agent → kein IN.
4. Eingeloggt als ein Konto mit pathUSD-Guthaben (Demo-Konto oder „Create account" →
   Faucet). Adresse + Saldo siehst du oben rechts.

## Ablauf (die Story)

**0:00 — Der Haken (10 Sek).**
„Stell dir einen Feed vor, in dem Zuschauen dich netto nichts kostet — weil Werbung
*dich* bezahlt, nicht die Plattform. Und keine dieser Zahlungen löst ein Mensch aus."

**0:10 — Live-Saldo öffnen.** Nav **⚡ Live Saldo** → **▶ Start flow session**.
- **Phase 1 — du schaust:** Geld tropft **raus an den Creator** (pro Sekunde Watchtime),
  dein **Saldo sinkt**. Sub-Cent sichtbar (€0.000X/s).
- **Phase 2 — Saldo wird knapp:** das Video **pausiert**, dein Agent spielt automatisch
  eine passende Ad → Werbe-Geld tropft **rein zu dir** (pro verifizierter Sekunde), der
  **Saldo füllt sich auf**. Danach läuft das Video weiter — zurück zu Phase 1.
- **Mitte** der große **Netto-Saldo landet über die Zeit bei ~Null** (abwechselnd raus,
  dann rein — nicht gleichzeitig).
- Kernsatz: **„20 Minuten geschaut, netto ~0 € bezahlt."**

**0:50 — Die Maschinen-Zahlung zeigen (§5/§A).** Auf das Overlay am rechten Zähler
zeigen: **„N agents bidding · clearing €0.000X/s"**. Der Preis **zuckt sichtbar**, wenn
Bieter rein-/rauskommen.
- „Den Preis deiner Aufmerksamkeit handeln **Maschinen in Echtzeit** aus — eine Auktion
  **pro Sekunde** (Second-Price). Kein Mensch klickt. Tausende Sub-Cent-Settlements pro
  Sekunde — **das geht nur auf Tempo.**"

**1:20 — Anti-Fraud ehrlich (§4).** Kurz „look away" klicken / Tab-Wechsel →
rechter Zähler **pausiert sofort**. Tap-Challenge zeigen.
- „Aufmerksamkeit ist ein **binäres Gate**: verifiziert ja/nein schaltet die Zahlung
  frei. Der **Preis** hängt an der Nachfrage der Advertiser — **nie** am Attention-Signal.
  So kann ein Bot den Preis nicht hochfaken. Das ist ein *attention check*, kein
  *bot-proof* — ehrlich kalibriert."

**1:50 — Settlement.** **■ Stop & settle** → Channel wird **on-chain gesettled**, der
ungenutzte Advertiser-Rest **fließt sichtbar zurück**, Settlement-Tx verlinkt.

**2:10 — Transparenz (§3).** Nav **Ledger**.
- „Kein Blackbox-Mittelmann. Jeder Euro on-chain: was der Viewer zahlt, was der Creator
  bekommt, die **sichtbare Plattform-Marge (3 %)**, was der Advertiser ausgibt — alles
  im Tempo-Explorer nachprüfbar."

**2:40 — Abbinder.** „Ein selbstfinanzierender Feed, transparent statt Blackbox, mit
einem **Live-Aufmerksamkeitsmarkt zwischen autonomen Agenten** — bezahlbar nur auf Tempo."

## Plan B (wenn etwas hakt)

- Kein IN/kein Bieter? → in **Ads** eine Kampagne mit „Publish + escrow" finanzieren,
  dann Flow-Session neu starten.
- On-Chain-Channel-Open ist langsam (öffentliches RPC, ~8–15 s)? → kurz warten; der
  rechte Zähler startet, sobald die erste Auszahlung registriert ist.
- Dynamic Pricing wackelt? → trotzdem pitchbar mit fester Rate; der Netto-Saldo (§2) ist
  der Star. Im Zweifel nur §2 + §3 zeigen.
- Vercel „Backend needed"? → `?server=<tunnel-url>` an die URL hängen.
