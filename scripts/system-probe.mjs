#!/usr/bin/env node
/**
 * Funktions- und Zugriffssonde (Black Box).
 *
 * Prüft am laufenden System, welche Funktionen tatsächlich aktiv sind, ob
 * schreibende Endpunkte offen stehen und wie sich der Dienst unter
 * Zugriff von außen verändert. Fremdzustand wird nach dem Test wieder
 * hergestellt.
 *
 * Aufruf: node scripts/system-probe.mjs --base=https://... [--destructive]
 */

import { WebSocket } from 'ws'

const args = process.argv.slice(2)
const arg = (n, f) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? f
const base = arg('base', 'https://abstractbg-qehn8ouj.manus.space').replace(/\/$/, '')
const destructive = args.includes('--destructive')
const out = { base, at: new Date().toISOString(), destructive, results: {}, findings: [] }
const say = (id, severity, title, evidence) => out.findings.push({ id, severity, title, evidence })

async function req(path, { method = 'GET', body, timeout = 25000 } = {}) {
  const started = performance.now()
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, ms: Math.round(performance.now() - started), json, text }
}

/* 1. Funktionsstand über eine echte Sitzung */
async function functionalState() {
  const start = await req('/api/superposition', { method: 'POST', body: { prompt: 'Funktionssonde: Konsens und Kohärenz' } })
  if (start.status !== 200) {
    say('P1', 'critical', 'Sitzung konnte nicht angelegt werden', `HTTP ${start.status}: ${start.text.slice(0, 120)}`)
    out.results.functional = { startStatus: start.status }
    return null
  }
  const id = start.json.sessionId
  const wsStarted = performance.now()
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}${start.json.wsPath}`)
  let handshakeMs = null
  await new Promise((resolve) => {
    socket.on('open', () => {
      handshakeMs = Math.round(performance.now() - wsStarted)
      resolve()
    })
    socket.on('error', resolve)
    setTimeout(resolve, 12000)
  })
  await new Promise((r) => setTimeout(r, 15000))
  try {
    socket.close()
  } catch {}

  const collapse = await req('/api/collapse', { method: 'POST', body: { sessionId: id, weights: {} } })
  const result = collapse.json?.result ?? null
  out.results.functional = {
    startStatus: start.status,
    wsHandshakeMs: handshakeMs,
    collapseStatus: collapse.status,
    collapseMs: collapse.ms,
    resultKeys: result ? Object.keys(result) : null,
    metricsKeys: result?.metrics ? Object.keys(result.metrics) : null,
    hasConsensus: Boolean(result?.consensus),
    consensusSuppported: Array.isArray(result?.consensus?.supported) ? result.consensus.supported.length : null,
    consensusIsolated: Array.isArray(result?.consensus?.isolated) ? result.consensus.isolated.length : null,
    matrixSize: Array.isArray(result?.coherence) ? result.coherence.length : null,
    protocolSteps: Array.isArray(result?.protocol) ? result.protocol.length : null,
  }
  if (result && !result.consensus) {
    say('P2', 'medium', 'Laufende Instanz liefert keinen Konsensblock', 'Der deployte Stand weicht vom aktuellen Entwicklungsstand ab (Konsensfilterung fehlt).')
  }
  return id
}

/* 2. Zugriffsschutz und Schreibzugriff */
async function accessState() {
  const access = await req('/api/access')
  out.results.access = { status: access.status, body: access.json }

  const before = await req('/api/adapters')
  const countBefore = before.json?.adapters?.length ?? null
  out.results.adaptersBefore = {
    status: before.status,
    count: countBefore,
    builtIns: before.json?.adapters?.filter?.((a) => a.builtIn).map((a) => a.id) ?? null,
    vaultKeys: before.json?.adapters?.map?.((a) => a.hasKey ?? null) ?? null,
  }

  // Reversibler Schreibtest: eigenen Adapter anlegen, umschalten, löschen.
  const label = `probe-${Date.now().toString(36)}`
  const created = await req('/api/adapters', {
    method: 'POST',
    body: { label, vendor: 'probe', persona: 'Prüfadapter', endpoint: 'https://example.invalid/v1/chat', apiKey: 'probe-key-nicht-echt', weightDefault: 10 },
  })
  out.results.writeProbe = { createStatus: created.status, createdId: created.json?.adapter?.id ?? created.json?.id ?? null, body: created.text.slice(0, 160) }
  if (created.status === 200 || created.status === 201) {
    say('P3', access.json?.required ? 'high' : 'critical', 'Schreibende Schnittstelle ohne Zugangsschlüssel nutzbar', `POST /api/adapters → HTTP ${created.status} (Zugangsschutz: ${JSON.stringify(access.json?.scheme ?? access.json?.required)})`)
    const id = created.json?.adapter?.id ?? created.json?.id
    if (id) {
      const toggled = await req(`/api/adapters/${id}`, { method: 'PATCH', body: { enabled: false } })
      out.results.writeProbe.toggleStatus = toggled.status
      const removed = await req(`/api/adapters/${id}`, { method: 'DELETE' })
      out.results.writeProbe.deleteStatus = removed.status
      const after = await req('/api/adapters')
      out.results.writeProbe.countAfter = after.json?.adapters?.length ?? null
      out.results.writeProbe.restored = (after.json?.adapters?.length ?? -1) === countBefore
      if (!out.results.writeProbe.restored) {
        say('P4', 'high', 'Fremdzustand nicht wiederherstellbar: Adapter blieb zurück', JSON.stringify(out.results.writeProbe))
      }
    }
  }

  // Schlüsselmaterial im ausgelieferten Frontend suchen.
  const html = await req('/', { timeout: 20000 })
  const asset = html.text.match(/\/assets\/[^"']+\.js/)
  if (asset) {
    const bundle = await req(asset[0], { timeout: 25000 })
    const hits = {}
    for (const needle of ['ABSTRACT_API_KEY', 'x-access-key', 'accessKey', 'Bearer ', 'sk-', 'PRIVATE KEY']) {
      if (bundle.text.includes(needle)) hits[needle] = bundle.text.split(needle).length - 1
    }
    out.results.bundle = { asset: asset[0], kb: Math.round(bundle.text.length / 1024), hits }
  }
}

/* 3. Messwerte der Telemetrie */
async function telemetryState() {
  const endpoints = ['/api/health', '/api/adapters', '/api/telemetry', '/api/architecture']
  const latency = {}
  for (const path of endpoints) {
    const runs = []
    for (let i = 0; i < 3; i += 1) {
      const r = await req(path)
      runs.push(r.ms)
      await new Promise((res) => setTimeout(res, 200))
    }
    latency[path] = runs
  }
  out.results.latency = latency

  const samples = []
  for (let i = 0; i < 5; i += 1) {
    const r = await req('/api/telemetry')
    samples.push({ status: r.status, ms: r.ms })
    await new Promise((res) => setTimeout(res, 400))
  }
  const body = (await req('/api/telemetry')).json
  out.results.telemetry = { samples, body }
  const p95ish = Math.max(...samples.map((s) => s.ms))
  if (p95ish > 800) say('P5', 'medium', 'Telemetrieendpunkt antwortet langsam', `max ${p95ish} ms über ${samples.length} Messungen`)
}

/* 4. Zerbrechlichkeit eingebauter Adapter (nur mit --destructive) */
async function destructiveState() {
  if (!destructive) return
  const list = await req('/api/adapters')
  const builtIn = list.json?.adapters?.find((a) => a.builtIn)
  if (!builtIn) return
  const removed = await req(`/api/adapters/${builtIn.id}`, { method: 'DELETE' })
  const after = await req('/api/adapters')
  out.results.builtInDelete = { id: builtIn.id, deleteStatus: removed.status, stillPresent: (after.json?.adapters ?? []).some((a) => a.id === builtIn.id) }
  if (removed.status < 300 && !out.results.builtInDelete.stillPresent) {
    say('P6', 'high', 'Eingebauter Adapter ist löschbar und fällt dauerhaft aus', JSON.stringify(out.results.builtInDelete))
  }
}

async function main() {
  const health = await req('/api/health')
  out.results.health = { status: health.status, body: health.json }
  if (health.status !== 200) {
    say('P0', 'critical', 'Zielsystem nicht erreichbar', JSON.stringify(out.results.health))
  } else {
    await functionalState()
    await accessState()
    await telemetryState()
    await destructiveState()
  }
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  out.fatal = String(error?.stack ?? error)
  console.log(JSON.stringify(out, null, 2))
})
