# Abstract Background

Prototyp einer Enterprise-Middleware für **AI-Superposition**. Eine Anfrage wird gleichzeitig an
mehrere Modelle gestellt, deren Antworten parallel einlaufen, einzeln gewichtet und über einen
visuellen Kollaps zu einem finalen Ergebnis zusammengeführt werden.

Grundlage: NotebookLM-Notebook „Abstract Background: AI Superposition Enterprise Middleware“.

## Funktionsumfang

- **Auftragskonsole** mit Adapterauswahl, Kollapsregel und Streuungsparameter
- **Superpositionsfeld**: je Modell eine Welle, Amplitude folgt dem Gewicht; die Summenkurve
  zeichnet das Kollapsergebnis vor
- **Fünf Kanäle** (OpenAI, Anthropic, Mistral, Llama plus eigene Adapter) mit tokenweise
  gestreamten Antworten, gemessener Laufzeit, Tokenzahl und Live-Status
- **Gewichtungsregler** je Modell mit unmittelbar sichtbarer Verteilung
- **Kollaps** in drei Phasen mit anschließendem Ergebnis, Kollaps-Protokoll, Konvergenz-Index,
  Modellgüte und Kohärenzanalyse zwischen allen Modellpaaren
- **Adapter-Verzeichnis**: neue Adapter zur Laufzeit anlegen, aktivieren, auswählen, entfernen
- **Sicherheitsstatus**: serverseitiger AES-256-GCM-Tresor, maskierte Vorschau und Fingerprint,
  keine Schlüssel im Frontend
- **Telemetrie** und Ereignisprotokoll in der linken Messleiste

## Architektur

| Schicht | Umsetzung |
| --- | --- |
| Frontend | React 18, TypeScript, Vite — Cyber-Minimalismus, deutsche Oberfläche |
| Backend | Node.js, Fastify auf Port 3000 (ein Prozess für API, Stream und Frontend) |
| Live-Kanal | WebSocket `/ws` mit automatischem Rückfall auf Server-Sent-Events |
| Nebenläufigkeit | Ereignispuffer je Sitzung — späte Empfänger erhalten zuerst den Verlauf |
| Adapter | modulare Registry mit Validierung und Persistenz in `.data/adapters.json` |
| Sicherheit | `server/crypto.mjs`: AES-256-GCM, Maskierung, Fingerprint |

Der Prototyp simuliert die Anbieterantworten serverseitig; Laufzeit, Tokenzahl und Streuung sind
gemessene Werte der Simulation. Die Adapter lassen sich später gegen echte Endpunkte tauschen,
ohne die Oberfläche zu ändern.

## Entwicklung

```sh
pnpm install
pnpm dev      # Vite im Middleware-Modus im Fastify-Prozess, Port 3000
pnpm check    # TypeScript ohne Ausgabe
pnpm build    # Produktionsbuild nach dist/
pnpm start    # Produktionsbetrieb, liefert dist/ statisch aus
```

## Schnittstellen

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/health` | Bereitschaftsprüfung |
| GET | `/api/architecture` | Beschreibung des Stacks |
| GET | `/api/security` | Tresorstatus, Maskierung, Maßnahmen |
| GET | `/api/adapters` | alle Adapter |
| POST | `/api/adapters` | Adapter anlegen (validiert) |
| PATCH | `/api/adapters/:id` | Adapter ändern |
| DELETE | `/api/adapters/:id` | eigenen Adapter entfernen |
| POST | `/api/superposition` | Sitzung starten, liefert `sessionId` und Kanalpfade |
| GET | `/api/stream/:id` | Server-Sent-Events-Kanal |
| GET | `/ws?session=…` | WebSocket-Kanal |
| GET | `/api/session/:id` | Zustand einer Sitzung |
| POST | `/api/collapse` | Kollaps mit Gewichten auslösen |
| GET | `/api/telemetry` | Momentaufnahme der Telemetrie |

## Veröffentlichung

Containerbetrieb über `Dockerfile` (Build-Stufe erzeugt `dist/`, Laufzeitstufe startet
`server/index.mjs`), Health-Pfad `/api/health`, Port 3000.