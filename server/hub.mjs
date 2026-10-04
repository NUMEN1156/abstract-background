import crypto from 'node:crypto'
import { composeResponse } from './providers.mjs'

/**
 * Session-Hub der Superposition.
 *
 * Eine Sitzung erzeugt für jeden beteiligten Adapter einen eigenen Kanal und streamt dessen
 * Ausgabe tokenweise. Alle Ereignisse werden gepuffert, damit ein später hinzutretender
 * Empfänger — etwa nach einem Transportwechsel von WebSocket auf Server-Sent-Events —
 * den vollständigen Verlauf zuerst und danach live erhält.
 */

const SESSION_TTL_MS = 20 * 60 * 1000
/** Obergrenze gleichzeitig gehaltener Sitzungen; für Lasttests über die Umgebung anpassbar. */
const MAX_SESSIONS = Math.max(1, Number(process.env.ABSTRACT_MAX_SESSIONS ?? 120))
/**
 * Schonfrist für abgeschlossene Sitzungen.
 *
 * Sind die Ströme durchgelaufen, wird eine Sitzung nicht sofort verdrängt: Ein gerade
 * angenommener Auftrag muss seinen Verlauf abholen und den Kollaps auslösen können. Ohne diese
 * Frist verschwindet die Sitzung genau in dem Moment, in dem sie gebraucht wird — der Client
 * erhält dann 404 auf einen Auftrag, den der Dienst zuvor mit 200 angenommen hat.
 */
const EVICTION_GRACE_MS = Math.max(0, Number(process.env.ABSTRACT_EVICTION_GRACE_MS ?? 90_000))
/**
 * Obergrenzen des Ereignispuffers je Sitzung. Sie deckeln den Speicherbedarf bei Langläufern.
 * Wird gekürzt, meldet der Snapshot das ausdrücklich: späte Empfänger erhalten dann nur den
 * jüngeren Teil des Verlaufs statt eines unbemerkt unvollständigen Bildes.
 */
const MAX_BUFFERED_EVENTS = Math.max(50, Number(process.env.ABSTRACT_MAX_BUFFERED_EVENTS ?? 1500))
const MAX_BUFFERED_CHARS = Math.max(10000, Number(process.env.ABSTRACT_MAX_BUFFERED_CHARS ?? 400000))
const TELEMETRY_INTERVAL_MS = 2000

const toTokenChunks = (text) => String(text).match(/\S+\s*/g) ?? []
const jitter = (min, max) => min + Math.random() * (max - min)

/** Wird ausgelöst, wenn die Sitzungsobergrenze erreicht ist und keine Sitzung freigegeben werden kann. */
export class CapacityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CapacityError'
  }
}

/** Größe eines gepufferten Ereignisses, gemessen an der Nutzlast in Zeichen. */
function eventSize(event) {
  if (!event) return 0
  if (typeof event.delta === 'string') return event.delta.length
  if (typeof event.text === 'string') return event.text.length
  return 0
}

class Session {
  constructor({ id, prompt, providers, settings }) {
    this.id = id
    this.prompt = prompt
    this.providers = providers
    this.settings = settings
    this.createdAt = Date.now()
    this.lastAccess = Date.now()
    this.events = []
    this.bufferedChars = 0
    this.droppedEvents = 0
    this.truncated = false
    this.sinks = new Set()
    this.timers = new Set()
    this.streams = new Map()
    this.state = 'ready'
    this.completed = false
    this.completedAt = null

    for (const provider of providers) {
      this.streams.set(provider.id, {
        id: provider.id,
        label: provider.label,
        model: provider.model,
        accent: provider.accent,
        persona: provider.persona,
        confidence: provider.confidence,
        state: 'queued',
        text: '',
        tokens: 0,
        latencyMs: 0,
        error: null,
      })
    }
  }

  emit(event) {
    this.events.push(event)
    this.bufferedChars += eventSize(event)
    this.trimBuffer()
    this.lastAccess = Date.now()
    for (const sink of this.sinks) {
      try {
        sink.send(event)
      } catch {
        this.sinks.delete(sink)
      }
    }
  }

  /**
   * Hält den Puffer innerhalb der Obergrenzen. Verworfen wird immer der älteste Teil des
   * Verlaufs; die Kürzung wird gezählt und im Snapshot offengelegt.
   */
  trimBuffer() {
    if (this.events.length <= MAX_BUFFERED_EVENTS && this.bufferedChars <= MAX_BUFFERED_CHARS) {
      return
    }
    let dropped = 0
    while (
      this.events.length > 1 &&
      (this.events.length > MAX_BUFFERED_EVENTS || this.bufferedChars > MAX_BUFFERED_CHARS)
    ) {
      const removed = this.events.shift()
      this.bufferedChars -= eventSize(removed)
      dropped += 1
    }
    if (dropped > 0) {
      this.bufferedChars = Math.max(0, this.bufferedChars)
      this.droppedEvents += dropped
      this.truncated = true
    }
  }

  later(fn, delay) {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      fn()
    }, delay)
    this.timers.add(timer)
    return timer
  }

  attach(sink) {
    this.sinks.add(sink)
    const snapshot = {
      type: 'session:snapshot',
      sessionId: this.id,
      prompt: this.prompt,
      settings: this.settings,
      providers: this.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        vendor: provider.vendor,
        model: provider.model,
        accent: provider.accent,
        glyph: provider.glyph,
        persona: provider.persona,
        summary: provider.summary,
        capabilities: provider.capabilities ?? [],
        confidence: provider.confidence,
        weightDefault: provider.weightDefault ?? 25,
      })),
      createdAt: new Date(this.createdAt).toISOString(),
      replayed: this.events.length,
      truncated: this.truncated,
      droppedEvents: this.droppedEvents,
    }
    sink.send(snapshot)
    for (const event of this.events) sink.send(event)

    const detach = () => {
      this.sinks.delete(sink)
    }
    return detach
  }

  run() {
    if (this.state !== 'ready') return
    this.state = 'running'
    this.emit({
      type: 'session:start',
      sessionId: this.id,
      prompt: this.prompt,
      transport: this.settings.transport,
      startedAt: new Date().toISOString(),
    })
    for (const provider of this.providers) this.startProvider(provider)
  }

  startProvider(provider) {
    const stream = this.streams.get(provider.id)
    const warmup = jitter(provider.latencyBase * 0.45, provider.latencyBase * 0.95)
    const startedAt = Date.now()

    this.later(() => {
      stream.state = 'connecting'
      this.emit({ type: 'provider:state', providerId: provider.id, state: 'connecting' })

      this.later(() => {
        stream.state = 'streaming'
        this.emit({ type: 'provider:state', providerId: provider.id, state: 'streaming' })

        const chunks = toTokenChunks(composeResponse(provider, this.prompt))
        const perChunk = provider.verbosity >= 1.1 ? 1 : provider.verbosity <= 0.85 ? 3 : 2
        const [minCadence, maxCadence] = provider.cadence
        // Die Streuung moduliert Taktrate und Blockgröße des Kanals: höhere Werte erzeugen
        // unregelmäßigere Ströme, niedrigere ein gleichmäßigeres, vorhersehbares Verhalten.
        const temperature = Math.min(1, Math.max(0, Number(this.settings.temperature ?? 0.4)))
        const cadenceScale = 0.6 + temperature * 0.9
        let index = 0
        let tokens = 0

        const failAt =
          this.settings.injectFailure && Math.random() < 0.5
            ? Math.floor(chunks.length * jitter(0.35, 0.7))
            : -1

        const pushChunk = () => {
          if (failAt >= 0 && index >= failAt) {
            stream.state = 'error'
            stream.error = `Adapterschnittstelle ${provider.vendor} antwortet nicht im Zeitfenster (HTTP 504 nach ${Math.round(
              Date.now() - startedAt,
            )} ms). Kanal verworfen, übrige Kanäle bleiben unberührt.`
            stream.latencyMs = Date.now() - startedAt
            this.emit({
              type: 'provider:error',
              providerId: provider.id,
              message: stream.error,
              latencyMs: stream.latencyMs,
            })
            this.finishIfDone()
            return
          }

          const slice = chunks.slice(index, index + perChunk).join('')
          index += perChunk
          if (slice.length > 0) {
            tokens += toTokenChunks(slice).length
            stream.text += slice
            stream.tokens = tokens
            this.emit({ type: 'provider:chunk', providerId: provider.id, delta: slice, tokens })
          }

          if (index < chunks.length) {
            this.later(pushChunk, jitter(minCadence, maxCadence) * cadenceScale)
            return
          }

          stream.state = 'complete'
          stream.latencyMs = Date.now() - startedAt
          this.emit({
            type: 'provider:done',
            providerId: provider.id,
            latencyMs: stream.latencyMs,
            tokens: stream.tokens,
            confidence: provider.confidence,
          })
          this.finishIfDone()
        }

        pushChunk()
      }, jitter(60, 220))
    }, warmup)
  }

  finishIfDone() {
    const pending = [...this.streams.values()].filter(
      (stream) => stream.state !== 'complete' && stream.state !== 'error',
    )
    if (pending.length > 0 || this.completed) return
    this.completed = true
    this.completedAt = Date.now()
    this.state = 'settled'
    this.emit({
      type: 'session:done',
      sessionId: this.id,
      finishedAt: new Date().toISOString(),
      completed: [...this.streams.values()].filter((s) => s.state === 'complete').length,
      failed: [...this.streams.values()].filter((s) => s.state === 'error').length,
    })
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.sinks.clear()
  }
}

export class SuperpositionHub {
  constructor() {
    this.sessions = new Map()
    // Kurzlebiger Nachweis verdrängter Sitzungen: Ein später Kollaps soll „verdrängt“ von
    // „unbekannt“ unterscheiden können, statt beide Fälle als 404 zu melden.
    this.evicted = new Map()
    this.startedAt = Date.now()
    this.emitted = 0
    this.emittedWindow = []
    this.latencySamples = []
    this.ticker = setInterval(() => this.broadcastTelemetry(), TELEMETRY_INTERVAL_MS)
    this.reaper = setInterval(() => this.reap(), 60 * 1000)
    if (typeof this.ticker.unref === 'function') this.ticker.unref()
    if (typeof this.reaper.unref === 'function') this.reaper.unref()
  }

  createSession({ prompt, providers, settings }) {
    if (this.sessions.size >= MAX_SESSIONS) {
      const now = Date.now()
      const freeable = [...this.sessions.values()]
        .filter(
          (session) =>
            session.sinks.size === 0 &&
            now - (session.completedAt ?? session.lastAccess) > EVICTION_GRACE_MS &&
            (session.completed || now - session.lastAccess > SESSION_TTL_MS),
        )
        .sort((a, b) => a.lastAccess - b.lastAccess)
      const candidate = freeable[0]
      if (!candidate) {
        // Alle gehaltenen Sitzungen sind aktiv, werden noch beobachtet oder befinden sich in der
        // Schonfrist. Statt eine laufende Sitzung stillschweigend zu verdrängen, wird der neue
        // Auftrag sichtbar abgelehnt.
        throw new CapacityError(
          `Die Obergrenze von ${MAX_SESSIONS} gleichzeitigen Sitzungen ist erreicht und keine Sitzung kann derzeit freigegeben werden. Starten Sie den Auftrag später erneut.`,
        )
      }
      candidate.dispose()
      this.sessions.delete(candidate.id)
      this.evicted.set(candidate.id, Date.now())
      if (this.evicted.size > 500) {
        const cutoff = Date.now() - SESSION_TTL_MS
        for (const [id, at] of this.evicted) if (at < cutoff) this.evicted.delete(id)
      }
    }
    const id = crypto.randomUUID()
    const session = new Session({ id, prompt, providers, settings })
    const emit = session.emit.bind(session)
    session.emit = (event) => {
      this.recordEmit()
      if (event.type === 'provider:done') this.recordLatency(event.latencyMs)
      emit(event)
    }
    this.sessions.set(id, session)
    session.run()
    return session
  }

  get(id) {
    const session = this.sessions.get(id)
    if (session) session.lastAccess = Date.now()
    return session ?? null
  }

  /** Wurde die Sitzung wegen der Kapazitätsgrenze verdrängt (statt nie zu existieren)? */
  wasEvicted(id) {
    return this.evicted.has(String(id ?? ''))
  }

  recordEmit() {
    this.emitted += 1
    this.emittedWindow.push(Date.now())
  }

  recordLatency(ms) {
    this.latencySamples.push(ms)
    if (this.latencySamples.length > 200) this.latencySamples.shift()
  }

  stats(extra = {}) {
    const now = Date.now()
    this.emittedWindow = this.emittedWindow.filter((stamp) => now - stamp < 5000)
    const average =
      this.latencySamples.length > 0
        ? this.latencySamples.reduce((sum, value) => sum + value, 0) / this.latencySamples.length
        : 0
    const activeSockets = [...this.sessions.values()].reduce(
      (sum, session) => sum + session.sinks.size,
      0,
    )
    const memory = process.memoryUsage()
    const bufferedEvents = [...this.sessions.values()].reduce(
      (sum, session) => sum + session.events.length,
      0,
    )
    const bufferedChars = [...this.sessions.values()].reduce(
      (sum, session) => sum + session.bufferedChars,
      0,
    )
    const droppedEvents = [...this.sessions.values()].reduce(
      (sum, session) => sum + session.droppedEvents,
      0,
    )
    const truncatedSessions = [...this.sessions.values()].filter(
      (session) => session.truncated,
    ).length
    return {
      type: 'telemetry',
      at: new Date(now).toISOString(),
      activeSessions: this.sessions.size,
      activeSockets,
      bufferedEvents,
      bufferedChars,
      droppedEvents,
      truncatedSessions,
      bufferLimits: { events: MAX_BUFFERED_EVENTS, chars: MAX_BUFFERED_CHARS },
      messagesPerSecond: Number((this.emittedWindow.length / 5).toFixed(1)),
      totalMessages: this.emitted,
      avgLatencyMs: Math.round(average),
      uptimeSec: Math.round((now - this.startedAt) / 1000),
      maxSessions: MAX_SESSIONS,
      memory: {
        rssMb: Number((memory.rss / 1048576).toFixed(1)),
        heapUsedMb: Number((memory.heapUsed / 1048576).toFixed(1)),
      },
      ...extra,
    }
  }

  broadcastTelemetry() {
    const payload = this.stats()
    for (const session of this.sessions.values()) {
      if (session.sinks.size === 0) continue
      for (const sink of session.sinks) {
        try {
          sink.send(payload)
        } catch {
          session.sinks.delete(sink)
        }
      }
    }
  }

  reap() {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.sinks.size === 0 && now - session.lastAccess > SESSION_TTL_MS) {
        session.dispose()
        this.sessions.delete(id)
        this.evicted.set(id, Date.now())
      }
    }
  }

  shutdown() {
    clearInterval(this.ticker)
    clearInterval(this.reaper)
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    this.evicted.clear()
  }
}
