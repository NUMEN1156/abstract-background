import { keywords, leadSentences } from './providers.mjs'

/**
 * Kollaps: führt die gewichteten Modellausgaben zu einem finalen Ergebnis zusammen.
 *
 * Der Algorithmus verändert die Einzeltexte nicht. Er bestimmt einen Träger, ordnet
 * Ergänzungen und Randnotizen zu, berechnet Konvergenz- und Kohärenzmaße und legt für
 * jeden Schritt ein nachvollziehbares Protokoll an.
 */

const SUPPORT_THRESHOLD = 0.15

function normalizeWeights(entries) {
  const sum = entries.reduce((acc, entry) => acc + Math.max(0, entry.weight), 0)
  if (sum <= 0) {
    const equal = 1 / Math.max(1, entries.length)
    return entries.map((entry) => ({ ...entry, share: equal }))
  }
  return entries.map((entry) => ({ ...entry, share: Math.max(0, entry.weight) / sum }))
}

function jaccard(a, b) {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const value of setA) if (setB.has(value)) intersection += 1
  return intersection / (setA.size + setB.size - intersection)
}

export function collapse({ prompt, streams, weights }) {
  const usable = streams
    .filter((stream) => stream.text && stream.text.trim().length > 0)
    .map((stream) => ({
      ...stream,
      weight: Number(weights?.[stream.id] ?? 0),
    }))

  if (usable.length === 0) {
    return {
      status: 'leer',
      message:
        'Es liegen keine abgeschlossenen Modellausgaben vor. Starten Sie eine Superposition, bevor Sie den Kollaps auslösen.',
      finalText: '',
      protocol: [],
      metrics: null,
      coherence: [],
    }
  }

  const weighted = normalizeWeights(usable).sort((a, b) => b.share - a.share)
  const primary = weighted[0]
  const supporters = weighted.filter((entry) => entry !== primary && entry.share >= SUPPORT_THRESHOLD)
  const notes = weighted.filter((entry) => entry !== primary && entry.share < SUPPORT_THRESHOLD)

  const convergence = weighted.reduce((acc, entry) => acc + entry.share ** 2, 0)
  const confidence = weighted.reduce((acc, entry) => acc + entry.share * (entry.confidence ?? 0.7), 0)
  const tokens = weighted.reduce((acc, entry) => acc + (entry.tokens ?? 0), 0)
  const latency =
    weighted.reduce((acc, entry) => acc + entry.share * (entry.latencyMs ?? 0), 0) || 0

  const sections = []
  sections.push(
    `Kernaussage — getragen von ${primary.label} (${primary.model}, Gewicht ${(primary.share * 100).toFixed(1)} %):\n${leadSentences(primary.text, 2)}`,
  )

  if (supporters.length > 0) {
    const body = supporters
      .map(
        (entry) =>
          `• ${entry.label} (${(entry.share * 100).toFixed(1)} %): ${leadSentences(entry.text, 1)}`,
      )
      .join('\n')
    sections.push(`Ergänzungen:\n${body}`)
  }

  if (notes.length > 0) {
    const body = notes
      .map((entry) => `• ${entry.label} (${(entry.share * 100).toFixed(1)} %) — Randnotiz, kein Träger`)
      .join('\n')
    sections.push(`Randnotizen:\n${body}`)
  }

  const divergences = weighted
    .flatMap((entry, index) =>
      weighted.slice(index + 1).map((other) => ({
        pair: [entry.label, other.label],
        score: jaccard(keywords(entry.text), keywords(other.text)),
      })),
    )
    .sort((a, b) => a.score - b.score)
  const divergence = divergences[0] ?? null

  sections.push(
    `Ablage: Konvergenz-Index ${convergence.toFixed(3)} · Modellgüte ${(confidence * 100).toFixed(1)} % · ${tokens} Token · mittlere Laufzeit ${Math.round(latency)} ms.`,
  )
  if (divergence) {
    sections.push(
      `Divergenzhinweis: Die stärkste Abweichung liegt zwischen ${divergence.pair[0]} und ${divergence.pair[1]} (Überlappung ${(divergence.score * 100).toFixed(0)} %). Diese Stellen sind vor einer Entscheidung einzeln zu prüfen.`,
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
      entry === primary ? 'Träger' : entry.share >= SUPPORT_THRESHOLD ? 'Ergänzung' : 'Randnotiz',
    tokens: entry.tokens ?? 0,
    latencyMs: entry.latencyMs ?? 0,
    confidence: entry.confidence ?? null,
  }))

  return {
    status: 'kollabiert',
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
      convergence: Number(convergence.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      tokens,
      latencyMs: Math.round(latency),
      contributors: weighted.length,
      supporters: supporters.length,
      notes: notes.length,
    },
    coherence: divergences.slice(0, 6).map((entry) => ({
      pair: entry.pair,
      overlap: Number(entry.score.toFixed(3)),
    })),
  }
}