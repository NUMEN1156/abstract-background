import crypto from 'node:crypto'
import fs from 'node:fs'

/**
 * Gemeinsame Bausteine der eingefrorenen Auswertung.
 *
 * Alle Regeln dieses Moduls sind vor der Generierung festgelegt (siehe PREREGISTRATION.md) und
 * werden nach Sichtung der Ergebnisse nicht mehr verändert.
 */

export const CHANNELS = [
  { id: 'K1', model: 'gpt-5-mini', family: 'openai', label: 'Kanal A' },
  { id: 'K2', model: 'gpt-5.5', family: 'openai', label: 'Kanal B' },
  { id: 'K3', model: 'claude-haiku-4-5', family: 'anthropic', label: 'Kanal C' },
  { id: 'K4', model: 'gemini-3-flash-preview', family: 'google', label: 'Kanal D' },
]

export const JUDGE_MODEL = 'claude-opus-4-7'

/** Vorab festgelegte Gewichte für Lane A′ (Erwartung nach Modellstärke, nicht nach Ergebnis). */
export const STATED_WEIGHTS = { K1: 40, K2: 30, K3: 20, K4: 10 }

export const ORDER_INSTRUCTION =
  'Answer the question below as precisely as you can. Use only the information in the passage when a passage is given. End your reply with a final line in exactly this format:\nANSWER: <your short answer>'

export const API_BASE = (process.env.OPENAI_API_BASE ?? '').replace(/\/$/, '')
export const API_KEY = process.env.OPENAI_API_KEY ?? ''

if (!API_BASE || !API_KEY) {
  throw new Error('OPENAI_API_BASE/OPENAI_API_KEY fehlen: Die Auswertung braucht den eingebauten LLM-Zugang.')
}

const chatUrl = `${API_BASE}/chat/completions`

/** Ein einzelner Modellaufruf. Fehler werden als Ausnahme gemeldet, nie still verschluckt. */
export async function chat(model, messages, { schema, maxTokens = 700, reasoning } = {}) {
  const body = { model, messages }
  if (model.startsWith('gpt-')) body.max_completion_tokens = maxTokens
  else body.max_tokens = maxTokens
  if (reasoning) body.reasoning = reasoning
  if (schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } }
  }
  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${text.slice(0, 200)}`)
  const json = JSON.parse(text)
  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error(`${model}: leere Antwort (${text.slice(0, 120)})`)
  return content
}

/** Feste Reihenfolge pro Eintrag: gleiche Eingabe, gleiche Permutation, kein Zufall zur Laufzeit. */
export function shuffled(entries, seed) {
  const digest = crypto.createHash('sha256').update(String(seed)).digest()
  const copy = [...entries]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const pick = digest[i % digest.length] % (i + 1)
    const swap = copy[i]
    copy[i] = copy[pick]
    copy[pick] = swap
  }
  return copy
}

/* ------------------------------------------------ Auswertung der Antworten ---- */

function answerSegment(text) {
  const matches = [...String(text ?? '').matchAll(/answer\s*[:\-]\s*(.+)/gi)]
  if (matches.length > 0) return matches[matches.length - 1][1].trim()
  return String(text ?? '').trim()
}

function normalizeEntity(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Überführt eine Modellantwort nach der vorab festgelegten Regel in einen Wert. */
export function extractAnswer(item, text) {
  const segment = answerSegment(text)
  const flat = segment.replace(/\s+/g, ' ').trim()
  if (flat.length === 0) return null

  if (item.answer_type === 'number') {
    const match = flat.match(/-?\d+(?:[.,]\d+)?/)
    if (!match) return null
    const numeric = Number(match[0].replace(',', '.'))
    return Number.isFinite(numeric) ? String(numeric) : null
  }

  if (item.answer_type === 'boolean') {
    const lowered = flat.toLowerCase()
    if (/\b(no|nein|false|not|nicht|does not|did not)\b/.test(lowered)) return 'no'
    if (/\b(yes|ja|true|correct)\b/.test(lowered)) return 'yes'
    return null
  }

  // entity: Kleinschreibung und Bereinigung, Vergleich gegen die zugelassenen Schreibweisen.
  const normalized = normalizeEntity(flat)
  const firstToken = normalized.split(' ')[0] ?? ''
  for (const candidate of item.accepted) {
    const wanted = normalizeEntity(candidate)
    if (normalized === wanted || firstToken === wanted) return wanted
  }
  for (const candidate of item.accepted) {
    const wanted = normalizeEntity(candidate)
    if (normalized.startsWith(wanted)) return wanted
  }
  return null
}

export function isCorrect(item, value) {
  if (value === null || value === undefined) return false
  if (item.answer_type === 'number') {
    const numeric = Number(value)
    return Number.isFinite(numeric) && Math.abs(numeric - Number(item.ground_truth)) < 1e-6
  }
  return item.accepted.some((candidate) => normalizeEntity(candidate) === value)
}

/* --------------------------------------------------------- Fehlerrechnung ---- */

/** Exakter Abgleich: Zahl mit Toleranz, sonst Zeichenkette. */
export function sameValue(item, a, b) {
  if (a === null || b === null) return a === b
  if (item.answer_type === 'number') {
    return Math.abs(Number(a) - Number(b)) < 1e-6
  }
  return a === b
}

export function summarize(records, { confidenceOf } = {}) {
  const total = records.length
  const answered = records.filter((r) => r.value !== null)
  const correct = answered.filter((r) => r.correct)
  const wrong = answered.filter((r) => !r.correct)
  const falseConsensus = wrong.filter((r) => {
    const confidence = confidenceOf ? confidenceOf(r) : null
    return confidence !== null && confidence >= 0.7
  })
  return {
    items: total,
    answered: answered.length,
    abstained: total - answered.length,
    correct: correct.length,
    wrong: wrong.length,
    accuracy: total === 0 ? 0 : correct.length / total,
    abstentionRate: total === 0 ? 0 : (total - answered.length) / total,
    falseConsensusRate: total === 0 ? 0 : falseConsensus.length / total,
  }
}

/** Minderheitenrettung: Fälle, in denen die Kanalmehrheit falsch liegt, aber ein Kanal richtig. */
export function minorityRescue(items, laneValues, channelValues) {
  const relevant = items.filter((item) => {
    const values = CHANNELS.map((c) => channelValues[item.id]?.[c.id] ?? null)
    const numeric = values.filter((v) => v !== null)
    if (numeric.length === 0) return false
    const counts = new Map()
    for (const value of numeric) counts.set(value, (counts.get(value) ?? 0) + 1)
    let majority = null
    let best = 0
    for (const [value, count] of counts) if (count > best) [majority, best] = [value, count]
    const majorityWrong = !isCorrect(item, majority)
    const anyCorrect = numeric.some((value) => isCorrect(item, value))
    return majorityWrong && anyCorrect
  })
  const rescued = relevant.filter((item) => isCorrect(item, laneValues[item.id] ?? null))
  return { relevant: relevant.length, rescued: rescued.length, ids: relevant.map((i) => i.id) }
}

export function hashFile(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')
}

export function loadCorpus(path = new URL('./corpus.json', import.meta.url)) {
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}

export function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}