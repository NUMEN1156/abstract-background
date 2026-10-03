/**
 * Kohärenzanalyse der Modell-Superposition.
 *
 * Umsetzung der gelieferten Ausarbeitung zum Kollaps: Ähnlichkeit als Jaccard-Koeffizient über
 * die Wortmengen zweier Ausgaben, vollständige Kohärenzmatrix über alle Modellpaare und der
 * Konvergenz-Index als Mittel über alle paarweisen Kohärenzen.
 *
 * Die Vorlage lag als TypeScript vor; hier liegt dieselbe Rechenlogik als ESM-Modul des
 * Fastify-Prozesses, damit sie ohne zusätzlichen Übersetzungsschritt serverseitig läuft.
 * Die Signaturen und Feldnamen der Vorlage bleiben erhalten:
 *   ModelOutput { modelId, text, weight }
 *   CollapseResult { synthesizedText, convergenceIndex, coherenceMatrix }
 */

/**
 * Lexikalische Ähnlichkeit zweier Texte (Jaccard-Koeffizient).
 * Wortmengen werden aus dem kleingeschriebenen Text an Leerraum gebildet.
 */
export function calculateTextSimilarity(textA, textB) {
  const wordsA = new Set(String(textA ?? '').toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(String(textB ?? '').toLowerCase().split(/\s+/).filter(Boolean))
  const intersection = new Set([...wordsA].filter((word) => wordsB.has(word)))
  const union = new Set([...wordsA, ...wordsB])
  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Kohärenzmatrix über alle Modellpaare. Der Vergleich eines Modells mit sich selbst ist 1.
 */
export function buildCoherenceMatrix(outputs) {
  const matrix = {}
  for (const first of outputs) {
    matrix[first.modelId] = {}
    for (const second of outputs) {
      matrix[first.modelId][second.modelId] =
        first.modelId === second.modelId
          ? 1
          : calculateTextSimilarity(first.text, second.text)
    }
  }
  return matrix
}

/** Konvergenz-Index: Mittel über alle geordneten Paare unterschiedlicher Modelle. */
export function meanPairwiseCoherence(matrix) {
  const ids = Object.keys(matrix ?? {})
  let sum = 0
  let pairs = 0
  for (const first of ids) {
    for (const second of ids) {
      if (first === second) continue
      const value = matrix[first]?.[second]
      if (!Number.isFinite(value)) continue
      sum += value
      pairs += 1
    }
  }
  return pairs > 0 ? sum / pairs : 1
}

/** Alle Modellpaare mit ihrer Kohärenz, aufsteigend sortiert. */
export function coherencePairs(matrix, outputs) {
  const labels = new Map(outputs.map((output) => [output.modelId, output.label ?? output.modelId]))
  const pairs = []
  for (let first = 0; first < outputs.length; first += 1) {
    for (let second = first + 1; second < outputs.length; second += 1) {
      const a = outputs[first].modelId
      const b = outputs[second].modelId
      pairs.push({
        ids: [a, b],
        pair: [labels.get(a) ?? a, labels.get(b) ?? b],
        overlap: matrix[a]?.[b] ?? 0,
      })
    }
  }
  return pairs.sort((x, y) => x.overlap - y.overlap)
}

/**
 * Dreiphasiger Kollaps der Vorlage: Gewichte normalisieren, Kohärenzmatrix bilden,
 * Konvergenz-Index ermitteln und die Ausgabe des Trägers als Ergebnis zurückgeben.
 */
export function executeSuperpositionCollapse(outputs) {
  const totalWeight = outputs.reduce((sum, model) => sum + model.weight, 0)
  const normalizedOutputs = outputs.map((model) => ({
    ...model,
    normalizedWeight: totalWeight > 0 ? model.weight / totalWeight : 1 / outputs.length,
  }))

  const coherenceMatrix = buildCoherenceMatrix(outputs)
  const convergenceIndex = meanPairwiseCoherence(coherenceMatrix)

  const dominantModel = normalizedOutputs.reduce((previous, current) =>
    current.normalizedWeight > previous.normalizedWeight ? current : previous,
  )

  const synthesizedText = `[Synthetisiertes Kollaps-Ergebnis] ${dominantModel.text} (Konvergenz-Index: ${(
    convergenceIndex * 100
  ).toFixed(1)}%)`

  return {
    synthesizedText,
    convergenceIndex,
    coherenceMatrix,
    dominantModelId: dominantModel.modelId,
    normalizedWeights: Object.fromEntries(
      normalizedOutputs.map((model) => [model.modelId, model.normalizedWeight]),
    ),
  }
}