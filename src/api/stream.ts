export type TransportMode = 'verbindet' | 'websocket' | 'server-sent-events' | 'getrennt'

export interface StreamHandle {
  close: () => void
  mode: () => TransportMode
}

export type StreamEvent = Record<string, unknown> & { type: string }

interface OpenOptions {
  sessionId: string
  onEvent: (event: StreamEvent) => void
  onMode: (mode: TransportMode) => void
  fallbackDelayMs?: number
}

/**
 * Öffnet den Live-Kanal einer Sitzung.
 *
 * Bevorzugt wird ein WebSocket. Kommt der Upgrade innerhalb des Zeitfensters nicht zustande,
 * wechselt der Transport auf Server-Sent-Events. Der Wechsel erfolgt ausschließlich vor dem
 * ersten erfolgreichen Öffnen, damit keine doppelte Ereignisfolge entsteht.
 *
 * Das Zeitfenster ist bewusst großzügig: Auf der veröffentlichten Adresse dauert der Aufbau
 * über den vorgeschalteten Proxy gemessen 1,4 bis 3,3 Sekunden. Ein zu kurzes Fenster ließ die
 * Oberfläche fälschlich auf den unkomprimierten SSE-Weg ausweichen. Echte Fehlschläge melden
 * sich sofort über `onerror`/`onclose` und wechseln ohne Verzögerung.
 */
export function openSessionStream({
  sessionId,
  onEvent,
  onMode,
  fallbackDelayMs = 5000,
}: OpenOptions): StreamHandle {
  let socket: WebSocket | null = null
  let source: EventSource | null = null
  let closed = false
  let switched = false
  let mode: TransportMode = 'verbindet'

  const setMode = (next: TransportMode) => {
    mode = next
    onMode(next)
  }

  const startSse = () => {
    if (closed || switched) return
    switched = true
    socket?.close()
    socket = null
    source = new EventSource(`/api/stream/${encodeURIComponent(sessionId)}`)
    setMode('server-sent-events')
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as StreamEvent)
      } catch {
        /* Unlesbare Nutzlast ignorieren. */
      }
    }
    source.onerror = () => {
      if (closed) return
      setMode('getrennt')
    }
  }

  const timer = window.setTimeout(startSse, fallbackDelayMs)

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(`${protocol}://${window.location.host}/ws?session=${encodeURIComponent(sessionId)}`)

    socket.onopen = () => {
      if (closed) return
      window.clearTimeout(timer)
      setMode('websocket')
    }
    socket.onmessage = (message) => {
      try {
        onEvent(JSON.parse(String(message.data)) as StreamEvent)
      } catch {
        /* Unlesbare Nutzlast ignorieren. */
      }
    }
    socket.onerror = () => {
      if (closed) return
      if (mode !== 'websocket') startSse()
    }
    socket.onclose = () => {
      if (closed) return
      if (mode !== 'websocket') startSse()
      else setMode('getrennt')
    }
  } catch {
    startSse()
  }

  return {
    close: () => {
      closed = true
      window.clearTimeout(timer)
      socket?.close()
      source?.close()
      socket = null
      source = null
    },
    mode: () => mode,
  }
}
