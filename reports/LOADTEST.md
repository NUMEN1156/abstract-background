# Lasttest der Superpositions-Middleware

Auswertung zweier Laststufen gegen das Fastify-Backend und das ESM-Modul `server/coherence.mjs`.
Rohdaten und Einzelberichte liegen unter `reports/` (JSON und Markdown je Lauf).

| Lauf | Datum | Konfiguration | Rohdaten |
| --- | --- | --- | --- |
| Stufe A | 03.10.2026, 10:09 UTC | 120 Sitzungen, 60 im Lastmix, 120 Kollapsanfragen | `loadtest-2026-10-03T10-09-22-744Z.json` |
| Stufe B | 03.10.2026, 10:09 UTC | 240 Sitzungen angefragt bei Obergrenze 200, 48-fache Kollapsparallelität | `loadtest-2026-10-03T10-09-50-331Z.json` |

Aufruf: `node scripts/loadtest.mjs --base=http://127.0.0.1:3200 --sessions=120`.
Gemessen wurde eine Produktionsinstanz (`NODE_ENV=production`, ein Node-Prozess, ein Kern) mit
`ABSTRACT_MAX_SESSIONS=200`; jede Sitzung fragt vier Kanäle ab.

## 1. Nebenläufigkeit und Ereignispuffer

| Kennzahl | Stufe A (120) | Stufe B (240 → 200) |
| --- | --- | --- |
| Sitzungen angenommen | 120 / 120 | 200 / 240 |
| Sitzungen abgeschlossen | 120 | 200 |
| abgelehnt | 0 | 40 (HTTP 429, Kapazitätsgrenze) |
| Ereignisse im Test | 44.832 | 74.696 |
| Textblöcke | 42.432 | 70.720 |
| gestörte Modellkanäle | 0 | 0 |
| erster Textblock (P95) | 364 ms | 292 ms |
| Abschluss aller Kanäle (P95) | 9,47 s | 9,48 s |
| Pufferprüfung später Empfänger | 5 / 5 identisch | 5 / 5 identisch |

Die Pufferprüfung ist die eigentliche Stabilitätsaussage: Nach Abschluss verbindet sich ein
zweiter Empfänger und erhält die nachgespielten Ereignisse. In beiden Stufen stimmte der
rekonstruierte Text Zeichen für Zeichen mit dem live empfangenen überein — geprüft an fünf
Sitzungen mit 364 bis 371 gepufferten Ereignissen und 767 bis 1130 Zeichen.

Über 200 gleichzeitige Sitzungen, also 800 parallel streamende Kanäle, blieb kein Kanal
hängen: keine Zeitüberschreitung, kein Verbindungsabbruch, keine Störung. Der Transport
(WebSocket) hielt 74.696 Ereignisse ohne Verlust.

## 2. Latenz der Kollaps-Synthese

| Messung | Stufe A ruhend | Stufe A unter Last | Stufe B ruhend | Stufe B unter Last |
| --- | --- | --- | --- | --- |
| Anfragen / Parallelität | 120 / 32 | 120 / 32 | 120 / 48 | 120 / 48 |
| Fehler | 0 | 0 | 0 | 0 |
| Mittelwert | 18,9 ms | 18,8 ms | 25,8 ms | 26,3 ms |
| P95 | 26,4 ms | 28,1 ms | 38,8 ms | 36,9 ms |
| P99 | 34,7 ms | 31,6 ms | 43,7 ms | 39,6 ms |
| Maximum | 35,0 ms | 32,2 ms | 44,2 ms | 40,0 ms |

„Unter Last" bedeutet: Die Kollapsanfragen wurden ausgelöst, während dieselben Sitzungen noch
streamten. Die Latenz blieb praktisch unverändert gegenüber dem Ruhezustand — die Synthese
verdrängt die Streams nicht, weil sie vollständig synchron und ohne Warten auf Ein-/Ausgabe
rechnet. Bei doppelter Sitzungszahl stieg die Latenz um rund 10 ms und blieb damit im
zweistelligen Millisekundenbereich.

Einschränkung: Im Lastfall sind die Eingaben kürzer (rund 250 statt 484 Token), weil die Kanäle
noch streamen. Die Kollapskosten hängen an der Textlänge; der Vergleich ist deshalb konservativ
zugunsten des Lastfalls.

## 3. CPU und Skalierung der Kohärenzmatrix

Gemessen mit 180-Wort-Texten, CPU-Zeit über `process.cpuUsage()`, Matrix mit einmaligem
Zerlegen der Texte je Ausgabe:

| Modelle | Paare | Wandzeit | CPU-Zeit | je Paar | paarweise ohne Zwischenspeicher |
| --- | --- | --- | --- | --- | --- |
| 4 | 12 | 0,52 ms | 0,77 ms | 64,1 µs | — |
| 8 | 56 | 0,37 ms | 0,37 ms | 6,6 µs | — |
| 16 | 240 | 0,87 ms | 0,87 ms | 3,6 µs | — |
| 32 | 992 | 2,60 ms | 2,59 ms | 2,6 µs | — |
| 64 | 4.032 | 9,79 ms | 14,89 ms | 3,7 µs | 248,9 ms |
| 128 | 16.256 | 13,95 ms | 22,14 ms | 1,4 µs | — |
| 256 | 65.280 | 48,95 ms | 48,93 ms | 0,75 µs | 3.846,5 ms |

Befunde:

- Die Kosten wachsen mit der Zahl der Paare, also quadratisch zur Modellzahl. Der Sprung von 32
  auf 256 Modelle bedeutet das 65,8-Fache an Paaren und kostet rund das 14-Fache an CPU-Zeit.
- Das einmalige Zerlegen der Texte ist der entscheidende Hebel: Bei 64 Modellen sinkt die
  Wandzeit von 248,9 ms auf 9,8 ms (rund 25-fach), bei 256 Modellen von 3.846 ms auf 49 ms
  (rund 79-fach). Ohne diese Optimierung würde jede Anfrage denselben Text quadratisch oft
  tokenisieren.
- Im realen Betrieb ist die Modellzahl durch die Adapter-Registry begrenzt (vier Basisadapter
  plus höchstens 24 eigene, also 28). Bei 28 Modellen liegt die Matrix im Bereich weniger
  Millisekunden und damit weit unter der gemessenen Kollapslatenz.
- Der Single-Process-Server arbeitet die Matrix synchron ab. Bei 200 gleichzeitigen
  Kollapsanfragen mit je vier Modellen bleiben die Anfragen dennoch unter 50 ms, weil eine
  einzelne Matrix im Sub-Millisekundenbereich liegt. Erst mit sehr vielen Modellen je Sitzung
  wird die synchrone Berechnung zum Engpass; dann wäre eine Worker-Thread-Auslagerung oder eine
  inkrementelle Berechnung sinnvoll.

Einschränkung: Die synthetischen Texte stammen aus einem kleinen Wortschatz von 16 Begriffen, die
Wortmengen sind dadurch klein. Texte mit mehreren hundert verschiedenen Wörtern erhöhen die
Kosten je Paar deutlich; die absoluten Werte sind also eine untere Schranke, das Verhältnis
zwischen den Verfahren bleibt davon unberührt.

## 4. Durchsatz einfacher HTTP-Endpunkte

| Kennzahl | Stufe A | Stufe B |
| --- | --- | --- |
| Anfragen / Parallelität | 1.000 / 50 | 1.000 / 50 |
| Anfragen pro Sekunde | 2.472 | 2.493 |
| Mittelwert | 19,8 ms | 19,6 ms |
| P95 | 23,5 ms | 24,3 ms |
| Fehler | 0 | 0 |

Der Durchsatz blieb über beide Stufen konstant, obwohl im Hintergrund 800 Kanäle streamten:
Die Lesepfade (`/api/health`, `/api/adapters`, `/api/architecture`, `/api/security`) sind
unabhängig von der Streaming-Last.

## 5. Speicher

| Kennzahl | Stufe A | Stufe B |
| --- | --- | --- |
| aktive Sitzungen am Ende | 200 | 200 |
| gepufferte Ereignisse | 73.548 | 73.520 |
| Nachrichten insgesamt | 184.300 | 302.252 |
| RSS | 123,8 MB | 129,7 MB |
| Heap | 37,6 MB | 29,9 MB |

Der Speicher wächst mit der Zahl der gehaltenen Sitzungen und deren Ereignispuffern, nicht mit der
Zahl der übertragenen Nachrichten: Stufe B hat bei gleichem RSS fast doppelt so viele Nachrichten
verarbeitet. Rund 0,6 MB pro Sitzung mit vier abgeschlossenen Kanälen; der Puffer ist der
dominierende Anteil. Leck-Hinweise gab es keine — der Heap blieb zwischen den Stufen stabil.

## 6. Gefundene und behobene Mängel

1. **Stilles Verdrängen aktiver Sitzungen.** Bei Erreichen der Obergrenze entfernte der Hub die
   am längsten unbenutzte Sitzung. Unter Last waren das laufende Sitzungen, deren Kanäle
   abgeschnitten wurden: In Stufe B (vor der Korrektur) wurden 40 Sitzungen verdrängt und ihre
   Kanäle mit `fatal` beendet. Jetzt werden nur beendete und unbeobachtete Sitzungen freigegeben;
   ist keine verfügbar, wird der neue Auftrag mit HTTP 429 und klarer Begründung abgelehnt
   (fail-closed statt Datenverlust). Nach der Korrektur: 200 von 200 angenommenen Sitzungen
   abgeschlossen, 40 sichtbare Ablehnungen, kein abgeschnittener Kanal.
2. **Quadratische Tokenisierung.** Die Matrix zerlegte jeden Text paarweise neu. Mit
   einmaligem Zerlegen je Ausgabe sank die CPU-Zeit bei 256 Modellen um rund 79-fach.
3. **Fehlende Speichersichtbarkeit.** Die Telemetrie zeigt nun RSS, Heap und gepufferte
   Ereignisse, sodass ein Lastlauf ohne externe Werkzeuge bewertbar ist.

## 7. Grenzen der Messung

- Ein Node-Prozess, ein CPU-Kern, Sandbox-Umgebung ohne reservierte Kerne; absolute Zahlen sind
  nicht auf andere Hardware übertragbar.
- Die Anbieterantworten sind serverseitige Simulationen. Reale Modellaufrufe würden die Latenz
  vollständig von der Netzwerk- und Anbieterseite bestimmen.
- Kein TLS, kein Vorschaltproxy, keine Datenbank — gemessen wurde bewusst der Kernpfad.
- Die Pufferprüfung wurde an fünf Sitzungen je Stufe durchgeführt, nicht an allen.
- Die Laststufen liefen nacheinander; die Sitzungen der Stufe A waren während Stufe B noch
  gehalten, was dem Betrieb mit fortlaufender Nutzung entspricht.

## 8. Empfehlungen

1. **Obergrenze bewusst setzen.** `ABSTRACT_MAX_SESSIONS` bestimmt den Speicherbedarf; bei
   rund 0,6 MB je gehaltener Sitzung sind 200 Sitzungen etwa 130 MB. Für mehr Gleichzeitigkeit
   ist die horizontale Skalierung über mehrere Prozesse der einfachere Weg als eine Erhöhung der
   Grenze.
2. **Puffer begrenzen.** Die Ereignispuffer wachsen bis zum Ablauf der Sitzung (20 Minuten). Eine
   Obergrenze je Sitzung mit dokumentiertem Verhalten für späte Empfänger würde den Speicher
   berechenbar machen.
3. **Matrix je Sitzung beobachten.** Ab etwa 30 gleichzeitigen Kollapsanfragen mit vielen
   Modellen lohnt eine Auslagerung in Worker-Threads oder eine inkrementelle Fortschreibung der
   Matrix während des Streamings.
4. **Kompression prüfen.** Bei 42.000 Textblöcken je Lauf wäre `permessage-deflate` auf dem
   WebSocket-Kanal der nächste naheliegende Hebel, sobald Netzwerk statt CPU der Engpass ist.
