# Blinder Drucktest und Arbitrierungs-Ablation

Stand: 2026-10-04. Zwei unabhängige Prüfungen liegen diesem Bericht zugrunde:

1. **Black-Box-Drucktest** (`scripts/pressure-blackbox.mjs`, `scripts/system-probe.mjs`,
   `scripts/channel-probe.mjs`, `scripts/verify-hardening.mjs`) — Last, Kapazitätsgrenze,
   Kanaltreue später Empfänger, Eingabemißbrauch, Schutzzustände.
2. **Arbitrierungs-Ablation** (`evaluation/`) — drei Arbitrierungs-Lanes auf eingefrorenen
   Modellantworten, vorab registrierte Anordnung.

Zusätzlich lief ein unabhängiger, blind arbeitender Prüf-Agent ohne Kenntnis des Quellcodes gegen
die öffentliche Instanz (Ergebnis unten, Abschnitt 2).

Alle Rohausgaben liegen in `reports/pressure/` und `evaluation/`.

---

## 1. Last, Grenze und Kanaltreue

| Kennzahl | vor der Härtung (live) | nach der Härtung (lokal, `PORT=3700`) |
| --- | --- | --- |
| Sitzungen angefordert | 130 | 130 |
| angenommen (HTTP 200) | 100 | 119 |
| abgewiesen (HTTP 429) | 30 | 11 |
| Annahmelatenz p95 | 1 987 ms | 98 ms |
| Kollaps p50 / p95 / max | 625 / 2 060 / 2 076 ms | 30 / 58 / 62 ms |
| Kanäle mit Fehlern (früh/spät) | 0 / 0 | 0 / 0 |
| Kanalvergleich früher ↔ später Empfänger | 8/16 identisch | Inhalt 348/348 Ereignisse gleich |

Lesart: Die Kapazitätsgrenze greift **fail-closed** (HTTP 429 mit Klartextgrund), der Prozess
bleibt bedienbar, und die Latenzen sinken nach der Härtung um mehr als den Faktor 20. Der
Unterschied zur Live-Messung erklärt sich durch den Proxy vor der öffentlichen Instanz, nicht
durch die Anwendung: lokal gemessen liegt die Kollaps-Synthese bei 58 ms p95 unter gleichzeitiger
Dauerlast.

Der Kanaltreue-Test öffnet dieselbe Sitzung zweimal — sofort und verzögert — und vergleicht die
empfangenen Ereignisse. Der späte Empfänger rekonstruiert den Inhalt vollständig (348 von 348
inhaltlichen Ereignissen identisch); ein einzelner Telemetrie-Takt wird nicht nachgespielt. Das
ist erwartet: Telemetrie wird nicht gepuffert, Inhalte schon.

## 2. Unabhängiger Blindtest

Ein Prüf-Agent ohne Quellcode-Kenntnis erhielt nur URL und Auftrag, das System „kaputt zu
machen". Gefundene Punkte und ihr heutiger Stand:

| Befund | Schwere damals | Stand heute |
| --- | --- | --- |
| Adapter-Registry öffentlich veränderbar (Fremde konnten Kanäle abschalten) | hoch | **behoben** — Registry ist ohne Betreiberfreigabe gesperrt (HTTP 403), `ABSTRACT_ADAPTER_WRITES=key\|open` schaltet frei |
| Eingaben ungeprüft (Gewichte, Schwellen, Adapterauswahl, Prototype-Pollution) | mittel | **behoben** — strikte Prüfung, 400 mit Feldname |
| Volllast führte zu Warteschlange statt klarer Ablehnung | mittel | **behoben** — HTTP 429 ohne Verdrängung laufender Sitzungen |
| Laufende Sitzungen wurden von neuen verdrängt | mittel | **behoben** — Schonfrist `ABSTRACT_EVICTION_GRACE_MS`, danach HTTP 410 mit Grund |
| Prompt wurde vollständig zurückgespiegelt | niedrig | **behoben** — nur noch bereinigte Vorschau (`promptPreview`, 120 Zeichen, Steuerzeichen entfernt) |
| „apiKey"/„secret" im Frontend-Bundle | hoch | **Fehlalarm** — Bezeichner der Zugangsmaske, keine Werte; Secret-Werte liegen nie im Bundle |
| Kollaps-Latenz über 1,5 s auf der Live-Instanz | mittel | Proxy-Messung; lokal 58 ms p95, nach der Veröffentlichung erneut zu messen |
| Live-Instanz lieferte keinen Konsensblock | Info | Die Live-Instanz lief auf einem älteren Prüfpunkt; mit der Veröffentlichung des aktuellen Stands erledigt |

Härtungsprüfung `scripts/verify-hardening.mjs`: **18 von 18 Prüfungen bestanden** (Schreibschutz,
Feldprüfung für Gewichte/Schwellen/Mindeststützung, gültige Eingaben weiterhin akzeptiert).

## 3. Arbitrierungs-Ablation (Kurzfassung)

Anordnung, Korpus und Regeln sind in `evaluation/PREREGISTRATION.md` vorab eingefroren; die
Kanalantworten liegen unverändert in `evaluation/frozen/`. Vier echte Modelle aus drei
Anbieterfamilien beantworteten 24 Einträge mit acht Fallentypen (Negation, Zahlenkonflikt,
Entitätstausch, Kausalrichtung, Paraphrase, falsche Voraussetzung, korrekte Minderheit,
Ausführlichkeit). Darüber liefen drei Lanes: der Kollaps des geprüften Systems (A/A′), eine
deterministische Regelarbitrierung (B) und ein unabhängiger LLM-Richter (C).

| Lane | korrekt | Enthaltungen | falsch |
| --- | --- | --- | --- |
| A — Kollaps, gleiche Gewichte | 24/24 | 0 | 0 |
| A′ — Kollaps, gesetzte Gewichte | 24/24 | 0 | 0 |
| B — deterministische Regeln | 24/24 | 0 | 0 |
| C — unabhängiger Richter | 24/24 | 0 | 0 |
| Baseline: stärkste Einzelstimme | 24/24 | 0 | 0 |

Drei Befunde, ehrlich getrennt:

- **Kein Verbundvorteil belegbar.** Die Kanäle lösten die Fallen nahezu vollständig selbst; der
  Verbund kann sie daher nicht übertreffen. Die Behauptung „mehrere Modelle sind besser als
  eines" ist mit diesem Material **nicht bestätigt und nicht widerlegt**.
- **Der messbare Effekt lag im Verbund selbst.** Vor einer Korrektur verlor der Kollaps 3–4 von
  24 Fällen, in denen **alle vier Kanäle** korrekt geantwortet hatten (21/24 bzw. 20/24). Ursache
  war die Auswahlregel: `splitSentences` verwarf Sätze unter vier Wörtern und damit genau die
  Antwortzeile (`ANSWER: 20.0 %`) jeder Ausgabe. Getragen wurde stattdessen die ähnlichste Prosa.
  Das ist das Muster „naiver Konsens belohnt Ähnlichkeit statt Richtigkeit", hier reproduzierbar
  belegt.
- **Kein Einfluss von Identität oder Gewichten.** Ein Identitätstausch der Kanäle ändert kein
  Ergebnis, gesetzte Gewichte ändern kein Ergebnis. Die Entscheidung hängt am Inhalt der
  Antwortzeilen.

Offen und benannt: Es gab **keinen** Fall, in dem die Mehrheit irrte, und **keine** Enthaltung —
Minderheitenrettung und Falschkonsens sind damit ungeprüft. Dafür braucht es ein Korpus, das die
Kanäle tatsächlich spaltet, und eine belastbare Zuversichtssemantik je Lane.

## 4. Änderungen aus diesen Prüfungen

- `server/consensus.mjs`: Antwortzeilen werden unabhängig von ihrer Länge als Satz geführt.
- `server/synthesis.mjs`: Der Kollaps weist seine Entscheidung selbst aus (`decision`-Feld,
  `Entscheidung:`-Zeile) und führt alle Antwortzeilen wörtlich auf.
- `server/index.mjs`: strikte Prüfung von Adapterauswahl, Gewichten, Konsensschwellen und
  Mindeststützung; HTTP 429 mit Grund statt Verdrängung; bereinigte Prompt-Vorschau.
- `server/hub.mjs`: Schonfrist vor Verdrängung, Verdrängungsnachweis, konfigurierbare
  Speichergrenzen.
- `server/access.mjs`: Schreibschutz der Adapter-Registry als Standard in Produktion.
- Frontend: Entscheidungszeile im Ergebnisbereich, Schreibschutz in der Adapterverwaltung sichtbar.

## 5. Was weiterhin gilt

- **Einprozessbetrieb.** Sessions liegen im Arbeitsspeicher; ein Neustart verliert sie. Mehrere
  Instanzen bräuchten einen gemeinsamen Sitzungsspeicher.
- **Demo-Tresor.** AES-256-GCM ohne KMS oder Schlüsselrotation — belegt Integrität, nicht
  Betriebstauglichkeit.
- **Simulierte Anbieterausgaben.** Im Produkt beantworten Personas die Anfragen; dieses Dokument
  trennt Infrastrukturmetriken (hier belastbar) von Inhaltsqualität (nicht Gegenstand).
- **Kein Ratenlimit je Client**, keine echte Benutzerverwaltung.
- **Proxy-Latenz** vor der öffentlichen Instanz ist nicht Anwendungslatenz.