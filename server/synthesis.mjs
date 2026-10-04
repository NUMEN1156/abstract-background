import { keywords, leadSentences } from './providers.mjs'
import { buildCoherenceMatrix, coherencePairs, meanPairwiseCoherence } from './coherence.mjs'
import {
  analyseSentenceSupport,
  clampMinAgreeing,
  clampThreshold,
  firstVerdictLine,
  normalizeVerdict,
  summarizeConsensus,
} from './consensus.mjs'

/**
 * Kollaps: führt die gewichteten Modellausgaben zu einem finalen Ergebnis zusammen.
 *
 * Der Algorithmus verändert die Einzeltexte nicht. Er bestimmt einen Träger, ordnet
 * Ergänzungen und Randnotizen zu, berechnet Kohärenz- und Konvergenzmaße und legt für
 * jeden Schritt ein nachvollziehbares Protokoll an. Drei Kollapsregeln stehen zur Wahl.
 *
 * Zusätzlich läuft über alle Ausgaben eine satzweite Konsensprüfung (`consensus.mjs`): Eine
 * Aussage trägt das Ergebnis nur, wenn sie die konfigurierbare Jaccard-Schwelle gegenüber
 * mindestens `minAgreeingModels − 1` anderen Modellen erreicht. Alles andere wird zum Isolat,
 * verliert seinen Einfluss auf das Ergebnis und wird im Protokoll einzeln ausgewiesen.
 */

const DEFAULT_SUPPORT_THRESHOLD = 0.15

export const COLLAPSE_RULES = ['gewichtete-synthese', 'bester-traeger', 'konsens-erzwingen']

/** Wandelt Rohgewichte in endliche, begrenzte Zahlen um. */
function sanitizeWeights(raw) {
  const result = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [key, value] of Object.entries(raw)) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) continue
    result[key] = Math.min(100, Math.max(0, numeric))
  }
  return result
}

function normalizeWeights(entries) {
  const sum = entries.reduce((acc, entry) => acc + Math.max(0, entry.weight), 0)
  if (!Number.isFinite(sum) || sum <= 0) {
    const equal = 1 / Math.max(1, entries.length)
    return entries.map((entry) => ({ ...entry, share: equal }))
  }
  return entries.map((entry) => ({ ...entry, share: Math.max(0, entry.weight) / sum }))
}

/** Begriffe, die in mindestens `minCount` Ausgaben vorkommen. */
function sharedKeywords(entries, minCount) {
  const counts = new Map()
  for (const entry of entries) {
    for (const term of new Set(keywords(entry.text, 24))) {
      counts.set(term, (counts.get(term) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([term]) => term)
    .sort()
}

function percent(value) {
  return (value * 100).toFixed(1)
}

export function collapse({ prompt, streams, weights, rule, threshold, minAgreeingModels }) {
  const collapseRule = COLLAPSE_RULES.includes(String(rule)) ? String(rule) : COLLAPSE_RULES[0]
  const effectiveThreshold = clampThreshold(threshold)
  const effectiveMinimum = clampMinAgreeing(minAgreeingModels)
  const cleanWeights = sanitizeWeights(weights)

  const usable = streams
    .filter((stream) => stream.text && stream.text.trim().length > 0)
    .map((stream) => ({ ...stream, weight: cleanWeights[stream.id] ?? 0 }))

  if (usable.length === 0) {
    return {
      status: 'leer',
      rule: collapseRule,
      message:
        'Es liegen keine abgeschlossenen Modellausgaben vor. Starten Sie eine Superposition, bevor Sie den Kollaps auslösen.',
      finalText: '',
      protocol: [],
      metrics: null,
      coherence: [],
      coherenceMatrix: {},
      convergenceIndex: 1,
      consensus: null,
    }
  }

  const weighted = normalizeWeights(usable).sort((a, b) => b.share - a.share)
  const primary = weighted[0]

  /* Kohärenz über alle Paare, Konvergenz-Index als Mittel der paarweisen Kohärenzen. */
  const coherenceOutputs = weighted.map((entry) => ({
    modelId: entry.id,
    label: entry.label,
    text: entry.text,
    weight: entry.share,
  }))
  const coherenceMatrix = buildCoherenceMatrix(coherenceOutputs)
  const convergenceIndex = meanPairwiseCoherence(coherenceMatrix)
  const weightConcentration = weighted.reduce((acc, entry) => acc + entry.share ** 2, 0)
  const confidence = weighted.reduce((acc, entry) => acc + entry.share * (entry.confidence ?? 0.7), 0)
  const tokens = weighted.reduce((acc, entry) => acc + (entry.tokens ?? 0), 0)
  const latency = weighted.reduce((acc, entry) => acc + entry.share * (entry.latencyMs ?? 0), 0) || 0
  const divergences = coherencePairs(coherenceMatrix, coherenceOutputs)

  /**
   * Antwortzeilen auswerten.
   *
   * Die entscheidungstragende Zeile jeder Ausgabe („ANSWER: …") wird gesondert geführt: Sie ist
   * die kürzeste Zeile und fällt deshalb aus jeder Ähnlichkeitsbetrachtung heraus. Genau sie muss
   * das Ergebnis benennen — sonst trägt der Kollaps die ähnlichste Prosa statt der Entscheidung.
   */
  const verdicts = weighted
    .map((entry) => ({ entry, line: firstVerdictLine(entry.text) }))
    .filter((item) => item.line !== null)
  const verdictGroups = new Map()
  for (const item of verdicts) {
    const key = normalizeVerdict(item.line)
    const bucket = verdictGroups.get(key) ?? { line: item.line, supporters: 0, share: 0, channels: [] }
    bucket.supporters += 1
    bucket.share += item.entry.share ?? 0
    bucket.channels.push(item.entry.label)
    verdictGroups.set(key, bucket)
  }
  const decision =
    [...verdictGroups.values()].sort(
      (a, b) => b.supporters - a.supporters || b.share - a.share || a.line.localeCompare(b.line),
    )[0] ?? null
  const decisionBlock = decision
    ? `Entscheidung: ${decision.line}\nGetragen von ${decision.supporters} von ${verdicts.length} ausgewerteten Antwortzeilen (${decision.channels.join(', ')}). Bei Gleichstand entscheidet der Gewichtsanteil.`
    : null

  /* Satzweiser Konsens über alle Ausgaben. */
  const analysis = analyseSentenceSupport(weighted, {
    threshold: effectiveThreshold,
    minAgreeingModels: effectiveMinimum,
  })
  const consensus = summarizeConsensus(analysis)

  // Nur gestützte Aussagen dürfen das Ergebnis tragen, sortiert nach Gewicht und Verankerung.
  const carried = [...analysis.supported].sort((a, b) => b.score - a.score)
  const carriedByModel = new Map()
  for (const entry of carried) {
    const list = carriedByModel.get(entry.providerId) ?? []
    list.push(entry)
    carriedByModel.set(entry.providerId, list)
  }

  const sections = []
  let supporters = []
  let notes = []
  let ruleNote = ''

  // Die Entscheidung steht am Anfang des Berichts: Sie ist das Ergebnis, alles Weitere ist Nachweis.
  if (decisionBlock) sections.push(decisionBlock)

  if (collapseRule === 'bester-traeger') {
    notes = weighted.slice(1)
    sections.push(
      `Kernaussage — alleiniger Träger ${primary.label} (${primary.model}, Gewicht ${percent(primary.share)} %):\n${leadSentences(primary.text, 3)}`,
    )
    ruleNote = `Regel „Bester Träger": Die übrigen ${notes.length} Kanäle wurden nicht eingemischt. Die Konsensprüfung läuft mit, entscheidet hier aber nicht über den Inhalt.`
  } else if (collapseRule === 'konsens-erzwingen') {
    const considered = weighted.filter((entry) => entry.share >= 0.1)
    const minimum = effectiveMinimum
    const consensusTerms = sharedKeywords(considered, Math.max(2, minimum))
    supporters = considered.filter((entry) => entry !== primary)
    notes = weighted.filter((entry) => entry.share < 0.1)

    if (carried.length > 0) {
      sections.push(
        `Kernaussage im Konsens — ${carried.length} von ${consensus.sentenceCount} Aussagen gestützt:\n${carried
          .slice(0, 4)
          .map(
            (entry) =>
              `• ${entry.label} (Stützung ${entry.supportCount} von ${analysis.modelCount}, Score ${entry.score.toFixed(3)}): ${entry.sentence}`,
          )
          .join('\n')}`,
      )
    } else {
      sections.push(
        `Kernaussage im Konsens:\nKeine Aussage erreicht die Schwelle von ${effectiveThreshold.toFixed(2)} gegenüber mindestens ${effectiveMinimum} Modellen. Das Ergebnis bleibt damit leer — genau das ist die Aussage dieser Regel.`,
      )
    }

    sections.push(
      consensusTerms.length > 0
        ? `Gemeinsame Begriffe (in mindestens ${Math.max(2, minimum)} von ${considered.length} Ausgaben): ${consensusTerms.join(', ')}`
        : `Gemeinsame Begriffe: keine. Die Ausgaben überschneiden sich nicht — ein erzwungener Konsens wäre irreführend.`,
    )
    ruleNote = `Regel „Konsens erzwingen": Nur Aussagen mit Stützung durch mindestens ${effectiveMinimum} Modelle bei einer Ähnlichkeit ab ${effectiveThreshold.toFixed(2)} tragen das Ergebnis.`
  } else {
    supporters = weighted.filter(
      (entry) => entry !== primary && entry.share >= DEFAULT_SUPPORT_THRESHOLD,
    )
    notes = weighted.filter((entry) => entry !== primary && entry.share < DEFAULT_SUPPORT_THRESHOLD)

    const primaryCarried = carriedByModel.get(primary.id) ?? []
    sections.push(
      primaryCarried.length > 0
        ? `Kernaussage — getragen von ${primary.label} (${primary.model}, Gewicht ${percent(primary.share)} %), nur gestützte Aussagen:\n${primaryCarried
            .slice(0, 3)
            .map((entry) => `• ${entry.sentence}`)
            .join('\n')}`
        : `Kernaussage — getragen von ${primary.label} (${primary.model}, Gewicht ${percent(primary.share)} %):\nKeine Aussage des Trägers erreicht die Konsensschwelle; die Ausgabe bleibt als Ganzes kenntlich.`,
    )
    if (supporters.length > 0) {
      sections.push(
        `Ergänzungen:\n${supporters
          .map((entry) => {
            const own = carriedByModel.get(entry.id) ?? []
            const line = own.length > 0 ? own[0].sentence : leadSentences(entry.text, 1)
            return `• ${entry.label} (${percent(entry.share)} %): ${line}`
          })
          .join('\n')}`,
      )
    }
    ruleNote = `Regel „Gewichtete Synthese": Träger, Ergänzungen und Randnotizen nach Gewichtsanteil; Aussagen unterhalb der Konsensschwelle bleiben unberücksichtigt.`
  }

  /* Isolate: verworfen, aber vollständig benannt. */
  if (consensus.isolateCount > 0) {
    sections.push(
      `Verworfene Isolate (${consensus.isolateCount} von ${consensus.sentenceCount} Aussagen, je ohne Stützung durch mindestens ${effectiveMinimum} Modelle bei Ähnlichkeit ab ${effectiveThreshold.toFixed(2)}):\n${consensus.isolates
        .map(
          (entry) =>
            `• ${entry.label} (beste Ähnlichkeit ${percent(entry.bestOverlap)} %, Stützung ${entry.supportCount}): ${entry.sentence}`,
        )
        .join('\n')}${consensus.isolateCount > consensus.isolates.length ? `\n• … und ${consensus.isolateCount - consensus.isolates.length} weitere; vollständig im Feld „consensus“.` : ''}`,
    )
  }

  if (notes.length > 0) {
    sections.push(
      `Randnotizen:\n${notes
        .map((entry) => `• ${entry.label} (${percent(entry.share)} %) — nicht eingemischt`)
        .join('\n')}`,
    )
  }

  if (verdicts.length > 0) {
    sections.push(
      `Antwortzeilen (wörtlich, nach Gewichtsanteil):\n${verdicts
        .map((item) => `• ${item.entry.label} (${percent(item.entry.share)} %): ${item.line}`)
        .join('\n')}`,
    )
  }

  const safeConvergence = Number.isFinite(convergenceIndex) ? convergenceIndex : 0
  const safeConcentration = Number.isFinite(weightConcentration) ? weightConcentration : 0
  const safeConfidence = Number.isFinite(confidence) ? confidence : 0

  sections.push(
    `Ablage: Konvergenz-Index ${percent(safeConvergence)} % (mittlere paarweise Kohärenz) · Gewichtskonzentration ${safeConcentration.toFixed(3)} · Modellgüte ${percent(safeConfidence)} % · ${tokens} Token · mittlere Laufzeit ${Math.round(latency)} ms.`,
  )
  sections.push(
    `Konsensprüfung: ${consensus.supportedCount} von ${consensus.sentenceCount} Aussagen gestützt · ${consensus.isolateCount} Isolate verworfen · Jaccard-Schwelle ${effectiveThreshold.toFixed(2)} · mindestens ${effectiveMinimum} zustimmende Modelle.`,
  )
  sections.push(ruleNote)

  const divergence = divergences[0]
  if (divergence) {
    sections.push(
      `Divergenzhinweis: Die stärkste Abweichung liegt zwischen ${divergence.pair[0]} und ${divergence.pair[1]} (Kohärenz ${(divergence.overlap * 100).toFixed(0)} %). Diese Stellen sind vor einer Entscheidung einzeln zu prüfen.`,
    )
  }

  const protocol = weighted.map((entry, index) => ({
    step: index + 1,
    providerId: entry.id,
    label: entry.label,
    model: entry.model,
    weight: entry.weight,
    share: Number(entry.share.toFixed(4)),
    sharePct: Number((entry.share * 100).toFixed(1)),
    contribution:
      entry === primary ? 'Träger' : supporters.includes(entry) ? 'Ergänzung' : 'Randnotiz',
    tokens: entry.tokens ?? 0,
    latencyMs: entry.latencyMs ?? 0,
    confidence: entry.confidence ?? null,
    sentences: consensus.byModel[entry.id]?.supported ?? 0,
    isolates: consensus.byModel[entry.id]?.isolates ?? 0,
  }))

  return {
    status: 'kollabiert',
    rule: collapseRule,
    prompt,
    collapsedAt: new Date().toISOString(),
    finalText: sections.join('\n\n'),
    decision: decision
      ? {
          line: decision.line,
          value: normalizeVerdict(decision.line),
          supporters: decision.supporters,
          evaluatedVerdicts: verdicts.length,
          channels: decision.channels,
          tieBreak: decision.supporters * 2 === verdicts.length && verdicts.length > 0,
        }
      : null,
    primary: {
      providerId: primary.id,
      label: primary.label,
      model: primary.model,
      share: Number(primary.share.toFixed(4)),
    },
    protocol,
    metrics: {
      convergenceIndex: Number(safeConvergence.toFixed(4)),
      weightConcentration: Number(safeConcentration.toFixed(4)),
      confidence: Number(safeConfidence.toFixed(4)),
      tokens,
      latencyMs: Math.round(latency),
      contributors: weighted.length,
      supporters: supporters.length,
      notes: notes.length,
      jaccardThreshold: effectiveThreshold,
      minAgreeingModels: effectiveMinimum,
      sentenceCount: consensus.sentenceCount,
      supportedSentences: consensus.supportedCount,
      isolates: consensus.isolateCount,
    },
    consensus: {
      ...consensus,
      carried: carried.slice(0, 12).map((entry) => ({
        providerId: entry.providerId,
        label: entry.label,
        sentence: entry.sentence,
        supportCount: entry.supportCount,
        supportLabels: entry.supportLabels,
        consensusScore: entry.consensusScore,
        share: entry.share,
        score: entry.score,
      })),
      isolates: consensus.isolates.map((entry) => ({ ...entry })),
    },
    convergenceIndex: Number(safeConvergence.toFixed(4)),
    coherenceMatrix,
    coherence: divergences.slice(0, 6).map((entry) => ({
      ids: entry.ids,
      pair: entry.pair,
      overlap: Number(entry.overlap.toFixed(4)),
    })),
  }
}
