# MPP / mppx — verwendete Methoden (gegen die Docs geprüft)

Quelle der Wahrheit: https://mpp.dev/llms-full.txt (+ `docs/02-mpp-integration.md`).
Regel: jede Signatur erst hier eintragen + gegen die Docs prüfen, dann verwenden.
Keine API-Methoden erfinden. Version: `mppx@0.7.0`. ⚠️ Nur Testnet.

## Server (`mppx/server`)

| Methode | Verwendung im Code | Docs |
|---|---|---|
| `Mppx.create({ methods, secretKey })` | `server/src/config.ts` — eine mppx-Instanz mit der `tempo`-Methode | mppx/server, „SDK" |
| `tempo({ account, recipient, currency, decimals, chainId, escrowContract, store, getClient, sse })` | `config.ts` — Tempo als Payment-Methode, SSE-Polling, geteilter Store | `docs/02-mpp-integration.md` |
| `Store.memory()` | `config.ts` — geteilter `channelStore` für Session + Metering | mppx/server |
| `mppx.session({ amount, currency, decimals, unitType, chainId, recipient, operator, suggestedDeposit })(req)` | `index.ts` — Direction A `/watch/:id` (recipient = creator) **und** Direction B `/attention/:campaignId/:viewerId` (recipient = viewer) | `docs/02-mpp-integration.md`, „Challenge → Credential → Receipt" |
| `result.withReceipt(async function*(stream){ … })` | `index.ts` — pro-Sekunde-Generator; gibt `tick`-NDJSON aus | mppx per-second pattern |
| `stream.charge()` | `index.ts` — committet eine Einheit (Sekunde) an den Channel | mppx session API |
| `escrowContract: ESCROW_CONTRACT` (`0x4d5050…0000`) | `config.ts` — kanonisches TIP-1034-Escrow-Precompile (ADR-005) | mppx Protocol.ts |

## Client (`mppx/client`)

| Methode | Verwendung | Docs |
|---|---|---|
| `sessionManager({ account, client, decimals, maxDeposit, escrow })` | `web/src/flow.ts` (`manager`), `agent/src/lib.ts` (`makeManager`) — Channel als Viewer/Advertiser öffnen | „Client" |
| `manager.sse(url)` | `flow.ts` (`watchClip`) — Streaming-Session, AsyncIterable der SSE-Daten | „Client" |
| `manager.close()` | `flow.ts` — settlet den höchsten Voucher on-chain + refundet den ungenutzten Deposit | „Client settlement" |
| `runPaidStream({ manager, url, stopUrl, onFrame, shouldStop })` | `agent/src/lib.ts` — treibt den Advertiser-Stream Frame-für-Frame (Open-Retry) | wrappt `manager.sse` + `manager.close` |

Inventur-Ergebnis: alle oben gegen die Docs als **passend** verifiziert. App-Ledger-
Funktionen (`chargeForStreamingSeconds`, `creditAdReward`) sind **kein MPP** — sie sind
die App-interne USD-Buchhaltung (Anzeige/Tips/AI/Pledges), getrennt vom On-Chain-MPP.

## §A — Dynamic Attention Pricing: Clearing-Mechanismus

- Gewählt: **Second-Price (Vickrey)** — höchster Bid gewinnt, der **zweithöchste** Bid
  ist der Clearing-Preis (was der Viewer pro Sekunde verdient). Implementiert in
  `server/src/auction.ts` (`runAuction`) über finanzierte Kampagnen; im
  `FlowSession`-Screen um 1–3 **simulierte Konkurrenz-Bids** ergänzt (`// MOCK:`), damit
  der Preis sichtbar zuckt. Ehrlich als „simulierte Konkurrenz" zu pitchen.
- **Guardrail (§A2), im Code geprüft:** Der Clearing-Preis hängt ausschließlich an der
  **Nachfrageseite** (konkurrierende Advertiser-Bids + Zeit). Er liest **kein**
  Attention-Signal des Viewers. Die Viewer-Attention ist ein **binäres Gate**
  (`gateOpen` in `FlowSession`: visible + on-screen + nicht „look away"), das die
  Auszahlung freischaltet, aber **niemals** die Höhe bestimmt. So lässt sich der Preis
  nicht über das (fälschbare) Attention-Signal hochtreiben.

## Plattform-Marge — Mechanik-Optionen (Stand + Plan)

Aktuell: die Marge wird im **Ledger transparent über echten Flows angezeigt**
(`PLATFORM_FEE`, default 3 %), aber NICHT als separate On-Chain-Transaktion auf dem
Watch-Channel abgezogen. Grund: `mppx@0.7.0` `session` hat **kein `splits`-Feld** (nur
Einmal-`charge` unterstützt Splits), und ein Rerouting des verifizierten Watch-Flows am
letzten Tag ist Risiko. Saubere On-Chain-Optionen (dokumentiert, nicht verdrahtet):

1. **Operator-Routing:** `recipient = operatorAddress`; bei Settlement leitet der
   Operator `(1 − fee)` an den Creator weiter (gleiches Pattern wie der bereits
   verifizierte Escrow-Refund: `settlementClient.writeContract` ERC-20 transfer). Der
   Operator behält `fee` als sichtbare Marge.
2. **Ad-seitige Marge:** der Operator-Escrow zahlt dem Viewer `(1 − fee)×bid` und behält
   `fee×bid` — keine zusätzliche Tx nötig (der Operator ist ohnehin der Payer).
3. **Multi-Recipient-Channel** (TIP-1034-Escrow unterstützt es laut Docs) — derzeit
   nicht verdrahtet.
