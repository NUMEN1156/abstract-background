# Vorab eingefrorene Versuchsanordnung — Arbitrierung der Modell-Superposition

Status: **eingefroren vor der ersten Generierung**. Dieses Dokument, `corpus.json` und die
Auswertungsregeln in `lib.mjs` werden nach Sichtung der Ergebnisse nicht mehr geändert. Die
Prüfsummen stehen in `evaluation/frozen/MANIFEST.json` und werden zusammen mit der Auswertung
veröffentlicht. Ausdrücklich zulässig ist nur das Beheben von Fehlern, die den Ablauf zum Absturz
bringen (etwa ein falscher Feldname) — protokolliert als Abweichung mit Zeitstempel, ohne die
Regeln, Schwellen oder das Korpus zu verändern.

## 1. Fragestellung

Behauptet wird: „Die gewichtete Kollaps-Synthese erzeugt aus mehreren Modellen ein besseres
Ergebnis als ein einzelnes Modell." Geprüft wird diese Behauptung nicht an der Infrastruktur,
sondern an der **Wahrheitsfindung**:

1. Schlägt jede Arbitrierungs-Lane den **stärksten Einzelkanal** (Accuracy) oder zeigt sie
   einen belegbaren **Enthaltungsvorteil** (Antwort nur, wenn tragfähig)?
2. Entsteht der Vorteil aus dem **Informationsgehalt** der Antworten oder aus
   **Anbieteridentität und manuell gesetzten Gewichten**?
3. Wie oft entsteht **falscher Konsens** (selbstsicher falsche Einigung)?
4. Wird eine **korrekte Minderheit** durch die Mehrheit unterdrückt?

Ausgangspunkt der Kritik: Die Kollapsregel vergleicht Antworten über Wortmengen (Jaccard) und
Satzstützung. Damit ist sie blind für Negation, Zahlenkonflikte, Entitätstausch, Kausaldrehung
und bedeutungsgleiche Umformulierungen mit geringer Wortüberschneidung. Genau dort setzt das
Korpus an.

## 2. Eingefrorenes Material

### 2.1 Korpus

`evaluation/corpus.json` — 24 Einträge, 8 Kategorien mit je 3 Einträgen:

| Kategorie | Prüfabsicht |
| --- | --- |
| `negation` | Negation im Text muss beachtet werden |
| `numeric` | Rechnen mit typischen Zahlenfehlern |
| `entity_swap` | ähnliche Entitäten, Vertauschung ändert die Wahrheit |
| `causal` | Kausalrichtung bzw. Nicht-Kausalität |
| `paraphrase` | bedeutungsgleich, geringe Wortüberschneidung |
| `false_premise` | Frage mit falscher Voraussetzung; richtige Antwort ist die Zurückweisung |
| `correct_minority` | Mehrheit irrt plausibel, Wahrheit ist eindeutig |
| `verbosity` | gleicher Inhalt, unterschiedliche Ausführlichkeit |

Jeder Eintrag enthält `id`, `category`, `prompt` (vollständig eigenständig, Passage enthalten),
`answer_type` (`number` | `entity` | `boolean`), `ground_truth` und `accepted` (zugelassene
Schreibweisen). Die Wahrheitswerte sind von Hand geprüft und eindeutig.

### 2.2 Kanäle

Vier Modelle aus unterschiedlichen Anbieterfamilien, festgelegt vor der Generierung:

| Kanal | Modell | Anbieter |
| --- | --- | --- |
| K1 | `gpt-5-mini` | OpenAI |
| K2 | `gpt-5.5` | OpenAI |
| K3 | `claude-haiku-4-5` | Anthropic |
| K4 | `gemini-3-flash-preview` | Google |

Anbieterungleichgewicht (2× OpenAI) wird im Bericht als Grenze benannt.

### 2.3 Antwortauftrag an die Kanäle (wörtlich, unverändert)

> Answer the question below as precisely as you can. Use only the information in the passage when
> a passage is given. End your reply with a final line in exactly this format:
> `ANSWER: <your short answer>`

Ohne Werkzeuge, ohne Zwischenschritte, Temperatur nicht gesetzt (Anbietervorgabe).

### 2.4 Auswertung der Antworten (deterministisch, ohne LLM)

- Zuerst die **letzte** Zeile der Form `ANSWER: …`; fehlt sie, wird der gesamte Text durchsucht.
- `number`: erste Zahl im Segment, Komma als Dezimaltrenner, Vergleich mit Toleranz 1e-6.
- `entity`: Kleinschreibung, Satzzeichen und Leerraum entfernt, Vergleich gegen `accepted`.
- `boolean`: ja/yes/y/true → wahr; nein/no/n/false → falsch; sonst nicht verwertbar.

Nicht verwertbare Antworten zählen als **Enthaltung** des Kanals (nicht als Fehler).

## 3. Die drei Arbitrierungs-Lanes

Alle Lanes sehen **dieselben eingefrorenen Kanalantworten**. Keine Lane sieht die Entscheidung
einer anderen. Nach Sichtung der Ergebnisse wird nichts nachjustiert.

- **Lane A — Konsens/Kollaps des geprüften Systems.** Aufruf von `server/synthesis.mjs` mit
  den eingefrorenen Texten, Regel `gewichtete-synthese`, Schwelle 0,10, Mindeststützung 2.
  Gewichte gleichverteilt (je 25 %). Bewertet wird `finalText`. Enthaltung, wenn der Status
  `leer` ist oder kein tragfähiger Satz das Ergebnis trägt.
- **Lane A′ — dieselbe Lane mit gesetzten Gewichten.** Vorab festgelegte Gewichte
  `{K1: 40, K2: 30, K3: 20, K4: 10}` (Erwartung nach Modellstärke/Preis, nicht nach Ergebnis).
  Zweck: Prüfung, ob das Ergebnis an manuell gesetzten Gewichten hängt.
- **Lane B — deterministische Regelarbitrierung.** Regeln **vor** Sichtung festgelegt:
  1. Jede Kanalantwort wird nach §2.4 in einen Wert überführt.
  2. Mehrheit = mindestens 3 von 4 gleichen Werten → dieser Wert.
  3. Bei 2:2 oder weniger als 3 verwertbaren Antworten → **Enthaltung** (kein Würfeln).
  4. Bei Kategorie `false_premise` gilt die Zurückweisung als eigener gültiger Wert.
- **Lane C — unabhängiger LLM-Richter.** Modell `claude-opus-4-7`, das in keiner Kanalrolle
  vorkommt. Der Richter erhält Frage und die vier Antworten **anonymisiert** als A–D in einer
  je Eintrag deterministisch permutierten Reihenfolge (Seed aus der Eintrags-ID). Keine
  Anbieternamen, keine Gewichte, kein Hinweis auf die Herkunft. Ausgabe als JSON-Schema:
  `{answer, confidence, abstain, rationale}`.

## 4. Metriken (je Lane getrennt)

- **Accuracy**: korrekte Werte / alle 24 Einträge.
- **Enthaltungsrate**: Enthaltungen / 24.
- **Abdeckung**: 1 − Enthaltungsrate.
- **Falschantwortrate**: falsche Werte / 24.
- **Falscher Konsens**: falsche Antwort trotz hoher Selbstsicherheit. Definition je Lane:
  A/A′ `metrics.confidence ≥ 0,70`; B einstimmige Mehrheit (4:0) und falsch; C
  `confidence ≥ 0,70` und falsch.
- **Minderheitenrettung**: unter den Einträgen, in denen die Kanalmehrheit falsch ist und
  mindestens ein Kanal richtig liegt, der Anteil, in dem die Lane den richtigen Wert ausgibt.
- **Reproduzierbarkeit**: Lane A, A′ und B zweimal auf denselben Eingaben ausgeführt;
  Lane C zweimal mit identischem Auftrag. Gemeldet wird die Übereinstimmungsrate der Werte.

Baseline: **stärkster Einzelkanal** (beste Accuracy der vier Kanäle), zusätzlich alle vier
Einzelwerte. Ein Verbund erhält keine Anerkennung für Umfang, sondern nur für Übertreffen der
stärksten Einzelstimme oder für einen belegbaren Enthaltungsvorteil.

## 5. Nulltests

- **N1 Identitätstausch**: Die Kanalantworten werden rotiert (Antwort von K1 wandert zu K2 usw.),
  also dieselben Texte unter fremder Identität. Lane A/A′ werden erneut ausgeführt. Wenn sich
  die Ergebnisse dadurch material ändern, hängt die Entscheidung an der Identität, nicht am Inhalt.
- **N2 Gewichtung**: Vergleich von A (gleich) mit A′ (gesetzt). Material verschieden ⇒ die
  Entscheidung hängt an manuell gesetzten Gewichten statt am Inhalt.
- **N3 Mehrdeutigkeit**: Ausgabe der Kanalantwortverteilung je Eintrag, damit sichtbar ist, ob
  ein „Konsens" überhaupt ein Konsens war.

## 6. Was ausdrücklich nicht behauptet wird

- Keine statistische Signifikanz bei n = 24; gemeldet werden Zählungen, keine p-Werte.
- Keine Aussage über echte Nutzerlast oder über andere Korpora als dieses eingefrorene.
- Keine Aussage über Modelle, die nicht Kanäle waren.
- Simulationen im Produkt (Anbieterausgaben, Demo-Tresor) bleiben Simulationen; dieses Experiment
  nutzt echte Modellausgaben und berührt die Produktsimulation nicht.

## 7. Abweichungsprotokoll

Abweichungen von dieser Anordnung werden unten eingetragen, mit Grund und Zeitstempel.

### D1 — Zusätzliche Messvariante für die Kollaps-Lanes (2026-10-03T23:55Z)

Grund: Der erste Lauf zeigte bei Lane A drei Fehlentscheidungen (21/24), die nicht aus der
Kollapslogik stammten, sondern aus der Messung. Die eingefrorene Regel „erste Zahl im Satz"
griff in der Ausgabe auf Metadaten wie `gpt-5-mini` zu und las daraus „-5". Zwei weitere Fälle
betrafen kurze Antwortzeilen.

Zusätzlich wurde beim Nachsehen ein echter Produktfehler gefunden: `splitSentences` verwarf
Sätze unter vier Wörtern — damit fiel die entscheidungstragende Zeile jeder Modellausgabe
(`ANSWER: 20.0 %`) aus der gesamten Konsensprüfung heraus, und der Kollaps trug die ähnlichste
Prosa statt der Entscheidung. Das Produkt wurde an dieser Stelle korrigiert; der Kollaps weist
seine Entscheidung nun selbst aus (`decision`-Feld und `Entscheidung:`-Zeile).

Folge für die Messung: Die eingefrorene Regel R1 wird unverändert weiterberichtet. Ergänzend
werden zwei Varianten ausgewiesen, die vor der Sichtung der Ergebnisse nicht absehbar waren:

- **R1b** liest die vom System ausgewiesene Entscheidungszeile — analog zu Lane B (Mehrheitswert)
  und Lane C (`answer`-Feld), die ihren Wert ebenfalls als Feld liefern.
- **R2** prüft, ob der richtige Wert im inhaltlichen Teil der Ausgabe vorkommt (Metadatenzeilen
  ausgenommen).

Alle drei Varianten werden für den Zustand vor und nach der Korrektur berichtet. Regeln,
Schwellen, Korpus, Kanäle und Richtermodell wurden nicht verändert; die eingefrorenen
Kanalantworten blieben unangetastet. Es wurde nichts gelöscht: Vorlauf (`results-before-fix.json`)
und Nachlauf (`results.json`) liegen beide im Repository.
