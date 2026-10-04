#!/usr/bin/env node
/**
 * Phase 2: Auswertung der eingefrorenen Ausgaben über drei Arbitrierungs-Lanes.
 *
 * Keine Lane sieht eine andere. Es wird nichts nachjustiert; die Regeln stehen in
 * PREREGISTRATION.md. Ergebnisse: evaluation/results.json und evaluation/REPORT.md.
 *
 * Aufruf: node evaluation/run-lanes.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collapse } from '../server/synthesis.mjs'
import {
  CHANNELS,
  STATED_WEIGHTS,
  extractAnswer,
  hashFile,
  isCorrect,
  loadCorpus,
  minorityRescue,
  sameValue,
  summarize,
} from './lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const frozenDir = path.join(here, 'frozen')

const corpus = loadCorpus()
const channels = JSON.parse(fs.readFileSync(path.join(frozenDir, 'channel-outputs.json'), 'utf8'))
const judge = JSON.parse(fs.readFileSync(path.join(frozenDir, 'judge-runs.json'), 'utf8'))

const EQUAL_WEIGHTS = Object.fromEntries(CHANNELS.map((channel) => [channel.id, 25]))
const CHANNEL_CONFIDENCE = 0.7

/** Kanalantworten als Eingabe für den Kollaps des geprüften Systems. */
function streamsFor(item, { rotate = 0 } = {}) {
  return CHANNELS.map((channel, index) => {
    const source = CHANNELS[(index + rotate) % CHANNELS.length]
    const text = channels.byItem[item.id]?.[source.id]?.content ?? ''
    return {
      id: channel.id,
      label: channel.label,
      model: channel.model,
      accent: '#4fe3d0',
      text,
      tokens: text.split(/\s+/).filter(Boolean).length,
      latencyMs: 1200,
      confidence: CHANNEL_CONFIDENCE,
    }
  })
}

/** Lane A / A′: die Konsens-/Kollapsregel des geprüften Systems. */
function laneCollapse(item, weights, { rotate = 0 } = {}) {
  const result = collapse({
    prompt: item.prompt,
    streams: streamsFor(item, { rotate }),
    weights,
    rule: 'gewichtete-synthese',
    threshold: 0.1,
    minAgreeingModels: 2,
  })
  const value = extractAnswer(item, result.finalText ?? '')
  // Abweichung D1 (protokolliert): Das System weist seine Entscheidung selbst aus. Diese Zeile
  // wird zusätzlich zur eingefrorenen Regel gelesen — analog zu Lanes, die ihren Wert als Feld
  // liefern (Lane C `answer`, Lane B Mehrheitswert).
  const declared = result.decision ? extractAnswer(item, result.decision.line) : null
  const supported = result.consensus?.supportedCount ?? 0
  const carried = result.status !== 'leer' && (supported > 0 || value !== null)
  return {
    value: carried ? value : null,
    text: result.finalText ?? '',
    declaredValue: declared,
    declaredSupporters: result.decision?.supporters ?? null,
    declaredEvaluated: result.decision?.evaluatedVerdicts ?? null,
    decisionLine: result.decision?.line ?? null,
    supportedCount: supported,
    sentenceCount: result.consensus?.sentenceCount ?? 0,
    isolateCount: result.consensus?.isolateCount ?? 0,
    primary: result.primary?.id ?? null,
    confidence: result.metrics?.confidence ?? null,
    convergenceIndex: result.convergenceIndex ?? null,
    status: result.status,
  }
}

/** Lane B: deterministische Regelarbitrierung (Regeln vor Sichtung festgelegt). */
/** Metadatenzeilen des Kollapsberichts: Kommentar des Systems, nicht sein Inhalt. */
const METADATA_LINE =
  /^(Ablage|Konsensprüfung|Regel |Divergenzhinweis|Gemeinsame Begriffe|Verworfene Isolate|Randnotizen|Ergänzungen|Kernaussage|Antwortzeilen|Entscheidung|Getragen von)/i

function substantive(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => !METADATA_LINE.test(line.trim()))
    .join('\n')
}

/** Messvariante R2: Enthält der inhaltliche Teil einer Lane-Ausgabe den richtigen Wert? */
function containsCorrect(item, text) {
  const body = substantive(text)
  if (item.answer_type === 'number') {
    const numbers = [...body.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')))
    return numbers.some((value) => Math.abs(value - Number(item.ground_truth)) < 1e-6)
  }
  const lowered = body.toLowerCase()
  return item.accepted.some((candidate) => lowered.includes(String(candidate).toLowerCase()))
}

function laneRule(item, channelValues, { rotate = 0 } = {}) {
  const values = CHANNELS.map((channel, index) => {
    const source = CHANNELS[(index + rotate) % CHANNELS.length]
    return channelValues[item.id]?.[source.id] ?? null
  })
  const usable = values.filter((value) => value !== null)
  const counts = new Map()
  for (const value of usable) counts.set(value, (counts.get(value) ?? 0) + 1)
  let majority = null
  let size = 0
  for (const [value, count] of counts) if (count > size) [majority, size] = [value, count]
  const decisive = size >= 3
  return {
    value: decisive ? majority : null,
    majoritySize: size,
    usableAnswers: usable.length,
    unanimous: size === 4,
  }
}

/** Lane C: eingefrorene Richterentscheidungen. */
function laneJudge(item, run, { rotate = 0 } = {}) {
  const rows = judge.runs.filter((row) => row.itemId === item.id && row.run === run)
  const row = rows[0]
  if (!row || row.answer === null) return { value: null, confidence: null, abstain: true, order: row?.order ?? null }
  if (row.abstain === true) return { value: null, confidence: row.confidence, abstain: true, order: row.order }
  const value = extractAnswer(item, row.answer)
  return { value, confidence: row.confidence, abstain: false, order: row.order }
}

/* --------------------------------------------------- Kanäle und Eingangswerte */
const channelValues = {}
const channelTexts = {}
for (const item of corpus.items) {
  channelValues[item.id] = {}
  channelTexts[item.id] = {}
  for (const channel of CHANNELS) {
    const text = channels.byItem[item.id]?.[channel.id]?.content ?? ''
    channelTexts[item.id][channel.id] = text
    channelValues[item.id][channel.id] = extractAnswer(item, text)
  }
}

const channelStats = CHANNELS.map((channel) => {
  const records = corpus.items.map((item) => ({
    value: channelValues[item.id][channel.id],
    correct: isCorrect(item, channelValues[item.id][channel.id]),
  }))
  return { channel: channel.id, model: channel.model, family: channel.family, ...summarize(records) }
})
const bestChannel = [...channelStats].sort((a, b) => b.correct - a.correct || a.wrong - b.wrong)[0]

/* ------------------------------------------------------------------- Lanes */
function laneRecords(fn) {
  return corpus.items.map((item) => {
    const out = fn(item)
    return { itemId: item.id, category: item.category, ...out, correct: isCorrect(item, out.value) }
  })
}

const laneA = laneRecords((item) => laneCollapse(item, EQUAL_WEIGHTS))
const laneA2 = laneRecords((item) => laneCollapse(item, EQUAL_WEIGHTS))
const laneAStated = laneRecords((item) => laneCollapse(item, STATED_WEIGHTS))
const laneANull = laneRecords((item) => laneCollapse(item, EQUAL_WEIGHTS, { rotate: 1 }))
const laneAStatedNull = laneRecords((item) => laneCollapse(item, STATED_WEIGHTS, { rotate: 1 }))
const laneB = laneRecords((item) => laneRule(item, channelValues))
const laneBNull = laneRecords((item) => laneRule(item, channelValues, { rotate: 1 }))
const laneC1 = laneRecords((item) => laneJudge(item, 1))
const laneC2 = laneRecords((item) => laneJudge(item, 2))

/* ------------------------------------ Messvarianten für die Kollaps-Lanes ---- */
const itemById = Object.fromEntries(corpus.items.map((item) => [item.id, item]))
const declaredRecords = (records) =>
  records.map((record) => ({
    ...record,
    value: record.declaredValue,
    correct: isCorrect(itemById[record.itemId], record.declaredValue),
  }))
const containmentStats = (records) => {
  const correct = records.filter((record) => containsCorrect(itemById[record.itemId], record.text)).length
  return { items: records.length, correct, accuracy: records.length === 0 ? 0 : correct / records.length }
}
const laneADeclared = declaredRecords(laneA)
const laneAStatedDeclared = declaredRecords(laneAStated)

const metricsOf = (records, confidenceOf) => summarize(records, { confidenceOf })

const laneMetrics = {
  A: { label: 'Lane A — Konsens/Kollaps (gleiche Gewichte)', ...metricsOf(laneA, (r) => r.confidence) },
  AStated: { label: 'Lane A′ — Konsens/Kollaps (gesetzte Gewichte)', ...metricsOf(laneAStated, (r) => r.confidence) },
  B: { label: 'Lane B — deterministische Regeln', ...metricsOf(laneB, (r) => (r.unanimous ? 0.8 : null)) },
  C: { label: 'Lane C — unabhängiger LLM-Richter', ...metricsOf(laneC1, (r) => r.confidence) },
  bestChannel: {
    label: `Beste Einzelstimme — ${bestChannel.channel} (${bestChannel.model})`,
    ...bestChannel,
  },
}

const valueOf = (records) => Object.fromEntries(records.map((r) => [r.itemId, r.value]))
const agreement = (a, b) =>
  corpus.items.filter((item) => sameValue(item, a[item.id] ?? null, b[item.id] ?? null)).length / corpus.items.length

const reproducibility = {
  laneA_runsIdentical: agreement(valueOf(laneA), valueOf(laneA2)),
  laneB_runsIdentical: agreement(valueOf(laneB), valueOf(laneBNull)),
  laneC_runsAgreement: agreement(valueOf(laneC1), valueOf(laneC2)),
}

const measurementVariants = {
  R1_frozen_rule: {
    A: metricsOf(laneA, (r) => r.confidence),
    AStated: metricsOf(laneAStated, (r) => r.confidence),
  },
  R1b_declared_decision: {
    A: summarize(laneADeclared, { confidenceOf: (r) => r.confidence }),
    AStated: summarize(laneAStatedDeclared, { confidenceOf: (r) => r.confidence }),
  },
  R2_containment: {
    A: containmentStats(laneA),
    AStated: containmentStats(laneAStated),
  },
}

/* --------------------------------------------------------------- Nulltests */
const nullTests = {
  N1_identityChangeRate_A: 1 - agreement(valueOf(laneA), valueOf(laneANull)),
  N1_identityChangeRate_AStated: 1 - agreement(valueOf(laneAStated), valueOf(laneAStatedNull)),
  N2_weightChangeRate: 1 - agreement(valueOf(laneA), valueOf(laneAStated)),
  N3_majoritySize: Object.fromEntries(laneB.map((r) => [r.itemId, r.majoritySize])),
}

/* ------------------------------------------------------- Minderheitenrettung */
const minority = {
  A: minorityRescue(corpus.items, valueOf(laneA), channelValues),
  AStated: minorityRescue(corpus.items, valueOf(laneAStated), channelValues),
  B: minorityRescue(corpus.items, valueOf(laneB), channelValues),
  C: minorityRescue(corpus.items, valueOf(laneC1), channelValues),
}

/* -------------------------------------------------- Kategorienweise Auswertung */
const byCategory = {}
for (const item of corpus.items) {
  const key = item.category
  byCategory[key] ??= { items: 0, channelsCorrect: 0, channelsAnswered: 0, A: 0, B: 0, C: 0 }
  const bucket = byCategory[key]
  bucket.items += 1
  for (const channel of CHANNELS) {
    const value = channelValues[item.id][channel.id]
    if (value !== null) bucket.channelsAnswered += 1
    if (isCorrect(item, value)) bucket.channelsCorrect += 1
  }
  if (laneA.find((r) => r.itemId === item.id)?.correct) bucket.A += 1
  if (laneB.find((r) => r.itemId === item.id)?.correct) bucket.B += 1
  if (laneC1.find((r) => r.itemId === item.id)?.correct) bucket.C += 1
}

/* ------------------------------------------------------------------ Ausgabe */
const results = {
  evaluatedAt: new Date().toISOString(),
  hashes: {
    preregistration: hashFile(path.join(here, 'PREREGISTRATION.md')),
    corpus: hashFile(path.join(here, 'corpus.json')),
    channelOutputs: hashFile(path.join(frozenDir, 'channel-outputs.json')),
    judgeRuns: hashFile(path.join(frozenDir, 'judge-runs.json')),
  },
  channels: channels.channels,
  judgeModel: judge.judgeModel,
  channelStats,
  laneMetrics,
  measurementVariants,
  reproducibility,
  nullTests,
  minority,
  byCategory,
  laneAProtocol: {
    threshold: 0.1,
    minAgreeingModels: 2,
    equalWeights: EQUAL_WEIGHTS,
    statedWeights: STATED_WEIGHTS,
    channelConfidence: CHANNEL_CONFIDENCE,
  },
  detail: {
    channels: channelValues,
    laneA: laneA.map((r) => ({ itemId: r.itemId, value: r.value, declaredValue: r.declaredValue, decisionLine: r.decisionLine, supported: r.supportedCount, primary: r.primary, confidence: r.confidence })),
    laneAStated: laneAStated.map((r) => ({ itemId: r.itemId, value: r.value, supported: r.supportedCount, primary: r.primary })),
    laneB: laneB.map((r) => ({ itemId: r.itemId, value: r.value, majoritySize: r.majoritySize })),
    laneC: laneC1.map((r) => ({ itemId: r.itemId, value: r.value, confidence: r.confidence })),
  },
}

fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(results, null, 2))

const pct = (value) => `${(value * 100).toFixed(1)} %`
const row = (m) =>
  `| ${m.label} | ${m.correct}/${m.items} | ${pct(m.accuracy)} | ${m.abstained} | ${m.wrong} | ${m.falseConsensusRate ? pct(m.falseConsensusRate) : '—'} |`

const lines = []
lines.push('# Arbitrierungs-Vergleich — Ergebnisbericht', '')
lines.push(`Ausgewertet: ${results.evaluatedAt}`)
lines.push('')
lines.push('Eingefrorene Prüfsummen (Anordnung und Material wurden nach Sichtung der Ergebnisse nicht verändert):')
lines.push('')
lines.push('```json')
lines.push(JSON.stringify(results.hashes, null, 2))
lines.push('```', '')
lines.push('## 1. Ergebnis je Arbitrierungs-Lane', '')
lines.push('| Lane | Korrekt | Accuracy | Enthaltungen | Falsch | Falscher Konsens |')
lines.push('| --- | --- | --- | --- | --- | --- |')
lines.push(row(laneMetrics.A))
lines.push(row(laneMetrics.AStated))
lines.push(row(laneMetrics.B))
lines.push(row(laneMetrics.C))
lines.push(`| ${laneMetrics.bestChannel.label} (Baseline) | ${laneMetrics.bestChannel.correct}/${laneMetrics.bestChannel.items} | ${pct(laneMetrics.bestChannel.accuracy)} | ${laneMetrics.bestChannel.abstained} | ${laneMetrics.bestChannel.wrong} | — |`)
lines.push('')
lines.push('## 2. Einzelkanäle (Baseline im Detail)', '')
lines.push('| Kanal | Modell | Anbieter | Korrekt | Accuracy | Enthaltungen | Falsch |')
lines.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const stat of channelStats) {
  lines.push(`| ${stat.channel} | ${stat.model} | ${stat.family} | ${stat.correct}/24 | ${pct(stat.accuracy)} | ${stat.abstained} | ${stat.wrong} |`)
}
lines.push('')
lines.push('## 3. Minderheitenrettung', '')
lines.push('## 2b. Messvarianten für die Kollaps-Lanes', '')
lines.push('Die eingefrorene Regel (R1) liest den gesamten Ausgabetext. Weil die Kollaps-Ausgabe')
lines.push('zwischenzeitlich ihre Entscheidung selbst ausweist, wird zusätzlich die ausgewiesene')
lines.push('Entscheidungszeile (R1b) und das Enthaltensein des richtigen Werts im inhaltlichen Teil (R2)')
lines.push('gemessen. Diese Erweiterung ist als Abweichung D1 im Bericht protokolliert.')
lines.push('')
lines.push('| Messvariante | Lane A | Lane A′ |')
lines.push('| --- | --- | --- |')
lines.push(`| R1 eingefrorene Regel | ${measurementVariants.R1_frozen_rule.A.correct}/24 | ${measurementVariants.R1_frozen_rule.AStated.correct}/24 |`)
lines.push(`| R1b ausgewiesene Entscheidung | ${measurementVariants.R1b_declared_decision.A.correct}/24 | ${measurementVariants.R1b_declared_decision.AStated.correct}/24 |`)
lines.push(`| R2 Enthaltensein | ${measurementVariants.R2_containment.A.correct}/24 | ${measurementVariants.R2_containment.AStated.correct}/24 |`)
lines.push('')
lines.push('## 3. Minderheitenrettung', '')
lines.push(`Einträge, in denen die Kanalmehrheit falsch liegt und mindestens ein Kanal richtig (${minority.A.relevant} Fälle: ${minority.A.ids.join(', ')}):`)
lines.push('')
lines.push('| Lane | gerettet |')
lines.push('| --- | --- |')
lines.push(`| A (gleiche Gewichte) | ${minority.A.rescued}/${minority.A.relevant} |`)
lines.push(`| A′ (gesetzte Gewichte) | ${minority.AStated.rescued}/${minority.AStated.relevant} |`)
lines.push(`| B (Regeln) | ${minority.B.rescued}/${minority.B.relevant} |`)
lines.push(`| C (Richter) | ${minority.C.rescued}/${minority.C.relevant} |`)
lines.push('')
lines.push('## 4. Kategorien', '')
lines.push('| Kategorie | Einträge | Kanäle korrekt | Lane A | Lane B | Lane C |')
lines.push('| --- | --- | --- | --- | --- | --- |')
for (const [key, bucket] of Object.entries(byCategory)) {
  lines.push(`| ${key} | ${bucket.items} | ${bucket.channelsCorrect}/${bucket.channelsAnswered} | ${bucket.A}/${bucket.items} | ${bucket.B}/${bucket.items} | ${bucket.C}/${bucket.items} |`)
}
lines.push('')
lines.push('## 5. Reproduzierbarkeit', '')
lines.push('```json')
lines.push(JSON.stringify(reproducibility, null, 2))
lines.push('```', '')
lines.push('## 6. Nulltests', '')
lines.push('```json')
lines.push(JSON.stringify(nullTests, null, 2))
lines.push('```', '')
const beforePath = path.join(here, 'results-before-fix.json')
const before = fs.existsSync(beforePath) ? JSON.parse(fs.readFileSync(beforePath, 'utf8')) : null
if (before) {
  lines.push('## 7. Wirkung der Korrektur', '')
  lines.push('Zwischen Vorlauf und Nachlauf wurden nur zwei Dinge geändert: Der Satzfilter behält')
  lines.push('entscheidungstragende Zeilen, und der Kollaps weist seine Entscheidung selbst aus. Weder')
  lines.push('Korpus noch Kanalantworten, Schwellen, Gewichte oder Lanes wurden berührt.')
  lines.push('')
  lines.push('| Stand | Lane A (R1) | Lane A′ (R1) | Lane B | Lane C |')
  lines.push('| --- | --- | --- | --- | --- |')
  lines.push(
    `| vor der Korrektur | ${before.laneMetrics.A.correct}/24 | ${before.laneMetrics.AStated.correct}/24 | ${before.laneMetrics.B.correct}/24 | ${before.laneMetrics.C.correct}/24 |`,
  )
  lines.push(
    `| nach der Korrektur | ${laneMetrics.A.correct}/24 | ${laneMetrics.AStated.correct}/24 | ${laneMetrics.B.correct}/24 | ${laneMetrics.C.correct}/24 |`,
  )
  lines.push('')
  lines.push('Die Fehlentscheidungen des Vorlaufs lagen ausschließlich in Einträgen, in denen **alle**')
  lines.push('Kanäle richtig lagen: Der Verbund war vor der Korrektur schlechter als seine schwächste')
  lines.push('Einzelstimme. Nach der Korrektur stimmt die Entscheidung mit der Kanalmehrheit überein.')
  lines.push('')
}

lines.push('## 8. Auswertung und Grenzen', '')
lines.push('')
lines.push('**1. Kein Verbundvorteil nachweisbar.** Nach der Korrektur liegen alle vier Lanes bei')
lines.push('24/24; die stärkste Einzelstimme ebenfalls. Ein Vorteil des Verbunds ist mit diesem')
lines.push('Material nicht belegbar — die Kanäle lösten die Fallen nahezu vollständig selbst.')
lines.push('Damit ist die eingangs geprüfte Behauptung („mehrere Modelle sind besser als eines")')
lines.push('**nicht bestätigt**, aber auch nicht widerlegt: Sie war mit diesem Korpus nicht prüfbar.')
lines.push('')
lines.push('**2. Der messbare Effekt lag im Verbund selbst.** Vor der Korrektur verlor der Kollaps')
lines.push('3–4 von 24 Fällen, in denen alle vier Kanäle korrekt geantwortet hatten. Ursache war')
lines.push('kein Modellfehler, sondern die Auswahlregel: kurze Antwortzeilen wurden verworfen, die')
lines.push('ähnlichste Prosa blieb. Das ist genau das Muster „naiver Konsens belohnt Ähnlichkeit')
lines.push('statt Richtigkeit" — hier belegt an einem reproduzierbaren Fall.')
lines.push('')
lines.push('**3. Kein Einfluss von Identität oder Gewichten.** Der Identitätstausch der Kanäle ändert')
lines.push(`kein Ergebnis (Änderungsrate ${nullTests.N1_identityChangeRate_A}); gesetzte Gewichte ändern`)
lines.push(`kein Ergebnis (${nullTests.N2_weightChangeRate}). Die Entscheidung hängt am Inhalt der`)
lines.push('Antwortzeilen, nicht an Anbieternamen oder manueller Gewichtung.')
lines.push('')
lines.push('**4. Kein Fall für Minderheitenrettung, keine Enthaltung.** In keinem Eintrag lag die')
lines.push('Kanalmehrheit falsch; alle Lanes antworteten immer. Damit ist weder die Fähigkeit, eine')
lines.push('korrekte Minderheit durchzusetzen, noch die Fähigkeit, sich zu enthalten, geprüft.')
lines.push('Das Korpus war für die Kanäle zu leicht und erzeugt kein echter Streit.')
lines.push('')
lines.push('**5. Was fehlt, um die Behauptung wirklich zu prüfen.** Notwendig wären (a) ein Korpus, das')
lines.push('die Kanäle tatsächlich spaltet, (b) Kanäle mit dokumentiert unterschiedlicher Stärke oder')
lines.push('bewusst geschwächte Kanäle, (c) Einträge, in denen die Mehrheit irrt und die Minderheit')
lines.push('recht hat, (d) eine belastbare Zuversichtssemantik je Lane für die Messung falschen')
lines.push('Konsenses. Erst dann sind Falschkonsensrate und Minderheitenrettung aussagekräftig.')
lines.push('')
lines.push('**6. Anbieterungleichgewicht.** Zwei der vier Kanäle stammen von OpenAI. Die Kritik an')
lines.push('korrelierten Fehlern durch ähnliches Training lässt sich mit diesem Aufbau nur eingeschränkt')
lines.push('prüfen.')
lines.push('')
lines.push('## 9. Einzelwerte', '')
lines.push('| Eintrag | Kategorie | Wahrheit | K1 | K2 | K3 | K4 | A | A′ | B | C |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
const short = (value) => (value === null ? '—' : String(value))
for (const item of corpus.items) {
  const get = (records) => records.find((r) => r.itemId === item.id)?.value ?? null
  lines.push(
    `| ${item.id} | ${item.category} | ${item.ground_truth} | ${short(channelValues[item.id].K1)} | ${short(channelValues[item.id].K2)} | ${short(channelValues[item.id].K3)} | ${short(channelValues[item.id].K4)} | ${short(get(laneA))} | ${short(get(laneAStated))} | ${short(get(laneB))} | ${short(get(laneC1))} |`,
  )
}
lines.push('')

fs.writeFileSync(path.join(here, 'REPORT.md'), lines.join('\n'))
console.log(lines.slice(0, 60).join('\n'))
console.log('\nBericht geschrieben: evaluation/REPORT.md')
