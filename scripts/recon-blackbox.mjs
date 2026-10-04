#!/usr/bin/env node
/**
 * Blinde Bestandsaufnahme des laufenden Systems.
 *
 * Zweck: Ermitteln, welche Fähigkeiten das deployte System tatsächlich hat,
 * ohne den Quellcode als Grundlage zu nehmen. Es wird ausschließlich über
 * öffentliche Endpunkte beobachtet, was das System über sich selbst ausgibt.
 *
 * Aufruf: node scripts/recon-blackbox.mjs --base=https://...
 */

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const base = arg('base', 'https://abstractbg-qehn8ouj.manus.space').replace(/\/$/, '')
const out = { base, at: new Date().toISOString(), probes: {} }

async function probe(path) {
  const started = performance.now()
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20000) })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 200)
    }
    out.probes[path] = {
      status: res.status,
      ms: Math.round(performance.now() - started),
      server: res.headers.get('server'),
      contentType: res.headers.get('content-type'),
      body,
    }
  } catch (error) {
    out.probes[path] = { error: String(error?.message ?? error) }
  }
}

for (const p of ['/api/health', '/api/architecture', '/api/access', '/api/adapters', '/api/telemetry']) {
  await probe(p)
}

// Funktionsstand über eine echte Sitzung ermitteln.
try {
  const start = await fetch(`${base}/api/superposition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Blinde Bestandsaufnahme: was kann dieses System?' }),
    signal: AbortSignal.timeout(20000),
  })
  const session = await start.json()
  out.session = { status: start.status, keys: Object.keys(session) }
  if (session.sessionId) {
    await new Promise((r) => setTimeout(r, 12000))
    const collapse = await fetch(`${base}/api/collapse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, weights: {} }),
      signal: AbortSignal.timeout(20000),
    })
    const result = await collapse.json()
    out.collapse = {
      status: collapse.status,
      topLevelKeys: Object.keys(result),
      metricsKeys: result?.metrics ? Object.keys(result.metrics) : null,
      hasConsensus: Boolean(result?.consensus),
      sentenceCount: Array.isArray(result?.consensus?.supported) ? result.consensus.supported.length : null,
      isolatedCount: Array.isArray(result?.consensus?.isolated) ? result.consensus.isolated.length : null,
      protocolSteps: Array.isArray(result?.protocol) ? result.protocol.length : null,
      matrixSize: Array.isArray(result?.coherence) ? result.coherence.length : null,
    }
    out.negotiated = session.providers?.map?.((p) => p.id) ?? null
  }
} catch (error) {
  out.sessionError = String(error?.message ?? error)
}

console.log(JSON.stringify(out, null, 2))