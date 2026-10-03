#!/usr/bin/env node
/**
 * Lasttest der Superpositions-Middleware.
 *
 * Geprüft werden drei Fragen:
 *  1. Nebenläufigkeit — bleiben viele gleichzeitige Superpositions-Streams stabil, und erhalten
 *     später hinzutretende Empfänger den vollständigen Verlauf aus dem Ereignispuffer?
 *  2. Latenz — wie verhalten sich Antwortzeiten der Kollaps-Synthese unter gleichzeitiger Last
 *     (Mittelwert, P95, P99, Maximum)?
 *  3. Skalierung — wie wächst die Kohärenzmatrix über der Modellanzahl, und was bringt das
 *     einmalige Zerlegen der Texte gegenüber paarweiser Ähnlichkeitsberechnung?
 *
 * Aufruf:
 *   node scripts/loadtest.mjs --base=http://127.0.0.1:3200 --sessions=120
 *
 * Das Skript ist rein lesend gegenüber dem Projekt; es schreibt seinen Bericht nach reports/.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { WebSocket } from 'ws'
import { buildCoherenceMatrix, calculateTextSimilarity } from '../server/coherence.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')

/* ------------------------------------------------------------------ */
/* Eingaben                                                            */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = {}
  for (const entry of argv) {
    const match = /^--([^=]+)=?(.*)$/.exec(entry)
    if (match) args[match[1]] = match[2] === '' ? true : match[2]
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const config = {
  base: String(args.base ?? 'http://127.0.0.1:3200'),
  sessions: Number(args.sessions ?? 120),
  sessionConcurrency: Number(args['session-concurrency'] ?? 40),
  collapseRequests: Number(args.collapses ?? 120),
  collapseConcurrency: Number(args['collapse-concurrency'] ?? 32),
  httpRequests: Number(args['http-requests'] ?? 1000),
  httpConcurrency: Number(args['http-concurrency'] ?? 50),
  replaySamples: Number(args['replay-samples'] ?? 5),
  timeoutMs: Number(args.timeout ?? 90000),
  outDir: String(args.out ?? 'reports'),
}

const providerIds = String(args.providers ?? 'openai,anthropic,mistral,llama')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const wsBase = config.base.replace(/^http/, 'ws')

const PROMPTS = [
  'Wie setzt ein Unternehmen mehrere KI-Modelle gleichzeitig ein, ohne die Nachvollziehbarkeit zu verlieren?',
  'Welche Risiken entstehen, wenn ein einzelnes Modell über Kundenantworten entscheidet?',
  'Was gehört in eine Betriebsrichtlinie für generative Modelle im Kundenservice?',
  'Wie prüft man Konsens zwischen mehreren Sprachmodellen belastbar?',
  'Wann ist ein gewichteter Kollaps besser als die Auswahl der besten Einzelantwort?',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, value) => acc + value, 0)
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    mean: sorted.length > 0 ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

const round = (value, digits = 2) => Number(value.toFixed(digits))

async function jsonRequest(url, init) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null)
  return { status: response.status, payload }
}

/** Führt Aufgaben mit begrenzter Parallelität aus. */
async function pool(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/* ------------------------------------------------------------------ */
/* Phase 1: gleichzeitige Streams und Ereignispuffer                   */
/* ------------------------------------------------------------------ */

async function createSession(index) {
  const prompt = `${PROMPTS[index % PROMPTS.length]} (Lastlauf ${index + 1})`
  const { status, payload } = await jsonRequest(`${config.base}/api/superposition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, providerIds }),
  })
  if (status !== 200) {
    return { ok: false, error: payload?.error ?? `HTTP ${status}` }
  }
  return { ok: true, sessionId: payload.sessionId, prompt, providers: payload.providers.length }
}

/** Verbindet sich mit einer Sitzung und misst den vollständigen Ereignisstrom. */
function streamSession(sessionId) {
  return new Promise((resolve) => {
    const started = performance.now()
    let firstChunkAt = null
    let events = 0
    let chunks = 0
    let completedProviders = 0
    let failedProviders = 0
    let replayed = 0
    let truncated = false
    let droppedEvents = 0
    let payloadChars = 0
    const texts = new Map()
    const socket = new WebSocket(`${wsBase}/ws?session=${encodeURIComponent(sessionId)}`)
    let wireStart = 0

    const finish = (status, error) => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* bereits geschlossen */
      }
      resolve({
        status,
        error: error ?? null,
        events,
        chunks,
        payloadChars,
        truncated,
        droppedEvents,
        completedProviders,
        failedProviders,
        replayed,
        wireBytes: wireStart > 0 ? Math.max(0, (socket._socket?.bytesRead ?? 0) - wireStart) : 0,
        firstChunkMs: firstChunkAt === null ? null : firstChunkAt - started,
        durationMs: performance.now() - started,
        texts,
      })
    }

    const timer = setTimeout(() => finish('timeout', 'Zeitfenster überschritten'), config.timeoutMs)

    socket.on('open', () => {
      // Ab dem geöffneten Socket zählen die tatsächlich gelesenen TCP-Bytes.
      wireStart = socket._socket?.bytesRead ?? 0
    })

    socket.on('message', (raw) => {
      events += 1
      let event
      try {
        event = JSON.parse(String(raw))
      } catch {
        return
      }
      switch (event.type) {
        case 'session:snapshot':
          replayed = Number(event.replayed ?? 0)
          truncated = event.truncated === true
          droppedEvents = Number(event.droppedEvents ?? 0)
          break
        case 'provider:chunk':
          chunks += 1
          if (firstChunkAt === null) firstChunkAt = performance.now()
          texts.set(
            event.providerId,
            (texts.get(event.providerId) ?? '') + String(event.delta ?? ''),
          )
          payloadChars += String(event.delta ?? '').length
          break
        case 'provider:done':
          completedProviders += 1
          break
        case 'provider:error':
          failedProviders += 1
          break
        case 'session:done':
          finish('complete')
          break
        case 'fatal':
          finish('rejected', String(event.message ?? 'Kanal abgelehnt'))
          break
        default:
          break
      }
    })

    socket.on('error', (error) => finish('socket-error', error.message))
  })
}

/** Prüft, ob ein später Empfänger den gepufferten Verlauf identisch nachgespielt bekommt. */
async function replayCheck(sessionId, expectedText, providerId) {
  return new Promise((resolve) => {
    let replayed = 0
    let text = ''
    let done = false
    const socket = new WebSocket(`${wsBase}/ws?session=${encodeURIComponent(sessionId)}`)
    const timer = setTimeout(() => {
      socket.close()
      resolve({ ok: false, reason: 'Zeitfenster überschritten', replayed })
    }, 15000)

    const settle = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.close()
      resolve(result)
    }

    socket.on('message', (raw) => {
      let event
      try {
        event = JSON.parse(String(raw))
      } catch {
        return
      }
      if (event.type === 'session:snapshot') replayed = Number(event.replayed ?? 0)
      if (event.type === 'provider:chunk' && event.providerId === providerId) {
        text += String(event.delta ?? '')
      }
      if (event.type === 'session:done' || (replayed > 0 && text.length >= expectedText.length)) {
        settle({
          ok: text === expectedText,
          replayed,
          expectedChars: expectedText.length,
          receivedChars: text.length,
        })
      }
    })

    socket.on('error', (error) => settle({ ok: false, reason: error.message, replayed }))
  })
}

async function phaseStreams() {
  const indexes = Array.from({ length: config.sessions }, (_, index) => index)
  const created = await pool(indexes, config.sessionConcurrency, createSession)

  const accepted = created.filter((entry) => entry.ok)
  const rejected = created.filter((entry) => !entry.ok)

  const outcomes = await pool(accepted, accepted.length, (entry) => streamSession(entry.sessionId))

  const completed = outcomes.filter((outcome) => outcome.status === 'complete')
  const chunks = outcomes.reduce((sum, outcome) => sum + outcome.chunks, 0)
  const events = outcomes.reduce((sum, outcome) => sum + outcome.events, 0)
  const failedProviders = outcomes.reduce((sum, outcome) => sum + outcome.failedProviders, 0)
  const payloadChars = outcomes.reduce((sum, outcome) => sum + outcome.payloadChars, 0)
  const wireBytes = outcomes.reduce((sum, outcome) => sum + outcome.wireBytes, 0)
  const truncatedSessions = outcomes.filter((outcome) => outcome.truncated).length
  const droppedEvents = outcomes.reduce((sum, outcome) => sum + outcome.droppedEvents, 0)

  const samples = accepted.slice(0, config.replaySamples)
  const replayResults = []
  for (let index = 0; index < samples.length; index += 1) {
    const outcome = outcomes[index]
    const texts = outcome.texts
    const providerId = [...texts.keys()][0]
    if (!providerId) continue
    replayResults.push({
      sessionId: samples[index].sessionId,
      providerId,
      ...(await replayCheck(samples[index].sessionId, texts.get(providerId), providerId)),
    })
  }

  return {
    requested: config.sessions,
    accepted: accepted.length,
    rejected: rejected.length,
    rejectionReasons: [...new Set(rejected.map((entry) => entry.error))].slice(0, 5),
    completed: completed.length,
    completions: {
      durationMs: summarize(outcomes.map((outcome) => outcome.durationMs)),
      firstChunkMs: summarize(
        outcomes.filter((outcome) => outcome.firstChunkMs !== null).map((outcome) => outcome.firstChunkMs),
      ),
    },
    totals: { events, chunks, failedProviders },
    bandwidth: {
      payloadChars,
      wireBytes,
      ratio: payloadChars > 0 ? Number((wireBytes / payloadChars).toFixed(3)) : null,
      truncatedSessions,
      droppedEvents,
    },
    replay: replayResults,
    replayOk: replayResults.every((entry) => entry.ok),
    statuses: Object.fromEntries(
      [...new Set(outcomes.map((outcome) => outcome.status))].map((status) => [
        status,
        outcomes.filter((outcome) => outcome.status === status).length,
      ]),
    ),
    sessionIds: accepted.map((entry) => entry.sessionId),
  }
}

/* ------------------------------------------------------------------ */
/* Phase 2: Latenz der Kollaps-Synthese unter Last                     */
/* ------------------------------------------------------------------ */

async function phaseCollapse(sessionIds) {
  const targets = Array.from(
    { length: config.collapseRequests },
    (_, index) => sessionIds[index % sessionIds.length],
  ).filter(Boolean)

  const measurements = await pool(targets, config.collapseConcurrency, async (sessionId, index) => {
    const weights = {
      openai: 30 + (index % 20),
      anthropic: 25 + (index % 15),
      mistral: 20 + (index % 10),
      llama: 15,
    }
    const started = performance.now()
    const { status, payload } = await jsonRequest(`${config.base}/api/collapse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, weights }),
    })
    const durationMs = performance.now() - started
    return {
      status,
      durationMs,
      contributors: payload?.result?.metrics?.contributors ?? 0,
      tokens: payload?.result?.metrics?.tokens ?? 0,
      ok: status === 200 && payload?.ok === true,
    }
  })

  const durations = measurements.map((entry) => entry.durationMs)
  return {
    requests: measurements.length,
    concurrency: config.collapseConcurrency,
    failed: measurements.filter((entry) => !entry.ok).length,
    contributors: summarize(measurements.map((entry) => entry.contributors)),
    tokens: summarize(measurements.map((entry) => entry.tokens)),
    latencyMs: summarize(durations),
    throughputPerSecond: round(
      (durations.length / (durations.reduce((sum, value) => sum + value, 0) / 1000)) *
        (1 / 1),
      1,
    ),
  }
}

/* ------------------------------------------------------------------ */
/* Phase 3: Skalierung der Kohärenzmatrix                              */
/* ------------------------------------------------------------------ */

/**
 * Kombinierte Last: Kollapsanfragen werden ausgelöst, während dieselben Sitzungen noch
 * streamen. Damit misst die Latenz den Fall, der im laufenden Betrieb tatsächlich auftritt.
 */
async function phaseCombined(sessionCount, warmupMs = 2500) {
  const indexes = Array.from({ length: sessionCount }, (_, index) => index)
  const created = await pool(indexes, config.sessionConcurrency, (index) =>
    createSession(index + 1000),
  )
  const accepted = created.filter((entry) => entry.ok)

  const streaming = pool(accepted, accepted.length, (entry) => streamSession(entry.sessionId))
  await sleep(warmupMs)

  const collapse = await phaseCollapse(accepted.map((entry) => entry.sessionId))
  const streams = await streaming

  return {
    sessionCount: accepted.length,
    warmupMs,
    collapse,
    streamsCompleted: streams.filter((outcome) => outcome.status === 'complete').length,
    streamEvents: streams.reduce((sum, outcome) => sum + outcome.events, 0),
  }
}

const WORDS = [
  'superposition', 'gewicht', 'kollaps', 'modell', 'antwort', 'kanal', 'konvergenz', 'matrix',
  'adapter', 'latenz', 'protokoll', 'kohärenz', 'träger', 'ergänzung', 'randnotiz', 'vektor',
]

function syntheticText(seed, length = 180) {
  const words = []
  for (let index = 0; index < length; index += 1) {
    words.push(WORDS[(seed * 7 + index * 3 + (index % 5)) % WORDS.length])
  }
  return words.join(' ')
}

function phaseMatrix() {
  const sizes = [4, 8, 16, 32, 64, 128, 256]
  const optimized = []
  const naive = []

  for (const size of sizes) {
    const outputs = Array.from({ length: size }, (_, index) => ({
      modelId: `m${index}`,
      text: syntheticText(index),
    }))

    let start = performance.now()
    const cpuStart = process.cpuUsage()
    buildCoherenceMatrix(outputs)
    const cpu = process.cpuUsage(cpuStart)
    const wallMs = performance.now() - start
    optimized.push({
      models: size,
      pairs: size * (size - 1),
      ms: round(wallMs, 3),
      cpuMs: round((cpu.user + cpu.system) / 1000, 3),
      usPerPair: round(((cpu.user + cpu.system) / 1000 / (size * (size - 1))) * 1000, 2),
    })

    if (size === 64 || size === 256) {
      start = performance.now()
      for (const first of outputs) {
        for (const second of outputs) {
          if (first.modelId !== second.modelId) calculateTextSimilarity(first.text, second.text)
        }
      }
      naive.push({ models: size, pairs: size * (size - 1), ms: round(performance.now() - start, 3) })
    }
  }

  return { optimized, naive }
}

/* ------------------------------------------------------------------ */
/* Phase 4: Durchsatz einfacher HTTP-Endpunkte                         */
/* ------------------------------------------------------------------ */

async function phaseHttp() {
  const targets = Array.from({ length: config.httpRequests }, (_, index) =>
    index % 4 === 0 ? '/api/adapters' : index % 4 === 1 ? '/api/architecture' : index % 4 === 2 ? '/api/security' : '/api/health',
  )
  const started = performance.now()
  const results = await pool(targets, config.httpConcurrency, async (target) => {
    const began = performance.now()
    const { status } = await jsonRequest(`${config.base}${target}`)
    return { status, durationMs: performance.now() - began }
  })
  const wall = performance.now() - started
  return {
    requests: results.length,
    concurrency: config.httpConcurrency,
    failed: results.filter((entry) => entry.status !== 200).length,
    wallMs: round(wall),
    requestsPerSecond: round(results.length / (wall / 1000), 1),
    latencyMs: summarize(results.map((entry) => entry.durationMs)),
  }
}

/* ------------------------------------------------------------------ */
/* Bericht                                                             */
/* ------------------------------------------------------------------ */

function toMarkdown(report) {
  const ms = (value) => `${round(value, 1)} ms`
  const lines = []
  lines.push('# Lasttest der Superpositions-Middleware')
  lines.push('')
  lines.push(`- Zeitpunkt: ${report.at}`)
  lines.push(`- Ziel: ${report.config.base}`)
  lines.push(`- Konfiguration: ${report.config.sessions} Sitzungen, ${report.config.collapseRequests} Kollapsanfragen, ${report.config.httpRequests} HTTP-Anfragen`)
  lines.push('')
  lines.push('## 1. Nebenläufigkeit und Ereignispuffer')
  lines.push('')
  lines.push('| Kennzahl | Wert |')
  lines.push('| --- | --- |')
  lines.push(`| Sitzungen angenommen | ${report.streams.accepted} / ${report.streams.requested} |`)
  lines.push(`| Sitzungen abgeschlossen | ${report.streams.completed} |`)
  lines.push(`| Statusverteilung | ${JSON.stringify(report.streams.statuses)} |`)
  lines.push(`| Ereignisse gesamt | ${report.streams.totals.events} |`)
  lines.push(`| Textblöcke gesamt | ${report.streams.totals.chunks} |`)
  lines.push(`| gestörte Modellkanäle | ${report.streams.totals.failedProviders} |`)
  lines.push(`| Dauer bis Abschluss (P95) | ${ms(report.streams.completions.durationMs.p95)} |`)
  lines.push(`| erster Textblock (P95) | ${ms(report.streams.completions.firstChunkMs.p95)} |`)
  lines.push(`| Nachspielen aus dem Puffer geprüft | ${report.streams.replay.length} Sitzungen, ${report.streams.replayOk ? 'alle identisch' : 'ABWEICHUNGEN'} |`)
  lines.push(`| gekürzte Verläufe | ${report.streams.bandwidth.truncatedSessions} Sitzungen, ${report.streams.bandwidth.droppedEvents} ausgelagerte Ereignisse |`)
  lines.push(`| Nutzlast / Leitung | ${(report.streams.bandwidth.payloadChars / 1048576).toFixed(2)} MB / ${(report.streams.bandwidth.wireBytes / 1048576).toFixed(2)} MB (Faktor ${report.streams.bandwidth.ratio}) |`)
  lines.push('')
  lines.push('## 2. Latenz der Kollaps-Synthese')
  lines.push('')
  lines.push('| Kennzahl | Wert |')
  lines.push('| --- | --- |')
  lines.push(`| Anfragen / Parallelität | ${report.collapse.requests} / ${report.collapse.concurrency} |`)
  lines.push(`| Fehler | ${report.collapse.failed} |`)
  lines.push(`| Mittelwert | ${ms(report.collapse.latencyMs.mean)} |`)
  lines.push(`| P95 | ${ms(report.collapse.latencyMs.p95)} |`)
  lines.push(`| P99 | ${ms(report.collapse.latencyMs.p99)} |`)
  lines.push(`| Maximum | ${ms(report.collapse.latencyMs.max)} |`)
  lines.push(`| Durchsatz | ${report.collapse.throughputPerSecond} Anfragen/s |`)
  lines.push(`| Umfang der Eingaben | ${Math.round(report.collapse.tokens.mean)} Token im Mittel (${report.collapse.tokens.min}–${report.collapse.tokens.max}) |`)
  lines.push('')
  lines.push('## 2b. Kollaps-Latenz unter gleichzeitiger Stream-Last')
  lines.push('')
  lines.push(
    `${report.combined.sessionCount} Sitzungen streamen; ${report.combined.collapse.requests} Kollapsanfragen wurden ${report.combined.warmupMs} ms nach Start der Ströme ausgelöst und trafen auf noch laufende Kanäle.`,
  )
  lines.push('')
  lines.push('| Kennzahl | Wert |')
  lines.push('| --- | --- |')
  lines.push(`| Sitzungen abgeschlossen | ${report.combined.streamsCompleted} / ${report.combined.sessionCount} |`)
  lines.push(`| Ereignisse während der Messung | ${report.combined.streamEvents} |`)
  lines.push(`| Fehler | ${report.combined.collapse.failed} |`)
  lines.push(`| Mittelwert | ${ms(report.combined.collapse.latencyMs.mean)} |`)
  lines.push(`| P95 | ${ms(report.combined.collapse.latencyMs.p95)} |`)
  lines.push(`| P99 | ${ms(report.combined.collapse.latencyMs.p99)} |`)
  lines.push(`| Maximum | ${ms(report.combined.collapse.latencyMs.max)} |`)
  lines.push(`| Umfang der Eingaben | ${Math.round(report.combined.collapse.tokens.mean)} Token im Mittel — geringer als im Ruhezustand, weil die Kanäle noch streamen |`)
  lines.push('')
  lines.push('## 3. Skalierung der Kohärenzmatrix')
  lines.push('')
  lines.push('| Modelle | Paare | Matrix mit Zwischenspeicher | CPU-Zeit | je Paar | paarweise ohne Zwischenspeicher |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const entry of report.matrix.optimized) {
    const naive = report.matrix.naive.find((item) => item.models === entry.models)
    lines.push(
      `| ${entry.models} | ${entry.pairs} | ${entry.ms} ms | ${entry.cpuMs} ms | ${entry.usPerPair} µs | ${naive ? `${naive.ms} ms` : '—'} |`,
    )
  }
  lines.push('')
  lines.push('## 4. Durchsatz einfacher HTTP-Endpunkte')
  lines.push('')
  lines.push('| Kennzahl | Wert |')
  lines.push('| --- | --- |')
  lines.push(`| Anfragen / Parallelität | ${report.http.requests} / ${report.http.concurrency} |`)
  lines.push(`| Anfragen pro Sekunde | ${report.http.requestsPerSecond} |`)
  lines.push(`| P95 | ${ms(report.http.latencyMs.p95)} |`)
  lines.push(`| Fehler | ${report.http.failed} |`)
  lines.push('')
  lines.push('## 5. Speicher und Puffer am Ende des Laufs')
  lines.push('')
  lines.push('```json')
  lines.push(JSON.stringify(report.telemetry, null, 2))
  lines.push('```')
  lines.push('')
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Ablauf                                                              */
/* ------------------------------------------------------------------ */

const startedAt = performance.now()
console.log(`Lasttest gegen ${config.base} · ${config.sessions} Sitzungen · Adapter ${providerIds.join(', ')}`)

const reachable = await jsonRequest(`${config.base}/api/health`)
if (reachable.status !== 200) {
  console.error(`Ziel nicht erreichbar (HTTP ${reachable.status}). Läuft der Server auf ${config.base}?`)
  process.exit(1)
}
const architecture = (await jsonRequest(`${config.base}/api/architecture`)).payload
console.log(
  `Server: Kompression ${architecture?.transport?.compression ?? 'unbekannt'} · Puffergrenze ${architecture?.transport?.bufferLimit?.events ?? '?'} Ereignisse`,
)

const streams = await phaseStreams()
console.log(
  `Phase 1: ${streams.completed}/${streams.accepted} Sitzungen abgeschlossen · ${streams.totals.events} Ereignisse · Pufferprüfung ${streams.replayOk ? 'bestanden' : 'FEHLGESCHLAGEN'}`,
)

const collapse = await phaseCollapse(streams.sessionIds)
console.log(
  `Phase 2: ${collapse.requests} Kollapsanfragen · Mittel ${round(collapse.latencyMs.mean, 1)} ms · P95 ${round(collapse.latencyMs.p95, 1)} ms · P99 ${round(collapse.latencyMs.p99, 1)} ms`,
)

const matrix = phaseMatrix()
console.log(`Phase 3: Matrix bis 256 Modelle gemessen`)

const combined = await phaseCombined(Number(args['combined-sessions'] ?? 60))
console.log(
  `Phase 2b: Kollaps unter Last · Mittel ${round(combined.collapse.latencyMs.mean, 1)} ms · P95 ${round(combined.collapse.latencyMs.p95, 1)} ms · P99 ${round(combined.collapse.latencyMs.p99, 1)} ms`,
)

const http = await phaseHttp()
console.log(`Phase 4: ${http.requestsPerSecond} Anfragen/s bei ${http.concurrency} parallelen Zugriffen`)

const telemetry = (await jsonRequest(`${config.base}/api/telemetry`)).payload

const report = {
  at: new Date().toISOString(),
  durationMs: round(performance.now() - startedAt),
  config,
  streams,
  collapse,
  matrix,
  combined,
  http,
  serverInfo: {
    compression: architecture?.transport?.compression ?? null,
    bufferLimit: architecture?.transport?.bufferLimit ?? null,
  },
  telemetry,
}

const outDir = path.isAbsolute(config.outDir) ? config.outDir : path.join(projectRoot, config.outDir)
mkdirSync(outDir, { recursive: true })
const stamp = report.at.replace(/[:.]/g, '-')
const jsonPath = path.join(outDir, `loadtest-${stamp}.json`)
const mdPath = path.join(outDir, `loadtest-${stamp}.md`)
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
writeFileSync(mdPath, `${toMarkdown(report)}\n`, 'utf8')

console.log(`Gesamtdauer ${round(report.durationMs / 1000, 1)} s`)
console.log(`Bericht: ${path.relative(projectRoot, mdPath)}`)
console.log(`Rohdaten: ${path.relative(projectRoot, jsonPath)}`)

const hardFailure = streams.completed < streams.accepted || !streams.replayOk || collapse.failed > 0
process.exit(hardFailure ? 1 : 0)
