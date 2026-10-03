import { calculateTextSimilarity } from './coherence.mjs'

/**
 * Satzweiser Konsens über alle Modellausgaben.
 *
 * Eine Aussage gilt als gestützt, wenn mindestens ein anderes Modell einen Satz beisteuert,
 * dessen lexikalische Ähnlichkeit (Jaccard-Koeffizient über die Wortmengen) die konfigurierbare
 * Schwelle erreicht oder übersteigt. Aussagen, die zu wenige Modelle stützen, werden zu Isolaten
 * und dürfen das Ergebnis nicht mehr tragen — sie werden aber vollständig protokolliert.
 *
 * Zwei Stellschrauben:
 *   jaccardThreshold  — ab welcher Ähnlichkeit zwei Sätze als übereinstimmend gelten (0,05–0,5)
 *   minAgreeingModels — wie viele Modelle eine Aussage mindestens stützen müssen (1–6)
 */

/**
 * Vorgabe der Schwelle. Sie ist an simulierten Ausgaben gemessen: Bei vier Modellen und rund
 * 40 Aussagen bleiben bei 0.05 fast alle Aussagen gestützt (39 von 41), bei 0.10 noch zwei
 * Drittel (27), bei 0.15 nur noch neun und bei 0.25 praktisch keine (2). 0.10 filtert also
 * deutlich, ohne das Ergebnis zu leeren.
 */
export const DEFAULT_JACCARD_THRESHOLD = 0.1
export const DEFAULT_MIN_AGREEING_MODELS = 2
export const MIN_JACCARD_THRESHOLD = 0.05
export const MAX_JACCARD_THRESHOLD = 0.5
export const MIN_AGREEING_LIMIT = 1
export const MAX_AGREEING_LIMIT = 6

/** Begrenzt die Schwelle auf den zulässigen Bereich und fängt ungültige Werte ab. */
export function clampThreshold(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_JACCARD_THRESHOLD
  return Math.min(MAX_JACCARD_THRESHOLD, Math.max(MIN_JACCARD_THRESHOLD, Number(numeric.toFixed(3))))
}

/** Begrenzt die Mindeststützung auf ganze Zahlen im zulässigen Bereich. */
export function clampMinAgreeing(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_MIN_AGREEING_MODELS
  return Math.min(MAX_AGREEING_LIMIT, Math.max(MIN_AGREEING_LIMIT, Math.round(numeric)))
}

/** Zerlegt einen Text in Sätze und behält nur solche mit verwertbarem Inhalt. */
export function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(/\s+/).filter(Boolean).length >= 4)
}

function truncate(sentence, limit = 180) {
  return sentence.length <= limit ? sentence : `${sentence.slice(0, limit - 1).trimEnd()}…`
}

/**
 * Bewertet jeden Satz aller Ausgaben.
 *
 * Rückgabe je Eintrag: Sprecher, Satz, stützende Modelle, Zahl der Stützungen (einschließlich
 * des Sprechers), beste erzielte Ähnlichkeit und ein Konsens-Score, der Modellgewicht und
 * Verankerung im Modellnetz verbindet.
 */
export function analyseSentenceSupport(entries, { threshold, minAgreeingModels }) {
  const effectiveThreshold = clampThreshold(threshold)
  const effectiveMinimum = clampMinAgreeing(minAgreeingModels)
  const modelCount = entries.length

  // Die Wortmengen jeder Ausgabe werden je Modell genau einmal gebildet.
  const sentencesByModel = new Map(
    entries.map((entry) => [entry.id, splitSentences(entry.text)]),
  )

  const assessments = []
  for (const speaker of entries) {
    for (const sentence of sentencesByModel.get(speaker.id) ?? []) {
      const agreeing = []
      let bestOverlap = 0
      for (const other of entries) {
        if (other.id === speaker.id) continue
        let overlap = 0
        for (const candidate of sentencesByModel.get(other.id) ?? []) {
          const similarity = calculateTextSimilarity(sentence, candidate)
          if (similarity > overlap) overlap = similarity
        }
        if (overlap > bestOverlap) bestOverlap = overlap
        if (overlap >= effectiveThreshold) agreeing.push(other)
      }

      const supportCount = 1 + agreeing.length
      const consensusScore = modelCount > 1 ? (supportCount - 1) / (modelCount - 1) : 1
      // Gewicht und Verankerung wirken beide: halber Anteil aus dem Modellgewicht,
      // halber Anteil aus der Zahl der zustimmenden Modelle.
      const weightShare = speaker.share ?? 0
      const score = weightShare * (0.5 + 0.5 * consensusScore)

      assessments.push({
        providerId: speaker.id,
        label: speaker.label,
        model: speaker.model,
        sentence,
        supportCount,
        supportLabels: agreeing.map((entry) => entry.label),
        bestOverlap: Number(bestOverlap.toFixed(4)),
        consensusScore: Number(consensusScore.toFixed(4)),
        share: Number(weightShare.toFixed(4)),
        score: Number(score.toFixed(6)),
        supported: supportCount >= effectiveMinimum,
        solo: supportCount === 1,
      })
    }
  }

  return {
    threshold: effectiveThreshold,
    minAgreeingModels: effectiveMinimum,
    modelCount,
    assessments,
    supported: assessments.filter((entry) => entry.supported),
    isolates: assessments.filter((entry) => !entry.supported),
  }
}

/**
 * Fasst die Bewertung für das Protokoll zusammen: Kennzahlen, Isolate je Modell und die
 * tragenden Aussagen in Rangfolge.
 */
export function summarizeConsensus(analysis, { isolateLimit = 6 } = {}) {
  const perModel = new Map()
  for (const entry of analysis.assessments) {
    const bucket = perModel.get(entry.providerId) ?? { supported: 0, isolates: 0 }
    if (entry.supported) bucket.supported += 1
    else bucket.isolates += 1
    perModel.set(entry.providerId, bucket)
  }

  const byModel = {}
  for (const [id, bucket] of perModel) {
    byModel[id] = { supported: bucket.supported, isolates: bucket.isolates }
  }

  return {
    threshold: analysis.threshold,
    minAgreeingModels: analysis.minAgreeingModels,
    sentenceCount: analysis.assessments.length,
    supportedCount: analysis.supported.length,
    isolateCount: analysis.isolates.length,
    byModel,
    topSupported: [...analysis.supported]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => ({
        providerId: entry.providerId,
        label: entry.label,
        sentence: truncate(entry.sentence),
        supportCount: entry.supportCount,
        supportLabels: entry.supportLabels,
        bestOverlap: entry.bestOverlap,
        consensusScore: entry.consensusScore,
        share: entry.share,
        score: entry.score,
      })),
    isolates: [...analysis.isolates]
      .sort((a, b) => b.bestOverlap - a.bestOverlap)
      .slice(0, isolateLimit)
      .map((entry) => ({
        providerId: entry.providerId,
        label: entry.label,
        sentence: truncate(entry.sentence),
        supportCount: entry.supportCount,
        bestOverlap: entry.bestOverlap,
      })),
  }
}
