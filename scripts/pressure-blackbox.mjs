#!/usr/bin/env node
/**
 * Blinder Drucktest des laufenden Systems (Black Box).
 *
 * Diese Suite kennt nur die öffentliche Schnittstelle. Sie prüft das System
 * genau in dem Zustand, in dem es läuft: Kapazität an der Grenze, Kanal-
 * integrität für späte Empfänger, Kollaps-Verhalten unter Dauerlast,
 * fehlerhafte und bösartige Eingaben, Zugriffsschutz und Zustandslogik.
 *
 * Aufruf:
 *   node scripts/pressure-blackbox.mjs --base=https://... [--sessions=140] [--channels=20] [--collapse=24]
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { WebSocket } from 'ws'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const base = arg('base', 'http://127.0.0.1:3700').replace(/\/$/, '')
const sessions = Number(arg('sessions', '140'))
const channels = Number(arg('channels', '20'))
const collapseConcurrency = Number(arg('collapse', '24'))
const label = arg('label', new URL(base).hostname)

const report = {
  base,
  label,
  at: new Date().toISOString(),
  phases: {},
  findings: [],
}

const finding = (id, severity, title, evidence) => {
  report.findings.push({ id, severity, title, evidence })
}

const pct = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return Math.round(sorted[Math.max(0, idx)] * 10) / 10
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ereignistypen, mit denen eine Sitzung auf dem Kanal abgeschlossen wird. */
const END_TYPES = new Set(['end', 'session:end', 'session:done', 'stream:end'])

async function jsonRequest(pathname, { method = 'GET', body, timeout = 25000, raw } = {}) {
  const started = performance.now()
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof raw === 'string' ? raw : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  return { status: res.status, ms: performance.now() - started, text, json: parsed, headers: res.headers }
}

const startSession = (prompt) => jsonRequest('/api/superposition', { method: 'POST', body: { prompt } })

function openSocket(wsPath, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, 'ws')}${wsPath}`
    const state = { events: [], bytes: 0, openedAt: null, closedCode: null, error: null, ws: null }
    const socket = new WebSocket(url)
    state.ws = socket
    const timer = setTimeout(() => {
      state.timedOut = true
      if (!state.openedAt) state.error = 'Kanal kam nicht zustande (kein open)'
      try {
        socket.terminate()
      } catch {}
      resolve(state)
    }, timeoutMs)

    socket.on('open', () => {
      state.openedAt = performance.now()
    })
    socket.on('message', (data) => {
      state.bytes += data.length
      const text = data.toString()
      for (const piece of text.split('\n')) {
        if (!piece.trim()) continue
        try {
          state.events.push(JSON.parse(piece))
        } catch {
          state.events.push({ __unparsed: piece.slice(0, 120) })
        }
      }
    })
    socket.on('error', (error) => {
      state.error = String(error?.message ?? error)
    })
    socket.on('close', (code) => {
      state.closedCode = code
      clearTimeout(timer)
      resolve(state)
    })
  })
}

function waitForEnd(state, maxMs) {
  return new Promise((resolve) => {
    if (state.events.some((e) => END_TYPES.has(e?.type))) {
      try {
        state.ws.close()
      } catch {}
      return resolve(state)
    }
    const started = performance.now()
    const timer = setInterval(() => {
      const ended = state.events.some((e) => END_TYPES.has(e?.type))
      if (ended || performance.now() - started > maxMs) {
        clearInterval(timer)
        try {
          state.ws.close()
        } catch {}
        setTimeout(() => resolve(state), 120)
      }
    }, 200)
  })
}

async function readSse(ssePath, maxMs = 15000, joinDelayMs = 0) {
  if (joinDelayMs) await sleep(joinDelayMs)
  const state = { events: [], bytes: 0, status: null }
  const res = await fetch(`${base}${ssePath}`, { signal: AbortSignal.timeout(maxMs + 4000) })
  state.status = res.status
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const started = performance.now()
  while (performance.now() - started < maxMs) {
    const { value, done } = await Promise.race([
      reader.read(),
      sleep(500).then(() => ({ value: null, done: false })),
    ])
    if (done) break
    if (!value) continue
    state.bytes += value.length
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const dataLine = part
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('')
      if (!dataLine) continue
      try {
        state.events.push(JSON.parse(dataLine))
      } catch {
        state.events.push({ __unparsed: dataLine.slice(0, 120) })
      }
    }
    if (state.events.some((e) => e?.type === 'end')) break
  }
  try {
    reader.cancel()
  } catch {}
  return state
}

const hashEvents = (events) =>
  crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex').slice(0, 16)

/* ---------------------------------------------------------------- Phase A -- */
async function phaseState() {
  const paths = ['/', '/manus-routes.json', '/api/health', '/api/access', '/api/architecture', '/api/telemetry', '/api/adapters', '/api/nonexistent-probe']
  const rows = []
  for (const p of paths) {
    try {
      const r = await jsonRequest(p, { timeout: 20000 })
      rows.push({
        path: p,
        status: r.status,
        ms: Math.round(r.ms),
        contentType: r.headers.get('content-type'),
        csp: r.headers.get('content-security-policy'),
        xcto: r.headers.get('x-content-type-options'),
        snapshotKeys: r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 12) : null,
      })
    } catch (error) {
      rows.push({ path: p, error: String(error?.message ?? error) })
    }
  }
  report.phases.state = rows

  const telemetry = rows.find((r) => r.path === '/api/telemetry')
  if (telemetry?.status === 200) {
    const t = (await jsonRequest('/api/telemetry')).json
    report.phases.baselineTelemetry = t
  }
  const missing = rows.find((r) => r.path === '/api/nonexistent-probe')
  if (missing?.status === 200) {
    finding('A1', 'high', 'Unbekannter API-Pfad liefert 200 statt 404', JSON.stringify(missing))
  }
}

/* ---------------------------------------------------------------- Phase B -- */
async function phaseCapacity() {
  const prompts = Array.from({ length: sessions }, (_, i) => `Drucktest ${i}: ${crypto.randomUUID().slice(0, 8)}`)
  const started = performance.now()
  const results = await Promise.all(
    prompts.map(async (p) => {
      try {
        const r = await startSession(p)
        return { status: r.status, ms: r.ms, sessionId: r.json?.sessionId ?? null }
      } catch (error) {
        return { status: -1, ms: 0, error: String(error?.message ?? error) }
      }
    }),
  )
  const byStatus = {}
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

  report.phases.capacity = {
    requested: sessions,
    byStatus,
    acceptMs: { p50: pct(results.filter((r) => r.status === 200).map((r) => r.ms), 50), p95: pct(results.filter((r) => r.status === 200).map((r) => r.ms), 95) },
    wallMs: Math.round(performance.now() - started),
    accepted: results.filter((r) => r.status === 200).length,
  }

  if ((byStatus['500'] ?? 0) > 0 || (byStatus[-1] ?? 0) > 0) {
    finding('B1', 'high', '5xx oder Netzwerkfehler beim Sitzungsstart unter Druck', JSON.stringify(byStatus))
  }
  if (!byStatus['429']) {
    finding('B2', 'medium', 'Keine Kapazitätsgrenze sichtbar: keine 429 trotz mehr Startanfragen als Sitzungen erlaubt', JSON.stringify(byStatus))
  }

  // Telemetrie während der Last prüfen
  const during = await jsonRequest('/api/telemetry')
  report.phases.capacityTelemetry = during.json

  // Erholung: nach der Last muss der Dienst wieder Sitzungen annehmen.
  // Gemessen wird, wie lange die Kapazität blockiert bleibt.
  const drainStarted = performance.now()
  let recoveredAfterMs = null
  let lastStatus = null
  for (let i = 0; i < 45; i += 1) {
    const attempt = await startSession(`Erholungsprüfung ${i}`)
    lastStatus = attempt.status
    if (attempt.status === 200) {
      recoveredAfterMs = Math.round(performance.now() - drainStarted)
      report.phases.recovery = { status: 200, drainedAfterMs: recoveredAfterMs, sampleSessionId: attempt.json?.sessionId ?? null }
      return attempt.json?.sessionId ?? null
    }
    await sleep(2000)
  }
  report.phases.recovery = { status: lastStatus, drainedAfterMs: null, waitedMs: Math.round(performance.now() - drainStarted) }
  finding('B3', 'critical', 'Dienst nimmt nach der Lastspitze dauerhaft keine neuen Sitzungen mehr an (keine Erholung innerhalb von 90 s)', JSON.stringify(report.phases.recovery))
  return null
}

/* ---------------------------------------------------------------- Phase C -- */
async function phaseChannelIntegrity(seedSessionId) {
  const early = []
  const sessionIds = []
  for (let attempt = 0; attempt < 6 && sessionIds.length < channels; attempt += 1) {
    for (let i = sessionIds.length; i < channels; i += 1) {
      try {
        const r = await startSession(`Kanaltest ${i}`)
        if (r.status === 200 && r.json?.sessionId) sessionIds.push(r.json)
      } catch {}
    }
    if (sessionIds.length < channels) await sleep(5000)
  }
  if (!sessionIds.length) {
    report.phases.channels = { error: 'keine Sitzung für den Kanaltest zustande gekommen' }
    finding('C0', 'critical', 'Für den Kanaltest konnte keine Sitzung mehr angelegt werden', 'alle Startversuche wurden abgelehnt')
    return []
  }
  if (sessionIds.length < channels) {
    finding('C4', 'medium', 'Nicht alle Kanaltestsitzungen konnten angelegt werden', `${sessionIds.length} von ${channels}`)
  }

  // Frühe Empfänger: sofort verbinden.
  for (const s of sessionIds) {
    const st = openSocket(s.wsPath ?? `/ws/${s.sessionId}`)
    early.push({ session: s, promise: st })
  }
  const earlyStates = await Promise.all(early.map((e) => e.promise))

  // Späte Empfänger: 6 Sekunden später verbinden und Verlauf nachspielen lassen.
  await sleep(6000)
  const lateStates = await Promise.all(
    sessionIds.slice(0, Math.min(8, sessionIds.length)).map((s) => openSocket(s.wsPath ?? `/ws/${s.sessionId}`)),
  )

  const earlyDone = await Promise.all(earlyStates.map((st) => waitForEnd(st, 25000)))
  const lateDone = await Promise.all(lateStates.map((st) => waitForEnd(st, 25000)))

  const comparisons = []
  // Telemetrie wird nur an gerade verbundene Empfänger gesendet und ist nicht
  // Teil des nachgespielten Verlaufs. Verglichen wird daher der Inhalt.
  const contentOf = (events) => events.filter((e) => e?.type !== 'telemetry')
  for (let i = 0; i < Math.min(earlyDone.length, lateDone.length); i += 1) {
    const a = earlyDone[i]
    const b = lateDone[i]
    const ac = contentOf(a.events)
    const bc = contentOf(b.events)
    const sharingPrefix = JSON.stringify(ac) === JSON.stringify(bc)
    const shared = new Set(ac.map((e) => JSON.stringify(e)))
    const missedByLate = ac.filter((e) => !shared.has(JSON.stringify(e))).length
    comparisons.push({
      index: i,
      earlyEvents: a.events.length,
      lateEvents: b.events.length,
      earlyContent: ac.length,
      lateContent: bc.length,
      telemetryOnlyEarly: a.events.length - ac.length,
      telemetryOnlyLate: b.events.length - bc.length,
      identical: sharingPrefix,
      lateHash: hashEvents(bc),
      earlyHash: hashEvents(ac),
      lateMissingFromEarlySet: bc.filter((e) => !shared.has(JSON.stringify(e))).length,
      earlyMissingFromLateSet: missedByLate,
      earlyError: a.error,
      lateError: b.error,
    })
  }

  const mismatch = comparisons.filter((c) => !c.identical)
  report.phases.channels = {
    sessions: sessionIds.length,
    earlyErrors: earlyDone.filter((s) => s.error).length,
    lateErrors: lateDone.filter((s) => s.error).length,
    comparisons: comparisons.slice(0, 8),
    identicalCount: comparisons.length - mismatch.length,
  }
  if (mismatch.length) {
    finding('C1', 'high', 'Später hinzutretende Empfänger erhalten einen abweichenden Inhaltsverlauf', JSON.stringify(mismatch.slice(0, 3)))
  }
  const telemetryMismatch = comparisons.filter((c) => c.telemetryOnlyEarly !== c.telemetryOnlyLate)
  if (telemetryMismatch.length) {
    finding('C5', 'info', 'Telemetrieereignisse gehören nicht zum nachgespielten Verlauf', JSON.stringify(telemetryMismatch.slice(0, 2)))
  }
  if (earlyDone.some((s) => s.error)) {
    finding('C2', 'high', 'WebSocket-Kanal bricht ab oder kommt nicht zustande', JSON.stringify(earlyDone.filter((s) => s.error).slice(0, 2)))
  }

  // SSE-Rückfall gegenprüfen (Vollständigkeit der Ereignisse).
  const sseSession = sessionIds[0]
  const sse = await readSse(sseSession.ssePath ?? `/api/stream/${sseSession.sessionId}`, 15000)
  report.phases.sse = {
    status: sse.status,
    events: sse.events.length,
    bytes: sse.bytes,
    hasEnd: sse.events.some((e) => e?.type === 'end'),
  }
  if (sse.status !== 200 || sse.events.length === 0) {
    finding('C3', 'medium', 'SSE-Rückfall liefert keine Ereignisse', JSON.stringify(report.phases.sse))
  }
  return sessionIds
}

/* ---------------------------------------------------------------- Phase D -- */
async function phaseCollapseUnderLoad(sessionIds) {
  if (!sessionIds?.length) {
    report.phases.collapse = { error: 'keine Sitzung verfügbar' }
    return
  }
  const timings = []
  const failures = []

  const load = async (index) => {
    const s = sessionIds[index % sessionIds.length]
    const started = performance.now()
    const body = { sessionId: s.sessionId, weights: {} }
    if (index % 3 === 0) {
      body.consensus = { jaccardThreshold: 0.1, minAgreeingModels: 1 }
    }
    try {
      const r = await jsonRequest('/api/collapse', { method: 'POST', body, timeout: 30000 })
      timings.push(performance.now() - started)
      if (r.status !== 200) failures.push({ status: r.status, text: r.text.slice(0, 160) })
    } catch (error) {
      failures.push({ status: -1, text: String(error?.message ?? error) })
    }
  }

  const rounds = Math.ceil(collapseConcurrency / 4)
  const wallStarted = performance.now()
  for (let i = 0; i < rounds; i += 1) {
    await Promise.all(Array.from({ length: Math.min(4, collapseConcurrency) }, (_, k) => load(i * 4 + k)))
  }
  report.phases.collapse = {
    requests: timings.length,
    p50: pct(timings, 50),
    p95: pct(timings, 95),
    p99: pct(timings, 99),
    max: timings.length ? Math.round(Math.max(...timings)) : null,
    failures: failures.slice(0, 5),
    wallMs: Math.round(performance.now() - wallStarted),
  }
  if (failures.length) {
    finding('D1', 'high', 'Kollaps scheitert unter gleichzeitiger Last', JSON.stringify(failures.slice(0, 3)))
  }
  if (pct(timings, 95) > 1500) {
    finding('D2', 'medium', 'Kollaps-Latenz P95 über 1,5 s', `P95=${pct(timings, 95)} ms bei ${timings.length} Anfragen`)
  }
}

/* ---------------------------------------------------------------- Phase E -- */
async function phaseMaliciousInputs() {
  const cases = [
    ['ungültiges JSON', '{ das ist kein json', 'raw'],
    ['falscher Content-Type', JSON.stringify({ prompt: 'x' }), 'text/plain'],
    ['leerer Body', '', 'empty'],
    ['fehlender Prompt', JSON.stringify({}), 'json'],
    ['Prompt als Zahl', JSON.stringify({ prompt: 42 }), 'json'],
    ['Prompt als Objekt', JSON.stringify({ prompt: { a: 1 } }), 'json'],
    ['Prompt als Array', JSON.stringify({ prompt: ['a', 'b'] }), 'json'],
    ['riesiger Prompt (2 MB)', JSON.stringify({ prompt: 'x'.repeat(2 * 1024 * 1024) }), 'json'],
    ['Prototype-Pollution', JSON.stringify({ prompt: 'pp', __proto__: { polluted: true }, constructor: { prototype: { x: 1 } } }), 'json'],
    ['unbekannte Adapter', JSON.stringify({ prompt: 'x', providerIds: ['gibt-es-nicht', ''] }), 'json'],
    ['Gewichte negativ/riesig', JSON.stringify({ sessionId: 'egal', weights: { openai: -5, anthropic: 1e9 } }), 'json'],
    ['Steuerzeichen und NUL', JSON.stringify({ prompt: 'a\u0000b\u0007c' }), 'json'],
    ['Emoji-Flut', JSON.stringify({ prompt: '🤖'.repeat(5000) }), 'json'],
    ['XSS-Vektor', JSON.stringify({ prompt: '<script>alert(1)</script><img src=x onerror=alert(1)>' }), 'json'],
    ['SQL/NoSQL-Vektor', JSON.stringify({ prompt: "' OR 1=1 -- {\"$ne\":null}" }), 'json'],
    ['Kollaps ohne Sitzung', JSON.stringify({ weights: {} }), 'json'],
    ['Kollaps unbekannte Sitzung', JSON.stringify({ sessionId: '../../etc/passwd', weights: {} }), 'json'],
    ['Kollaps falsche Sitzung', JSON.stringify({ sessionId: crypto.randomUUID(), weights: {} }), 'json'],
    ['Kopfzeilen-Umgehung', JSON.stringify({ prompt: 'x' }), 'json', { 'X-Forwarded-For': '127.0.0.1', 'X-Original-URL': '/api/superposition' }],
  ]

  const results = []
  for (const [name, payload, mode, extraHeaders] of cases) {
    const target = name.startsWith('Kollaps') ? '/api/collapse' : '/api/superposition'
    const started = performance.now()
    try {
      const res = await fetch(`${base}${target}`, {
        method: 'POST',
        headers: {
          ...(mode === 'json' ? { 'Content-Type': 'application/json' } : {}),
          ...(mode === 'text/plain' ? { 'Content-Type': 'text/plain' } : {}),
          ...(extraHeaders ?? {}),
        },
        body: mode === 'empty' ? undefined : payload,
        signal: AbortSignal.timeout(30000),
      })
      const text = await res.text()
      const leaked = /at\s+\w+\s+\(|node:internal|\/home\/ubuntu|stack|Error:/.test(text)
      results.push({
        name,
        target,
        status: res.status,
        ms: Math.round(performance.now() - started),
        leakLike: leaked,
        reflected: text.includes('<script>alert(1)</script>'),
        snippet: text.slice(0, 140).replace(/\s+/g, ' '),
      })
    } catch (error) {
      results.push({ name, target, status: -1, error: String(error?.message ?? error) })
    }
  }

  report.phases.malicious = results

  const serverErrors = results.filter((r) => r.status === 500 || r.status === -1)
  if (serverErrors.length) {
    finding('E1', 'high', 'Serverfehler (500/Netzwerk) bei fehlerhaften Eingaben', JSON.stringify(serverErrors.slice(0, 4)))
  }
  const leaks = results.filter((r) => r.leakLike)
  if (leaks.length) {
    finding('E2', 'high', 'Antwort enthält interne Details oder Stackspuren', JSON.stringify(leaks.slice(0, 3)))
  }
  const reflected = results.filter((r) => r.reflected)
  if (reflected.length) {
    finding('E3', 'medium', 'Eingabe wird ungefiltert zurückgespiegelt', JSON.stringify(reflected.slice(0, 2)))
  }
  const accepted = results.filter((r) => r.status === 200 && r.name !== 'Kollaps ohne Sitzung')
  report.phases.maliciousAccepted = accepted.map((a) => `${a.name} → ${a.status}`)
}

/* ---------------------------------------------------------------- Phase F -- */
async function phaseAccessControl() {
  const probe = await jsonRequest('/api/access')
  const status = probe.json
  report.phases.access = status

  // Schlüsselmaterial im Frontend-Bundle suchen.
  const html = await jsonRequest('/', { timeout: 20000 })
  const assetMatch = html.text.match(/\/assets\/[^"']+\.js/)
  let bundleInfo = null
  if (assetMatch) {
    const bundle = await jsonRequest(assetMatch[0], { timeout: 25000 })
    const suspicious = ['ABSTRACT_API_KEY', 'x-access-key', 'apiKey', 'Bearer ', 'sk-', 'secret']
      .filter((needle) => bundle.text.includes(needle))
    bundleInfo = { asset: assetMatch[0], sizeKb: Math.round(bundle.text.length / 1024), suspiciousStrings: suspicious }
  }
  report.phases.bundle = bundleInfo

  if (!status?.required) {
    finding('F1', 'high', 'Schreibende Endpunkte sind ohne Schlüssel erreichbar (Zugangsschutz inaktiv)', JSON.stringify(status))
  }
  if (bundleInfo?.suspiciousStrings?.length) {
    finding('F2', 'high', 'Verdächtige Zeichenketten im Frontend-Bundle', JSON.stringify(bundleInfo))
  }
}

/* ---------------------------------------------------------------- Phase G -- */
async function phaseStateLogic() {
  // Sitzung anlegen, doppelt gleichzeitig kollabieren, danach Zustand prüfen.
  const start = await startSession('Zustandslogik: doppelter Kollaps')
  if (start.status !== 200) {
    report.phases.stateLogic = { error: `Start fehlgeschlagen: ${start.status}` }
    return
  }
  const id = start.json.sessionId
  const [a, b] = await Promise.all([
    jsonRequest('/api/collapse', { method: 'POST', body: { sessionId: id, weights: {} }, timeout: 30000 }),
    jsonRequest('/api/collapse', { method: 'POST', body: { sessionId: id, weights: {} }, timeout: 30000 }),
  ])
  const first = a.json?.result ? JSON.stringify(a.json.result) : null
  const second = b.json?.result ? JSON.stringify(b.json.result) : null
  report.phases.stateLogic = {
    sessionId: id,
    raceStatus: [a.status, b.status],
    raceIdentical: first !== null && first === second,
    firstMetrics: a.json?.result?.metrics ?? null,
    resultKeys: a.json?.result ? Object.keys(a.json.result) : null,
  }
  const result = a.json?.result
  if (result && !result.consensus) {
    finding('G1', 'info', 'Kollaps liefert keinen Konsensblock (Funktionsstand der laufenden Instanz)', JSON.stringify(Object.keys(result)))
  }
  if (result?.metrics && result.metrics.convergence === undefined) {
    finding('G2', 'info', 'Kennzahlen enthalten keinen Konvergenz-Index', JSON.stringify(Object.keys(result.metrics)))
  }
}

/* ------------------------------------------------------------------- Lauf -- */
async function main() {
  const health = await jsonRequest('/api/health', { timeout: 20000 }).catch((e) => ({ status: -1, error: String(e) }))
  report.reachable = health.status === 200
  if (!report.reachable) {
    finding('S0', 'critical', 'Zielsystem nicht erreichbar', JSON.stringify(health))
    finish()
    return
  }

  await phaseState()
  await phaseAccessControl()
  const afterLoadSession = await phaseCapacity()
  const sessionIds = await phaseChannelIntegrity(afterLoadSession)
  await phaseCollapseUnderLoad(sessionIds)
  await phaseMaliciousInputs()
  await phaseStateLogic()

  const finalTelemetry = await jsonRequest('/api/telemetry').catch(() => null)
  report.finalTelemetry = finalTelemetry?.json ?? null
  finish()
}

function finish() {
  const dir = path.join(process.cwd(), 'reports', 'pressure')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `pressure-${label}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 2))

  const lines = []
  lines.push(`# Blinder Drucktest — ${label}`)
  lines.push('')
  lines.push(`Ziel: ${base}`)
  lines.push(`Zeitpunkt: ${report.at}`)
  lines.push('')
  lines.push('## Befunde')
  if (!report.findings.length) lines.push('- keine Befunde')
  for (const f of report.findings) lines.push(`- **[${f.severity}] ${f.id} ${f.title}** — ${f.evidence}`)
  lines.push('')
  lines.push('## Kennzahlen')
  lines.push('```json')
  lines.push(JSON.stringify({ capacity: report.phases.capacity, recovery: report.phases.recovery, channels: report.phases.channels && { sessions: report.phases.channels.sessions, identical: report.phases.channels.identicalCount, earlyErrors: report.phases.channels.earlyErrors, lateErrors: report.phases.channels.lateErrors }, collapse: report.phases.collapse, sse: report.phases.sse, access: report.phases.access, malicious: report.phases.malicious?.map((m) => `${m.status} ${m.name}`) }, null, 2))
  lines.push('```')
  const mdFile = file.replace(/\.json$/, '.md')
  fs.writeFileSync(mdFile, lines.join('\n'))
  console.log(`Bericht: ${file}`)
  console.log(`Bericht: ${mdFile}`)
  console.log(lines.join('\n'))
}

main().catch((error) => {
  report.fatal = String(error?.stack ?? error)
  finding('S9', 'critical', 'Drucktest-Suite selbst abgebrochen', String(report.fatal).slice(0, 400))
  finish()
})
