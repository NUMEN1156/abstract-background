#!/usr/bin/env node
/**
 * Beweissonde: Kann ein Fremder ohne Zugangsschlüssel die Adapter-Registry
 * des laufenden Systems verändern? Der angelegte Prüfadapter wird am Ende
 * wieder entfernt, der Fremdzustand also wiederhergestellt.
 *
 * Aufruf: node scripts/live-adapter-probe.mjs --base=https://...
 */

const args = process.argv.slice(2)
const arg = (n, f) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? f
const base = arg('base', 'https://abstractbg-qehn8ouj.manus.space').replace(/\/$/, '')

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}

const snapshot = async () => {
  const r = await req('/api/adapters')
  return (r.json?.adapters ?? []).map((a) => ({ id: a.id, enabled: a.enabled, builtIn: a.builtIn, source: a.source }))
}

const before = await snapshot()
console.log('Adapter vor der Sonde:', JSON.stringify(before))

const label = `probe-${Date.now().toString(36)}`
const candidate = {
  label,
  vendor: 'probe',
  model: 'probe-model-1',
  persona: 'Prüfadapter für den Fremdzugriffstest',
  endpoint: 'https://example.invalid/v1/chat/completions',
  apiKey: 'probe-key-nicht-echt',
  weightDefault: 10,
}

const created = await req('/api/adapters', { method: 'POST', body: candidate })
console.log('POST /api/adapters:', created.status, created.text.slice(0, 200))

const id = created.json?.adapter?.id ?? created.json?.id ?? null
if (id) {
  const disabled = await req(`/api/adapters/${id}`, { method: 'PATCH', body: { enabled: false } })
  const removed = await req(`/api/adapters/${id}`, { method: 'DELETE' })
  const after = await snapshot()
  console.log('PATCH:', disabled.status, '| DELETE:', removed.status)
  console.log('Adapter nach der Sonde:', JSON.stringify(after))
  console.log('Fremdzustand wiederhergestellt:', after.length === before.length && after.every((a, i) => a.id === before[i]?.id))
} else {
  console.log('Kein Prüfadapter angelegt — Schreibzugriff auf diesem Weg nicht bestätigt.')
}

// Kontext der verdächtigen Zeichenketten im ausgelieferten Bundle.
const html = await req('/')
const asset = html.text.match(/\/assets\/[^"']+\.js/)?.[0]
if (asset) {
  const bundle = await req(asset)
  for (const needle of ['apiKey', 'secret', 'ABSTRACT_API_KEY', 'accessKey']) {
    let idx = bundle.text.indexOf(needle)
    let shown = 0
    while (idx !== -1 && shown < 2) {
      console.log(`Bundle "${needle}": …${bundle.text.slice(Math.max(0, idx - 70), idx + 60).replace(/\s+/g, ' ')}…`)
      idx = bundle.text.indexOf(needle, idx + 1)
      shown += 1
    }
  }
}