#!/usr/bin/env node
/**
 * Verifikation der Härtung nach dem blinden Drucktest.
 *
 * Geprüft werden die vier Maßnahmen: Schreibschutz der Adapter-Registry,
 * strikte Eingabeprüfung, Schonfrist bei der Verdrängung und die klare
 * Unterscheidung zwischen unbekannter und verdrängter Sitzung.
 *
 * Aufruf:
 *   node scripts/verify-hardening.mjs --base=http://127.0.0.1:3700 --expect=locked
 *   node scripts/verify-hardening.mjs --base=http://127.0.0.1:3730 --expect=open
 *   node scripts/verify-hardening.mjs --base=http://127.0.0.1:3710 --expect=eviction
 *   node scripts/verify-hardening.mjs --base=http://127.0.0.1:3720 --expect=grace
 */

const args = process.argv.slice(2)
const arg = (n, f) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? f
const base = arg('base', 'http://127.0.0.1:3700').replace(/\/$/, '')
const expect = arg('expect', 'locked')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'OK  ' : 'FEHL'} | ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(path, { method = 'GET', body, key } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'X-Api-Key': key } : {}),
    },
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const start = (prompt) => req('/api/superposition', { method: 'POST', body: { prompt } })

async function accessChecks() {
  const access = await req('/api/access')
  console.log(`Zugangsstatus: ${JSON.stringify(access.json)}`)
  return access.json
}

/* ------------------------------------------------------- Schreibschutz ---- */
async function lockedChecks() {
  const status = await accessChecks()
  check('Zugangsstatus meldet schreibgeschützte Registry', status?.adapterWrites === 'locked', JSON.stringify(status?.adapterWrites))

  const create = await req('/api/adapters', {
    method: 'POST',
    body: { label: 'probe', vendor: 'probe', model: 'probe-model', persona: 'struktur' },
  })
  check('Adapter anlegen wird abgewiesen', create.status === 403, `HTTP ${create.status}`)
  check('Ablehnung nennt das Feld', create.json?.field === 'adapterWrites', JSON.stringify(create.json?.field))

  const toggle = await req('/api/adapters/llama', { method: 'PATCH', body: { enabled: false } })
  check('Adapter umschalten wird abgewiesen', toggle.status === 403, `HTTP ${toggle.status}`)

  const remove = await req('/api/adapters/openai', { method: 'DELETE' })
  check('Adapter löschen wird abgewiesen', remove.status === 403, `HTTP ${remove.status}`)

  const list = await req('/api/adapters')
  const enabled = (list.json?.adapters ?? []).filter((a) => a.enabled).map((a) => a.id)
  check('Registry unverändert lesbar', list.status === 200 && enabled.length === 4, `aktiv: ${enabled.join(', ')}`)

  const session = await start('Sitzungsstart muss trotz Schreibschutz offen bleiben')
  check('Sitzungsstart bleibt offen', session.status === 200, `HTTP ${session.status}`)
  return session.json?.sessionId ?? null
}

/* -------------------------------------------------------- offener Modus -- */
async function openChecks() {
  const status = await accessChecks()
  check('Zugangsstatus meldet offene Registry', status?.adapterWrites === 'open', JSON.stringify(status?.adapterWrites))
  const create = await req('/api/adapters', {
    method: 'POST',
    body: { label: `pruef-${Date.now().toString(36)}`, vendor: 'probe', model: 'probe-model', persona: 'struktur' },
  })
  check('Adapter anlegen erlaubt (Entwicklung)', create.status === 200, `HTTP ${create.status}`)
  const id = create.json?.adapter?.id
  if (id) {
    const remove = await req(`/api/adapters/${id}`, { method: 'DELETE' })
    check('Prüfadapter wieder entfernt', remove.status === 200, `HTTP ${remove.status}`)
  }
}

/* --------------------------------------------------- strikte Eingaben ---- */
async function validationChecks(sessionId) {
  if (!sessionId) {
    check('Eingabeprüfung braucht eine Sitzung', false, 'keine Sitzung verfügbar')
    return
  }
  const cases = [
    ['Adapterauswahl als Zeichenkette', '/api/superposition', { prompt: 'Typfehlerprüfung', providerIds: 'openai' }, 400],
    ['Gewicht negativ', '/api/collapse', { sessionId, weights: { openai: -1 } }, 400],
    ['Gewicht als Zeichenkette', '/api/collapse', { sessionId, weights: { openai: '100' } }, 400],
    ['Gewicht unendlich groß', '/api/collapse', { sessionId, weights: { openai: 1e308 } }, 400],
    ['Gewicht über dem Bereich', '/api/collapse', { sessionId, weights: { openai: 101 } }, 400],
    ['Schwelle außerhalb 0..1', '/api/collapse', { sessionId, weights: {}, jaccardThreshold: 999 }, 400],
    ['Schwelle negativ', '/api/collapse', { sessionId, weights: {}, jaccardThreshold: -0.1 }, 400],
    ['Mindestanzahl 0', '/api/collapse', { sessionId, weights: {}, minAgreeingModels: 0 }, 400],
    ['Mindestanzahl gebrochen', '/api/collapse', { sessionId, weights: {}, minAgreeingModels: 1.5 }, 400],
    ['gültige Gewichte', '/api/collapse', { sessionId, weights: { openai: 50, anthropic: 50 } }, 200],
    ['gültige Schwelle', '/api/collapse', { sessionId, weights: {}, jaccardThreshold: 0.25, minAgreeingModels: 2 }, 200],
  ]
  for (const [name, path, body, wanted] of cases) {
    const res = await req(path, { method: 'POST', body })
    check(`${name} → ${wanted}`, res.status === wanted, `HTTP ${res.status} ${res.json?.error ?? ''}`.trim())
  }
}

/* ------------------------------------------------------------ Verdrängung */
async function evictionChecks() {
  const first = await start('Verdrängungsprüfung eins')
  const second = await start('Verdrängungsprüfung zwei')
  // Erst wenn die Ströme durchgelaufen sind, kommt eine Sitzung überhaupt als Verdrängungskandidat
  // in Frage. Ohne diese Wartezeit wird die Anfrage zu Recht mit 429 abgelehnt.
  await sleep(25000)
  const third = await start('Verdrängungsprüfung drei')
  console.log(`Startantworten: ${first.status}, ${second.status}, ${third.status}`)

  const old = first.json?.sessionId
  if (old) {
    const collapse = await req('/api/collapse', { method: 'POST', body: { sessionId: old, weights: {} } })
    check('Verdrängte Sitzung meldet 410 statt 404', collapse.status === 410, `HTTP ${collapse.status} ${collapse.json?.error ?? ''}`)
  }
  const keep = second.json?.sessionId
  if (keep) {
    const collapse = await req('/api/collapse', { method: 'POST', body: { sessionId: keep, weights: {} } })
    check('Nicht verdrängte Sitzung bleibt nutzbar', collapse.status === 200, `HTTP ${collapse.status}`)
  }
  const unknown = await req('/api/collapse', { method: 'POST', body: { sessionId: 'gibt-es-nicht', weights: {} } })
  check('Unbekannte Sitzung bleibt 404', unknown.status === 404, `HTTP ${unknown.status}`)
}

async function graceChecks() {
  const first = await start('Schonfrist eins')
  const second = await start('Schonfrist zwei')
  // Die Schonfrist soll gerade verhindern, dass eine abgeschlossene Sitzung sofort verschwindet.
  await sleep(25000)
  const third = await start('Schonfrist drei')
  console.log(`Startantworten: ${first.status}, ${second.status}, ${third.status}`)
  check('Dritte Sitzung wird sichtbar abgelehnt statt still verdrängt', third.status === 429, `HTTP ${third.status}`)
  const id = first.json?.sessionId
  if (id) {
    const collapse = await req('/api/collapse', { method: 'POST', body: { sessionId: id, weights: {} } })
    check('Angenommene Sitzung bleibt innerhalb der Schonfrist nutzbar', collapse.status === 200, `HTTP ${collapse.status}`)
  }
}

async function main() {
  const health = await req('/api/health')
  console.log(`Ziel ${base} — ${health.status} ${JSON.stringify(health.json?.mode ?? '')} (Erwartung: ${expect})`)
  if (health.status !== 200) {
    check('Zielsystem erreichbar', false, `HTTP ${health.status}`)
    process.exitCode = 1
    return
  }
  if (expect === 'locked') {
    const sessionId = await lockedChecks()
    await validationChecks(sessionId)
  } else if (expect === 'open') {
    await openChecks()
  } else if (expect === 'eviction') {
    await evictionChecks()
  } else if (expect === 'grace') {
    await graceChecks()
  }
  console.log(`\nErgebnis: ${pass} bestanden, ${fail} fehlgeschlagen`)
  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('Abbruch:', error)
  process.exitCode = 1
})
