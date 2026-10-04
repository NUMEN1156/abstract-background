#!/usr/bin/env node
/**
 * Kanal-Sonde: vergleicht den Verlauf, den ein früher Empfänger sieht, mit dem
 * Verlauf, den ein spät hinzutretender Empfänger nachgespielt bekommt.
 *
 * Aufruf: node scripts/channel-probe.mjs --base=http://127.0.0.1:3700 --delay=6000
 */

import { WebSocket } from 'ws'

const args = process.argv.slice(2)
const arg = (n, f) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? f
const base = arg('base', 'http://127.0.0.1:3700').replace(/\/$/, '')
const delay = Number(arg('delay', '6000'))
const wait = Number(arg('wait', '25000'))

const END_TYPES = new Set(['end', 'session:end', 'session:done', 'stream:end'])

function collect(wsPath) {
  const state = { events: [], types: {}, opened: false, closed: null, error: null, ws: null }
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}${wsPath}`)
  state.ws = socket
  socket.on('open', () => {
    state.opened = true
  })
  socket.on('message', (data) => {
    const text = data.toString()
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        state.events.push(event)
        state.types[event.type] = (state.types[event.type] ?? 0) + 1
      } catch {
        state.events.push({ type: '__unparsed', raw: line.slice(0, 120) })
      }
    }
  })
  socket.on('error', (error) => {
    state.error = String(error?.message ?? error)
  })
  socket.on('close', (code) => {
    state.closed = code
  })
  return state
}

const ended = (state) => state.events.some((e) => END_TYPES.has(e?.type))

async function waitEnd(state, maxMs) {
  const started = performance.now()
  while (performance.now() - started < maxMs) {
    if (ended(state)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  await new Promise((r) => setTimeout(r, 500))
  try {
    state.ws.close()
  } catch {}
  return state
}

/**
 * Normalisiert einen Verlauf: Der Nachspiel-Snapshot enthält den bisherigen
 * Verlauf eingebettet, spätere Ereignisse kommen einzeln. Beide Formen werden
 * auf eine gemeinsame Folge von Ereignissen abgebildet.
 */
function flatten(state) {
  const out = []
  for (const event of state.events) {
    if (event.type === 'session:snapshot') {
      const inner = event.events ?? event.history ?? event.buffer ?? event.replay ?? null
      if (Array.isArray(inner)) {
        out.push({ type: 'session:snapshot', count: inner.length })
        for (const e of inner) out.push(e)
      } else {
        out.push({ type: 'session:snapshot', keys: Object.keys(event).sort() })
      }
      continue
    }
    out.push(event)
  }
  return out
}

const session = await (
  await fetch(`${base}/api/superposition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Kanal-Sonde: früher gegen späten Empfänger' }),
  })
).json()

const early = collect(session.wsPath)
await new Promise((r) => setTimeout(r, delay))
const late = collect(session.wsPath)

await waitEnd(early, wait)
await waitEnd(late, wait)

const snap = early.events.find((e) => e.type === 'session:snapshot')
console.log('--- Sonde ---')
console.log('wsPath:', session.wsPath)
console.log('früh: geöffnet', early.opened, '| Ereignisse', early.events.length, '| Fehler', early.error, '| geschlossen', early.closed)
console.log('spät: geöffnet', late.opened, '| Ereignisse', late.events.length, '| Fehler', late.error, '| geschlossen', late.closed)
console.log('Typen früh:', JSON.stringify(early.types))
console.log('Typen spät:', JSON.stringify(late.types))
console.log('Snapshot-Schlüssel:', snap ? Object.keys(snap).sort().join(',') : 'kein Snapshot')
if (snap) {
  const inner = snap.events ?? snap.history ?? snap.buffer ?? snap.replay ?? null
  console.log('Snapshot-Einbettung:', Array.isArray(inner) ? `${inner.length} Ereignisse` : 'keine Liste')
  console.log('Snapshot-Ausschnitt:', JSON.stringify(snap).slice(0, 240))
}

const flatEarly = flatten(early.events ? { events: early.events } : early)
const flatLate = flatten(late)
const same = JSON.stringify(flatEarly) === JSON.stringify(flatLate)
console.log('normalisierte Folgen gleich:', same)
if (!same) {
  console.log('früh Länge', flatEarly.length, '| spät Länge', flatLate.length)
  for (let i = 0; i < Math.max(flatEarly.length, flatLate.length); i += 1) {
    const a = JSON.stringify(flatEarly[i] ?? null)
    const b = JSON.stringify(flatLate[i] ?? null)
    if (a !== b) {
      console.log('erste Abweichung bei', i)
      console.log('  früh:', a.slice(0, 160))
      console.log('  spät:', b.slice(0, 160))
      break
    }
  }
}