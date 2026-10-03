import { keywords, leadSentences } from './providers.mjs'
import { buildCoherenceMatrix, coherencePairs, meanPairwiseCoherence } from './coherence.mjs'

/**
 * Kollaps: führt die gewichteten Modellausgaben zu einem finalen Ergebnis zusammen.
 *
 * Der Algorithmus verändert die Einzeltexte nicht. Er bestimmt einen Träger, ordnet
 * Ergänzungen und Randnotizen zu, berechnet Kohärenz- und Konvergenzmaße und legt für
 * jeden Schritt ein nachvollziehbares Protokoll an. Drei Kollapsregeln stehen zur Wahl.
 *
 * Die Kohärenzanalyse stammt aus `coherence.mjs`: Ähnlichkeit als Jaccard-Koeffizient über
 * die Wortmengen, vollständige Matrix über alle Modellpaare, Konvergenz-Index als Mittel
 * über alle paarweisen Kohärenzen.
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

/** Sätze einer Ausgabe, die mindestens einen der Begriffe enthalten. */
function sentencesWith(text, terms) {
  if (terms.length === 0) return []
  const wanted = new Set(terms)
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => keywords(sentence, 40).some((word) => wanted.has(word)))
}

export function collapse({ prompt, streams, weights, rule }) {
  const collapseRule = COLLAPSE_RULES.includes(String(rule)) ? String(rule) : COLLAPSE_RULES[0]
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
    }
  }

  const weighted = normalizeWeights(usable).sort((a, b) => b.share - a.share)
  const primary = weighted[0]

  /* Phase 1 und 2 der Vorlage: Gewichte normalisieren, Kohärenzmatrix über alle Paare bilden. */
  const coherenceOutputs = weighted.map((entry) => ({
    modelId: entry.id,
    label: entry.label,
    text: entry.text,
    weight: entry.share,
  }))
  const coherenceMatrix = buildCoherenceMatrix(coherenceOutputs)

  /* Phase 3: Konvergenz-Index als Mittel über alle paarweisen Kohärenzen. */
  const convergenceIndex = meanPairwiseCoherence(coherenceMatrix)
  const weightConcentration = weighted.reduce((acc, entry) => acc + entry.share ** 2, 0)
  const confidence = weighted.reduce((acc, entry) => acc + entry.share * (entry.confidence ?? 0.7), 0)
  const tokens = weighted.reduce((acc, entry) => acc + (entry.tokens ?? 0), 0)
  const latency = weighted.reduce((acc, entry) => acc + entry.share * (entry.latencyMs ?? 0), 0) || 0

  const divergences = coherencePairs(coherenceMatrix, coherenceOutputs)

  const sections = []
  let supporters = []
  let notes = []
  let ruleNote = ''

  if (collapseRule === 'bester-traeger') {
    notes = weighted.slice(1)
    sections.push(
      `Kernaussage — alleiniger Träger ${primary.label} (${primary.model}, Gewicht ${(primary.share * 100).toFixed(1)} %):\n${leadSentences(primary.text, 3)}`,
    )
    ruleNote = `Regel „Bester Träger": Die übrigen ${notes.length} Kanäle wurden nicht eingemischt.`
  } else if (collapseRule === 'konsens-erzwingen') {
    const considered = weighted.filter((entry) => entry.share >= 0.1)
    const minimum = Math.max(2, Math.ceil(considered.length * 0.5))
    const consensusTerms = sharedKeywords(considered, minimum)
    const consensusSentences = sentencesWith(primary.text, consensusTerms)

    supporters = considered.filter((entry) => entry !== primary)
    notes = weighted.filter((entry) => entry.share < 0.1)

    sections.push(
      consensusSentences.length > 0
        ? `Kernaussage im Konsens — Träger ${primary.label} (${(primary.share * 100).toFixed(1)} %):\n${consensusSentences.slice(0, 3).join(' ')}`
        : `Kernaussage im Konsens — Träger ${primary.label} (${(primary.share * 100).toFixed(1)} %):\nKein Satz des Trägers berührt die gemeinsamen Begriffe; die Ausgabe bleibt als Ganzes kenntlich.`,
    )
    sections.push(
      consensusTerms.length > 0
        ? `Gemeinsame Begriffe (in mindestens ${minimum} von ${considered.length} Ausgaben): ${consensusTerms.join(', ')}`
        : `Gemeinsame Begriffe: keine. Die Ausgaben überschneiden sich nicht — ein erzwungener Konsens wäre irreführend.`,
    )
    ruleNote =
      'Regel „Konsens erzwingen": Nur übereinstimmend belegte Aussagen tragen das Ergebnis; abweichende Kanäle bleiben kenntlich.'
  } else {
    supporters = weighted.filter(
      (entry) => entry !== primary && entry.share >= DEFAULT_SUPPORT_THRESHOLD,
    )
    notes = weighted.filter((entry) => entry !== primary && entry.share < DEFAULT_SUPPORT_THRESHOLD)

    sections.push(
      `Kernaussage — getragen von ${primary.label} (${primary.model}, Gewicht ${(primary.share * 100).toFixed(1)} %):\n${leadSentences(primary.text, 2)}`,
    )
    if (supporters.length > 0) {
      sections.push(
        `Ergänzungen:\n${supporters
          .map(
            (entry) =>
              `• ${entry.label} (${(entry.share * 100).toFixed(1)} %): ${leadSentences(entry.text, 1)}`,
          )
          .join('\n')}`,
      )
    }
    ruleNote = 'Regel „Gewichtete Synthese": Träger, Ergänzungen und Randnotizen nach Gewichtsanteil.'
  }

  if (notes.length > 0) {
    sections.push(
      `Randnotizen:\n${notes
        .map((entry) => `• ${entry.label} (${(entry.share * 100).toFixed(1)} %) — nicht eingemischt`)
        .join('\n')}`,
    )
  }

  const safeConvergence = Number.isFinite(convergenceIndex) ? convergenceIndex : 0
  const safeConcentration = Number.isFinite(weightConcentration) ? weightConcentration : 0
  const safeConfidence = Number.isFinite(confidence) ? confidence : 0

  sections.push(
    `Ablage: Konvergenz-Index ${(safeConvergence * 100).toFixed(1)} % (mittlere paarweise Kohärenz) · Gewichtskonzentration ${safeConcentration.toFixed(3)} · Modellgüte ${(safeConfidence * 100).toFixed(1)} % · ${tokens} Token · mittlere Laufzeit ${Math.round(latency)} ms.`,
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
  }))

  return {
    status: 'kollabiert',
    rule: collapseRule,
    prompt,
    collapsedAt: new Date().toISOString(),
    finalText: sections.join('\n\n'),
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