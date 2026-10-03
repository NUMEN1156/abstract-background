# Abstract Background — Umsetzungsplan

Quelle: NotebookLM-Notebook „Abstract Background: AI Superposition Enterprise Middleware“.
Ziel: ein lauffähiger, interaktiver Enterprise-Prototyp der beschriebenen Middleware.

## Produktkern

„Abstract Background“ bündelt eine Anfrage gleichzeitig an mehrere KI-Anbieter (OpenAI, Anthropic,
Mistral, Llama). Die Antworten laufen als **Superposition** parallel ein und sind live sichtbar.
Schieberegler gewichten jede Ausgabe; ein **visueller Kollaps** führt die gewichteten Antworten zu
einem finalen Ergebnis zusammen. Sensible Zugangsdaten bleiben ausschließlich serverseitig.

## Umsetzungsentscheidungen

- **Frontend**: React 18 + TypeScript + Vite, deutsche Oberfläche, Cyber-Minimalismus.
- **Backend**: Node.js mit Fastify auf Port 3000, ausgeliefert als ein Prozess.
  - `@fastify/websocket` für bidirektionale Live-Streams (`/ws`).
  - Zusätzlich **SSE-Fallback** (`/api/stream/:sessionId`), damit der Live-Kanal auch dann trägt,
    wenn ein Zwischenproxy keine WebSocket-Upgrades durchlässt.
  - **Event-Buffer pro Session**: ein später hinzukommender Client (z. B. nach dem Fallback)
    erhält zuerst alle bereits gesendeten Ereignisse, danach live weiter.
- **Entwicklung**: Vite im Middleware-Modus im selben Fastify-Prozess (HMR + API auf einem Port).
  **Produktion**: Fastify liefert den gebauten `dist/`-Ordner statisch aus; Container-Betrieb über
  `Dockerfile` mit Health-Pfad `/api/health`.
- **Provider-Modell**: vier Basisadapter mit eigener Rhetorik und Metrik-Profil. Antworten werden
  serverseitig aus dem Prompt abgeleitet und tokenweise gestreamt; Laufzeiten und Tokens werden
  echt gemessen. Externe Anbieter-Schlüssel sind nicht nötig, die Simulation ist als solche in der
  UI gekennzeichnet.
- **Sicherheit**: `server/crypto.mjs` legt Demo-Schlüssel mit AES-256-GCM verschlüsselt ab und gibt
  ausschließlich maskierte Vorschau plus Fingerprint nach außen. Kein Schlüssel verlässt den Server.
- **Adapter-Registry**: neue Modelladapter zur Laufzeit anlegbar; Persistenz in `.data/adapters.json`,
  Standardadapter im Code.

## Projektstruktur

```
abstractbg/
├── server/
│   ├── index.mjs        Fastify-Server, Routen, Vite-Middleware, Static-Auslieferung
│   ├── hub.mjs          Session-Hub, Event-Puffer, WebSocket- und SSE-Transport
│   ├── providers.mjs    Basisadapter, Persona-Templates, Prompt-Auswertung
│   ├── adapters.mjs     Adapter-Registry inkl. Persistenz und Validierung
│   ├── coherence.mjs    Kohärenzanalyse: Jaccard-Ähnlichkeit, Matrix, Konvergenz-Index
│   ├── synthesis.mjs    Kollaps-Algorithmus, Kollapsregeln und Kollaps-Protokoll
│   └── crypto.mjs       AES-256-GCM-Demo-Tresor und Maskierung
├── src/
│   ├── main.tsx, App.tsx, styles.css, types.ts
│   ├── api/client.ts                REST-Client
│   ├── api/stream.ts                WebSocket-Transport mit SSE-Fallback
│   ├── state/useSuperposition.ts    Sitzungs-, Gewichtungs- und Kollapszustand
│   ├── utils/format.ts              Zahlen-, Zeit- und Prozentformatierung
│   └── components/                  Header, PromptConsole, ProviderCard, SuperpositionField,
│                                    WeightPanel, CollapseStage, ResultPanel, AdapterRegistry,
│                                    ArchitecturePanel, Telemetry
├── public/manus-routes.json
├── index.html, vite.config.ts, tsconfig*.json
├── package.json, pnpm-workspace.yaml, Dockerfile, app.config.ts
```

## Design

- **Design Movement**: Cyber-Minimalismus — technische Präzision, reduzierte Fläche, messbare Signale.
- **Core Principles**: (1) Jede Information ist ein Messwert, kein Schmuck. (2) Fläche bleibt ruhig,
  Signalfarbe markiert Zustand. (3) Bewegung erklärt Mechanik, sie dekoriert nicht. (4) Monospace
  trägt Daten, Sans trägt Sprache.
- **Color Philosophy**: Void-Schwarz `#06080B` als Träger, Graphit `#10161D` für Flächen, Eis `#E6F1F7`
  für Text. Signaturfarbe **Plasma-Cyan `#4FE3D0`** markiert Systemzustand und Ergebnis. Jeder
  Anbieter besitzt eine eigene Akzentfarbe (OpenAI Teal, Anthropic Ton, Mistral Orange, Llama Indigo).
- **Layout Paradigm**: Vertikaler Instrumentenfluss statt zentriertem Raster — linkslaufende
  Messleiste, mittiges Superpositionsfeld, rechts angedockte Steuerung; asymmetrische Spaltenbreiten.
- **Signature Elements**: (1) das Superpositionsfeld mit überlagerten Wellenlinien, deren Summe das
  Kollapsergebnis vorzeichnet; (2) die Kollaps-Bühne mit konvergierenden Lichtbahnen; (3) Monospace-
  Messzeilen mit Live-Werten.
- **Interaction Philosophy**: Alles ist unmittelbar rückgekoppelt — eine Gewichtsänderung verschiebt
  sofort Kurvenform, Prozentverteilung und Prognose der Kollaps-Gewichte.
- **Animation**: 120–400 ms, lineare bis weiche Kurven, keine Federphysik. Streams tippen sich
  zeichenweise ein; der Kollaps läuft als dreistufige Sequenz (Bündeln, Verschmelzen, Auflösen).
- **Typography System**: „Inter“ für Sprache, „JetBrains Mono“ für alle Zahlen, Labels und Statuscodes,
  mit System-Fallbacks. Größen: 12/13/15/20/32 px, Versalien nur für Labels.
- **Brand Essence**: Middleware, die Entscheidungen aus mehreren KI-Modellen gewichtet statt rät —
  für Teams, die Modellvergleiche belegen müssen. Präzise, nüchtern, wach.
- **Brand Voice**: Direkt, technisch, ohne Werbefloskeln. Beispiele: „Vier Modelle. Ein Ergebnis.“ —
  „Superposition läuft. Gewichte entscheiden, was bleibt.“
- **Wordmark & Logo**: Wortmarke `ABSTRACT/BACKGROUND` in Versalien mit Schrägstrich-Trenner; das
  Zeichen ist ein Quadrat aus zwei überlagerten Wellenlinien, die zu einer Linie zusammenlaufen.
- **Signature Brand Color**: Plasma-Cyan `#4FE3D0`.

## Abnahme

- Superposition über mehrere Provider startbar, Antworten parallel und live sichtbar.
- Gewichtsregler je Modell mit unmittelbar sichtbarer Verteilung.
- Kollaps erzeugt ein finales Ergebnis samt Protokoll der eingeflossenen Gewichte.
- Adapter dialogbasiert hinzufügbar und sofort nutzbar.
- Sicherheitsstatus zeigt serverseitige Schlüsselhaltung ohne Exposition.
