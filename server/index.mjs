import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'

import { CapacityError, SuperpositionHub } from './hub.mjs'
import { activeAdapters, addAdapter, AdapterError, listAdapters, removeAdapter, updateAdapter } from './adapters.mjs'
import { collapse } from './synthesis.mjs'
import { describeVault, seedVault } from './crypto.mjs'
import { accessStatus, registerAccessGuard } from './access.mjs'
import { clampMinAgreeing, clampThreshold } from './consensus.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? 3000)
const promptLimit = 1200

/**
 * Vorschau eines Auftrags für Antworten.
 *
 * Der volle Auftrag wird nicht zurückgespiegelt: Er ist Nutzereingabe und hat in Antworten
 * nichts verloren. Die Vorschau ist gekürzt und von Steuerzeichen befreit.
 */
function promptPreview(prompt, limit = 120) {
  const flat = String(prompt ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`
}


/**
 * Strikte Zahlenprüfung für Konsenseinstellungen.
 *
 * Werte außerhalb des Bereichs oder vom falschen Typ werden abgewiesen, statt sie stillschweigend
 * auf den gültigen Bereich zu ziehen: Eine Anfrage soll genau das tun, was sie beschreibt.
 */
function rangeProblem(value, min, max, field, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${label} muss eine Zahl zwischen ${min} und ${max} sein.`, field }
  }
  return null
}

function countProblem(value, min, max, field, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `${label} muss eine ganze Zahl zwischen ${min} und ${max} sein.`, field }
  }
  return null
}

/**
 * Antwort für eine unbekannte Sitzung: Verdrängte Sitzungen werden von nie existierenden
 * unterschieden, damit ein Client den Unterschied zwischen „zu spät" und „falsch" erkennt.
 */
function sessionMissingReply(hub, id) {
  if (hub.wasEvicted(String(id ?? ''))) {
    return {
      status: 410,
      body: {
        ok: false,
        error:
          'Diese Sitzung wurde wegen der Kapazitätsgrenze verdrängt. Starten Sie den Auftrag erneut.',
        field: 'capacity',
      },
    }
  }
  return { status: 404, body: { ok: false, error: 'Sitzung nicht gefunden oder abgelaufen.' } }
}

const hub = new SuperpositionHub()
seedVault(listAdapters())

const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 128 * 1024 })
// Vor allen Routen registriert, damit der Schutz für jeden schreibenden Aufruf greift.
registerAccessGuard(app)
/**
 * Der Ereignisstrom besteht überwiegend aus kurzen, ähnlichen Textblöcken. Die
 * WebSocket-Kompression senkt die übertragene Datenmenge deutlich; sie lässt sich über
 * ABSTRACT_WS_DEFLATE=0 abschalten, etwa um den unkomprimierten Vergleich zu messen.
 */
const wsDeflateEnabled = process.env.ABSTRACT_WS_DEFLATE !== '0'
await app.register(websocket, {
  options: wsDeflateEnabled
    ? {
        perMessageDeflate: {
          threshold: 256,
          zlibDeflateOptions: { level: 6, memLevel: 8 },
          zlibInflateOptions: { chunkSize: 16 * 1024 },
          clientNoContextTakeover: false,
          serverNoContextTakeover: false,
          concurrencyLimit: 8,
        },
      }
    : {},
})

/* ------------------------------------------------------------------ */
/* Basisdaten                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/health', async () => ({
  status: 'ok',
  service: 'abstract-background',
  mode: isProduction ? 'produktion' : 'entwicklung',
  at: new Date().toISOString(),
}))

app.get('/api/access', async () => accessStatus())

app.get('/api/architecture', async () => ({
  frontend: {
    name: 'React 18 + TypeScript',
    detail: 'Cyber-Minimalismus-Oberfläche, ein Dokument, kein Sitzungszwang',
  },
  backend: {
    name: 'Node.js + Fastify',
    detail:
      'Ein Prozess auf Port 3000, ausgeliefert als API, Streaming-Endpunkt und statisches Frontend',
  },
  transport: {
    primary: 'WebSocket (/ws)',
    fallback: 'Server-Sent-Events (/api/stream/:sessionId)',
    detail:
      'Ereignispuffer je Sitzung: ein nachgelagerter Empfänger erhält zuerst den Verlauf, danach live',
    compression: wsDeflateEnabled ? 'permessage-deflate (Schwelle 256 Byte)' : 'ungekomprimiert',
    bufferLimit: {
      events: Number(process.env.ABSTRACT_MAX_BUFFERED_EVENTS ?? 1500),
      chars: Number(process.env.ABSTRACT_MAX_BUFFERED_CHARS ?? 400000),
      detail:
        'Bei Überschreitung wird der älteste Verlaufsteil verworfen; der Snapshot meldet die Kürzung ausdrücklich',
    },
  },
  adapters: {
    detail: 'Modulare Adapter-Registry mit Laufzeit-Anlage, Validierung und Persistenz in .data/',
  },
  security: {
    detail:
      'API-Schlüssel ausschließlich serverseitig, verschlüsselt mit AES-256-GCM, nach außen nur maskierte Vorschau',
  },
  simulation: {
    detail:
      'Anbieterantworten werden serverseitig erzeugt und tokenweise gestreamt; Laufzeit und Tokenzahl sind gemessen',
  },
}))

app.get('/api/security', async () => {
  const vault = describeVault()
  return {
    ...vault,
    measures: [
      'Kein Schlüssel im Browser-Bundle oder im Netzwerkverkehr zum Client',
      'Verschlüsselte Ablage mit AES-256-GCM und authentifiziertem Tag',
      'Adapter-Endpunkte werden ausschließlich serverseitig aufgelöst',
      'Nach außen nur maskierte Vorschau und Fingerprint des Geheimtextes',
    ],
  }
})

/* ------------------------------------------------------------------ */
/* Adapter-Registry                                                    */
/* ------------------------------------------------------------------ */

app.get('/api/adapters', async () => ({ adapters: listAdapters() }))

app.post('/api/adapters', async (request, reply) => {
  try {
    const adapter = addAdapter(request.body ?? {})
    seedVault([adapter])
    return { ok: true, adapter }
  } catch (error) {
    if (error instanceof AdapterError) {
      return reply.code(400).send({ ok: false, error: error.message, field: error.field })
    }
    request.log?.error?.(error)
    return reply.code(500).send({ ok: false, error: 'Adapter konnte nicht angelegt werden.' })
  }
})

app.patch('/api/adapters/:id', async (request, reply) => {
  try {
    return { ok: true, adapter: updateAdapter(request.params.id, request.body ?? {}) }
  } catch (error) {
    if (error instanceof AdapterError) {
      return reply.code(400).send({ ok: false, error: error.message, field: error.field })
    }
    return reply.code(500).send({ ok: false, error: 'Adapter konnte nicht geändert werden.' })
  }
})

app.delete('/api/adapters/:id', async (request, reply) => {
  try {
    return { ok: true, ...removeAdapter(request.params.id) }
  } catch (error) {
    if (error instanceof AdapterError) {
      return reply.code(400).send({ ok: false, error: error.message, field: error.field })
    }
    return reply.code(500).send({ ok: false, error: 'Adapter konnte nicht entfernt werden.' })
  }
})

/* ------------------------------------------------------------------ */
/* Superposition                                                       */
/* ------------------------------------------------------------------ */

app.post('/api/superposition', async (request, reply) => {
  const body = request.body ?? {}
  const prompt = String(body.prompt ?? '').trim()

  if (prompt.length < 8) {
    return reply
      .code(400)
      .send({ ok: false, error: 'Die Anfrage muss mindestens 8 Zeichen enthalten.' })
  }
  if (prompt.length > promptLimit) {
    return reply
      .code(400)
      .send({ ok: false, error: `Die Anfrage ist auf ${promptLimit} Zeichen begrenzt.` })
  }

  // Die Adapterauswahl muss eine Liste sein. Eine einzelne Zeichenkette wurde zuvor stillschweigend
  // als „keine Auswahl" gedeutet und startete dann den gesamten Verbund statt des gewünschten Modells.
  if (body.providerIds !== undefined && !Array.isArray(body.providerIds)) {
    return reply
      .code(400)
      .send({ ok: false, error: 'Die Adapterauswahl muss eine Liste von Kennungen sein.', field: 'providerIds' })
  }
  for (const invalid of [
    rangeProblem(body.jaccardThreshold, 0, 1, 'jaccardThreshold', 'Die Konsensschwelle'),
    countProblem(body.minAgreeingModels, 1, 12, 'minAgreeingModels', 'Die Mindestanzahl zustimmender Modelle'),
  ]) {
    if (invalid) return reply.code(400).send(invalid)
  }

  const requestedIds = Array.isArray(body.providerIds) ? body.providerIds.map(String) : []
  let providers
  try {
    providers = activeAdapters(requestedIds)
  } catch (error) {
    if (error instanceof AdapterError) {
      return reply.code(400).send({ ok: false, error: error.message, field: error.field })
    }
    throw error
  }

  const settings = {
    collapseRule: String(body.collapseRule ?? 'gewichtete-synthese'),
    injectFailure: Boolean(body.injectFailure),
    transport: 'websocket',
    temperature: Number(body.temperature ?? 0.4),
    jaccardThreshold: body.jaccardThreshold ?? clampThreshold(undefined),
    minAgreeingModels: body.minAgreeingModels ?? clampMinAgreeing(undefined),
  }

  let session
  try {
    session = hub.createSession({ prompt, providers, settings })
  } catch (error) {
    if (error instanceof CapacityError) {
      return reply.code(429).send({
        ok: false,
        error: error.message,
        field: 'capacity',
        retryAfterSec: 30,
      })
    }
    throw error
  }
  hub.recordEmit()
  return {
    ok: true,
    sessionId: session.id,
    promptPreview: promptPreview(prompt),
    promptChars: String(prompt ?? '').length,
    providers: providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      model: provider.model,
      accent: provider.accent,
      glyph: provider.glyph,
      weightDefault: provider.weightDefault ?? 25,
    })),
    settings,
    wsPath: `/ws?session=${session.id}`,
    ssePath: `/api/stream/${session.id}`,
  }
})

app.get('/api/session/:id', async (request, reply) => {
  const session = hub.get(request.params.id)
  if (!session) {
    const missing = sessionMissingReply(hub, request.params.id)
    return reply.code(missing.status).send(missing.body)
  }
  return {
    ok: true,
    sessionId: session.id,
    prompt: session.prompt,
    state: session.state,
    streams: [...session.streams.values()].map((stream) => ({
      id: stream.id,
      state: stream.state,
      tokens: stream.tokens,
      latencyMs: stream.latencyMs,
      chars: stream.text.length,
    })),
  }
})

app.post('/api/collapse', async (request, reply) => {
  const body = request.body ?? {}
  const session = hub.get(String(body.sessionId ?? ''))
  if (!session) {
    const missing = sessionMissingReply(hub, body.sessionId)
    return reply.code(missing.status).send(missing.body)
  }

  for (const invalid of [
    rangeProblem(body.jaccardThreshold, 0, 1, 'jaccardThreshold', 'Die Konsensschwelle'),
    countProblem(body.minAgreeingModels, 1, 12, 'minAgreeingModels', 'Die Mindestanzahl zustimmender Modelle'),
  ]) {
    if (invalid) return reply.code(400).send(invalid)
  }

  const rawWeights =
    body.weights && typeof body.weights === 'object' && !Array.isArray(body.weights)
      ? body.weights
      : {}
  const weights = {}
  for (const [key, value] of Object.entries(rawWeights)) {
    // Gewichte werden strikt geprüft: Zeichenketten, negative Werte und Werte außerhalb des
    // dokumentierten Bereichs verändern sonst stillschweigend die Bedeutung des Kollapses.
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return reply.code(400).send({
        ok: false,
        error: `Das Gewicht für „${key}“ muss eine Zahl zwischen 0 und 100 sein.`,
        field: key,
      })
    }
    weights[key] = value
  }

  const result = collapse({
    prompt: session.prompt,
    rule: session.settings.collapseRule,
    // Der Kollaps darf die Konsenseinstellungen überschreiben; so lässt sich eine Ausgabe mit
    // mehreren Schwellen prüfen, ohne die Sitzung neu zu starten.
    threshold:
      body.jaccardThreshold === undefined
        ? session.settings.jaccardThreshold
        : body.jaccardThreshold,
    minAgreeingModels:
      body.minAgreeingModels === undefined
        ? session.settings.minAgreeingModels
        : body.minAgreeingModels,
    streams: [...session.streams.values()].map((stream) => ({
      id: stream.id,
      label: stream.label,
      model: stream.model,
      accent: stream.accent,
      text: stream.text,
      tokens: stream.tokens,
      latencyMs: stream.latencyMs,
      confidence: stream.confidence,
    })),
    weights,
  })

  return { ok: true, sessionId: session.id, result }
})

app.get('/api/telemetry', async () => hub.stats())

/* ------------------------------------------------------------------ */
/* Streaming: WebSocket zuerst, Server-Sent-Events als Rückfallebene    */
/* ------------------------------------------------------------------ */

app.get('/ws', { websocket: true }, (socket, request) => {
  const sessionId = String(request.query?.session ?? '')
  const session = hub.get(sessionId)
  if (!session) {
    const missing = sessionMissingReply(hub, sessionId)
    socket.send(JSON.stringify({ type: 'fatal', message: missing.body.error }))
    socket.close(missing.status === 410 ? 4410 : 4404, missing.status === 410 ? 'session-evicted' : 'session-missing')
    return
  }

  session.settings.transport = 'websocket'
  const detach = session.attach({ send: (event) => socket.send(JSON.stringify(event)) })

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(String(raw))
      if (message?.type === 'ping') socket.send(JSON.stringify({ type: 'pong', at: Date.now() }))
    } catch {
      /* Unlesbare Nachrichten werden bewusst ignoriert. */
    }
  })
  socket.on('close', detach)
  socket.on('error', detach)
})

app.get('/api/stream/:id', (request, reply) => {
  const session = hub.get(request.params.id)
  if (!session) {
    const missing = sessionMissingReply(hub, request.params.id)
    return reply.code(missing.status).send(missing.body)
  }

  session.settings.transport = 'server-sent-events'
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  })
  reply.raw.write(': verbunden\n\n')

  const heartbeat = setInterval(() => {
    try {
      reply.raw.write(': takt\n\n')
    } catch {
      /* Verbindung beendet. */
    }
  }, 15000)

  const detach = session.attach({
    send: (event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`),
  })

  request.raw.on('close', () => {
    clearInterval(heartbeat)
    detach()
  })
})

/* ------------------------------------------------------------------ */
/* Frontend: Vite im Entwicklungsbetrieb, statische Dateien in Produktion */
/* ------------------------------------------------------------------ */

if (isProduction) {
  const distDir = path.join(root, 'dist')
  if (fs.existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir, prefix: '/' })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ ok: false, error: 'Nicht gefunden.' })
      }
      if ((request.headers.accept ?? '').includes('text/html')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ ok: false, error: 'Nicht gefunden.' })
    })
  }
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root,
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server: app.server } },
  })
  // Fastify 5 führt keine Middleware-Schnittstelle mehr; alle nicht von Routen
  // beanspruchten Anfragen werden direkt an die Vite-Middleware übergeben.
  app.setNotFoundHandler((request, reply) => {
    reply.hijack()
    vite.middlewares(request.raw, reply.raw, () => {
      reply.raw.statusCode = 404
      reply.raw.setHeader('Content-Type', 'application/json; charset=utf-8')
      reply.raw.end(JSON.stringify({ ok: false, error: 'Nicht gefunden.' }))
    })
  })
  app.addHook('onClose', async () => {
    await vite.close()
  })
}

/* ------------------------------------------------------------------ */
/* Start und geordnetes Herunterfahren                                 */
/* ------------------------------------------------------------------ */

const shutdown = async (signal) => {
  app.log?.info?.(`Signal ${signal}: Server wird beendet.`)
  hub.shutdown()
  await app.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(
    `Abstract Background läuft auf Port ${port} (${isProduction ? 'Produktion' : 'Entwicklung'}) — ${listAdapters().length} Adapter registriert.`,
  )
} catch (error) {
  console.error('Start fehlgeschlagen:', error)
  process.exit(1)
}
