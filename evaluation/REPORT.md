# Arbitrierungs-Vergleich — Ergebnisbericht

Ausgewertet: 2026-10-03T23:56:53.415Z

Eingefrorene Prüfsummen (Anordnung und Material wurden nach Sichtung der Ergebnisse nicht verändert):

```json
{
  "preregistration": "1862853104051d7a03d6abc1c8188e31d39574575617f2bebbff845cedfca5cb",
  "corpus": "76f45f840c134a43249b6f272b1a7d8592c6e5528d9c6d18b5a7fbb4fbd14445",
  "channelOutputs": "be2e7be385329656278d62e08833f6986c6ea70054d760aec6db475e63cd7138",
  "judgeRuns": "eccf3a36645b0a5d5be0e7f504fd6a2b4e10b2878c521fddeea8abbb31e66afa"
}
```

## 1. Ergebnis je Arbitrierungs-Lane

| Lane | Korrekt | Accuracy | Enthaltungen | Falsch | Falscher Konsens |
| --- | --- | --- | --- | --- | --- |
| Lane A — Konsens/Kollaps (gleiche Gewichte) | 24/24 | 100.0 % | 0 | 0 | — |
| Lane A′ — Konsens/Kollaps (gesetzte Gewichte) | 24/24 | 100.0 % | 0 | 0 | — |
| Lane B — deterministische Regeln | 24/24 | 100.0 % | 0 | 0 | — |
| Lane C — unabhängiger LLM-Richter | 24/24 | 100.0 % | 0 | 0 | — |
| Beste Einzelstimme — K1 (gpt-5-mini) (Baseline) | 24/24 | 100.0 % | 0 | 0 | — |

## 2. Einzelkanäle (Baseline im Detail)

| Kanal | Modell | Anbieter | Korrekt | Accuracy | Enthaltungen | Falsch |
| --- | --- | --- | --- | --- | --- | --- |
| K1 | gpt-5-mini | openai | 24/24 | 100.0 % | 0 | 0 |
| K2 | gpt-5.5 | openai | 24/24 | 100.0 % | 0 | 0 |
| K3 | claude-haiku-4-5 | anthropic | 24/24 | 100.0 % | 0 | 0 |
| K4 | gemini-3-flash-preview | google | 23/24 | 95.8 % | 0 | 1 |

## 3. Minderheitenrettung

## 2b. Messvarianten für die Kollaps-Lanes

Die eingefrorene Regel (R1) liest den gesamten Ausgabetext. Weil die Kollaps-Ausgabe
zwischenzeitlich ihre Entscheidung selbst ausweist, wird zusätzlich die ausgewiesene
Entscheidungszeile (R1b) und das Enthaltensein des richtigen Werts im inhaltlichen Teil (R2)
gemessen. Diese Erweiterung ist als Abweichung D1 im Bericht protokolliert.

| Messvariante | Lane A | Lane A′ |
| --- | --- | --- |
| R1 eingefrorene Regel | 24/24 | 24/24 |
| R1b ausgewiesene Entscheidung | 24/24 | 24/24 |
| R2 Enthaltensein | 24/24 | 24/24 |

## 3. Minderheitenrettung

Einträge, in denen die Kanalmehrheit falsch liegt und mindestens ein Kanal richtig (0 Fälle: ):

| Lane | gerettet |
| --- | --- |
| A (gleiche Gewichte) | 0/0 |
| A′ (gesetzte Gewichte) | 0/0 |
| B (Regeln) | 0/0 |
| C (Richter) | 0/0 |

## 4. Kategorien

| Kategorie | Einträge | Kanäle korrekt | Lane A | Lane B | Lane C |
| --- | --- | --- | --- | --- | --- |
| negation | 3 | 12/12 | 3/3 | 3/3 | 3/3 |
| numeric | 3 | 11/12 | 3/3 | 3/3 | 3/3 |
| entity_swap | 3 | 12/12 | 3/3 | 3/3 | 3/3 |
| causal | 3 | 12/12 | 3/3 | 3/3 | 3/3 |
| paraphrase | 3 | 12/12 | 3/3 | 3/3 | 3/3 |
| false_premise | 3 | 12/12 | 3/3 | 3/3 | 3/3 |
| correct_minority | 3 | 12/12 | 3/3 | 3/3 | 3/3 |
| verbosity | 3 | 12/12 | 3/3 | 3/3 | 3/3 |

## 5. Reproduzierbarkeit

```json
{
  "laneA_runsIdentical": 1,
  "laneB_runsIdentical": 1,
  "laneC_runsAgreement": 1
}
```

## 6. Nulltests

```json
{
  "N1_identityChangeRate_A": 0,
  "N1_identityChangeRate_AStated": 0,
  "N2_weightChangeRate": 0,
  "N3_majoritySize": {
    "NEG-1": 4,
    "NEG-2": 4,
    "NEG-3": 4,
    "NUM-1": 3,
    "NUM-2": 4,
    "NUM-3": 4,
    "ENT-1": 4,
    "ENT-2": 4,
    "ENT-3": 4,
    "CAU-1": 4,
    "CAU-2": 4,
    "CAU-3": 4,
    "PAR-1": 4,
    "PAR-2": 4,
    "PAR-3": 4,
    "FAL-1": 4,
    "FAL-2": 4,
    "FAL-3": 4,
    "MIN-1": 4,
    "MIN-2": 4,
    "MIN-3": 4,
    "VRB-1": 4,
    "VRB-2": 4,
    "VRB-3": 4
  }
}
```

## 7. Wirkung der Korrektur

Zwischen Vorlauf und Nachlauf wurden nur zwei Dinge geändert: Der Satzfilter behält
entscheidungstragende Zeilen, und der Kollaps weist seine Entscheidung selbst aus. Weder
Korpus noch Kanalantworten, Schwellen, Gewichte oder Lanes wurden berührt.

| Stand | Lane A (R1) | Lane A′ (R1) | Lane B | Lane C |
| --- | --- | --- | --- | --- |
| vor der Korrektur | 21/24 | 20/24 | 24/24 | 24/24 |
| nach der Korrektur | 24/24 | 24/24 | 24/24 | 24/24 |

Die Fehlentscheidungen des Vorlaufs lagen ausschließlich in Einträgen, in denen **alle**
Kanäle richtig lagen: Der Verbund war vor der Korrektur schlechter als seine schwächste
Einzelstimme. Nach der Korrektur stimmt die Entscheidung mit der Kanalmehrheit überein.

## 8. Auswertung und Grenzen


**1. Kein Verbundvorteil nachweisbar.** Nach der Korrektur liegen alle vier Lanes bei
24/24; die stärkste Einzelstimme ebenfalls. Ein Vorteil des Verbunds ist mit diesem
Material nicht belegbar — die Kanäle lösten die Fallen nahezu vollständig selbst.
Damit ist die eingangs geprüfte Behauptung („mehrere Modelle sind besser als eines")
**nicht bestätigt**, aber auch nicht widerlegt: Sie war mit diesem Korpus nicht prüfbar.

**2. Der messbare Effekt lag im Verbund selbst.** Vor der Korrektur verlor der Kollaps
3–4 von 24 Fällen, in denen alle vier Kanäle korrekt geantwortet hatten. Ursache war
kein Modellfehler, sondern die Auswahlregel: kurze Antwortzeilen wurden verworfen, die
ähnlichste Prosa blieb. Das ist genau das Muster „naiver Konsens belohnt Ähnlichkeit
statt Richtigkeit" — hier belegt an einem reproduzierbaren Fall.

**3. Kein Einfluss von Identität oder Gewichten.** Der Identitätstausch der Kanäle ändert
kein Ergebnis (Änderungsrate 0); gesetzte Gewichte ändern
kein Ergebnis (0). Die Entscheidung hängt am Inhalt der
Antwortzeilen, nicht an Anbieternamen oder manueller Gewichtung.

**4. Kein Fall für Minderheitenrettung, keine Enthaltung.** In keinem Eintrag lag die
Kanalmehrheit falsch; alle Lanes antworteten immer. Damit ist weder die Fähigkeit, eine
korrekte Minderheit durchzusetzen, noch die Fähigkeit, sich zu enthalten, geprüft.
Das Korpus war für die Kanäle zu leicht und erzeugt kein echter Streit.

**5. Was fehlt, um die Behauptung wirklich zu prüfen.** Notwendig wären (a) ein Korpus, das
die Kanäle tatsächlich spaltet, (b) Kanäle mit dokumentiert unterschiedlicher Stärke oder
bewusst geschwächte Kanäle, (c) Einträge, in denen die Mehrheit irrt und die Minderheit
recht hat, (d) eine belastbare Zuversichtssemantik je Lane für die Messung falschen
Konsenses. Erst dann sind Falschkonsensrate und Minderheitenrettung aussagekräftig.

**6. Anbieterungleichgewicht.** Zwei der vier Kanäle stammen von OpenAI. Die Kritik an
korrelierten Fehlern durch ähnliches Training lässt sich mit diesem Aufbau nur eingeschränkt
prüfen.

## 9. Einzelwerte

| Eintrag | Kategorie | Wahrheit | K1 | K2 | K3 | K4 | A | A′ | B | C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NEG-1 | negation | no | no | no | no | no | no | no | no | no |
| NEG-2 | negation | A | a | a | a | a | a | a | a | a |
| NEG-3 | negation | no | no | no | no | no | no | no | no | no |
| NUM-1 | numeric | 20 | 20 | 20 | 20 | 100 | 20 | 20 | 20 | 20 |
| NUM-2 | numeric | 126 | 126 | 126 | 126 | 126 | 126 | 126 | 126 | 126 |
| NUM-3 | numeric | 1020 | 1020 | 1020 | 1020 | 1020 | 1020 | 1020 | 1020 | 1020 |
| ENT-1 | entity_swap | 2018 | 2018 | 2018 | 2018 | 2018 | 2018 | 2018 | 2018 | 2018 |
| ENT-2 | entity_swap | Stockholm | stockholm | stockholm | stockholm | stockholm | stockholm | stockholm | stockholm | stockholm |
| ENT-3 | entity_swap | B | b | b | b | b | b | b | b | b |
| CAU-1 | causal | no | no | no | no | no | no | no | no | no |
| CAU-2 | causal | no | no | no | no | no | no | no | no | no |
| CAU-3 | causal | no | no | no | no | no | no | no | no | no |
| PAR-1 | paraphrase | Canberra | canberra | canberra | canberra | canberra | canberra | canberra | canberra | canberra |
| PAR-2 | paraphrase | 210 | 210 | 210 | 210 | 210 | 210 | 210 | 210 | 210 |
| PAR-3 | paraphrase | Mercury | mercury | mercury | mercury | mercury | mercury | mercury | mercury | mercury |
| FAL-1 | false_premise | none | none | none | none | none | none | none | none | none |
| FAL-2 | false_premise | none | none | none | none | none | none | none | none | none |
| FAL-3 | false_premise | none | none | none | none | none | none | none | none | none |
| MIN-1 | correct_minority | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| MIN-2 | correct_minority | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| MIN-3 | correct_minority | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| VRB-1 | verbosity | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 |
| VRB-2 | verbosity | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| VRB-3 | verbosity | nitrogen | nitrogen | nitrogen | nitrogen | nitrogen | nitrogen | nitrogen | nitrogen | nitrogen |
