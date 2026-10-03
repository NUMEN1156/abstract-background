import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'

import { SuperpositionHub } from './hub.mjs'
import { activeAdapters, addAdapter, AdapterError, listAdapters, removeAdapter, updateAdapter } from './adapters.mjs'
import { collapse } from './synthesis.mjs'
import { describeVault, seedVault } from './crypto.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? 3000)
const promptLimit = 1200

const hub = new SuperpositionHub()
seedVault(listAdapters())

const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 128 * 1024 })

await app.register(websocket)

/* ------------------------------------------------------------------ */
/* Basisdaten                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/health', async () => ({
  status: 'ok',
  service: 'abstract-background',
  mode: isProduction ? 'produktion' : 'entwicklung',
  at: new Date().toISOString(),
}))

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
  }

  const session = hub.createSession({ prompt, providers, settings })
  hub.recordEmit()
  return {
    ok: true,
    sessionId: session.id,
    prompt,
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
    return reply.code(404).send({ ok: false, error: 'Sitzung nicht gefunden oder abgelaufen.' })
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
    return reply.code(404).send({ ok: false, error: 'Sitzung nicht gefunden oder abgelaufen.' })
  }

  const rawWeights =
    body.weights && typeof body.weights === 'object' && !Array.isArray(body.weights)
      ? body.weights
      : {}
  const weights = {}
  for (const [key, value] of Object.entries(rawWeights)) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
      return reply.code(400).send({
        ok: false,
        error: `Das Gewicht für „${key}“ ist keine endliche Zahl.`,
        field: key,
      })
    }
    weights[key] = Math.min(100, Math.max(0, numeric))
  }

  const result = collapse({
    prompt: session.prompt,
    rule: session.settings.collapseRule,
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
    socket.send(JSON.stringify({ type: 'fatal', message: 'Sitzung nicht gefunden oder abgelaufen.' }))
    socket.close(4404, 'session-missing')
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
    return reply.code(404).send({ ok: false, error: 'Sitzung nicht gefunden oder abgelaufen.' })
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
