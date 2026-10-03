import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, api } from '../api/client'
import {
  openSessionStream,
  type StreamEvent,
  type StreamHandle,
  type TransportMode,
} from '../api/stream'
import type {
  AdapterRecord,
  ChannelState,
  CollapseResult,
  LogEntry,
  ProviderSummary,
  SecurityReport,
  SessionMeta,
  StartSettings,
  Telemetry,
} from '../types'

export type Phase = 'leer' | 'startet' | 'laeuft' | 'gesetzt' | 'kollabierend' | 'kollabiert'

const MAX_LOG = 90
const MAX_HISTORY = 40

const emptyChannel = (id: string): ChannelState => ({
  id,
  state: 'queued',
  text: '',
  tokens: 0,
  latencyMs: 0,
  error: null,
})

export function useSuperposition() {
  const [adapters, setAdapters] = useState<AdapterRecord[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [prompt, setPrompt] = useState(
    'Wie setzt ein Unternehmen mehrere KI-Modelle gleichzeitig ein, ohne die Nachvollziehbarkeit der Entscheidung zu verlieren?',
  )
  const [settings, setSettings] = useState<StartSettings>({
    collapseRule: 'gewichtete-synthese',
    injectFailure: false,
    temperature: 0.4,
  })
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [channels, setChannels] = useState<Record<string, ChannelState>>({})
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [session, setSession] = useState<SessionMeta | null>(null)
  const [phase, setPhase] = useState<Phase>('leer')
  const [collapseStage, setCollapseStage] = useState(0)
  const [result, setResult] = useState<CollapseResult | null>(null)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [history, setHistory] = useState<number[]>([])
  const [transport, setTransport] = useState<TransportMode>('getrennt')
  const [log, setLog] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [security, setSecurity] = useState<SecurityReport | null>(null)

  const handleRef = useRef<StreamHandle | null>(null)
  const timersRef = useRef<number[]>([])
  const startedAtRef = useRef<number | null>(null)

  const pushLog = useCallback((level: LogEntry['level'], text: string) => {
    setLog((prev) => [
      { at: new Date().toISOString(), level, text },
      ...prev.slice(0, MAX_LOG - 1),
    ])
  }, [])

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer)
    timersRef.current = []
  }, [])

  const later = useCallback((fn: () => void, delay: number) => {
    const timer = window.setTimeout(fn, delay)
    timersRef.current.push(timer)
  }, [])

  /* ---------------------------------------------------------------- */
  /* Ereignisverarbeitung des Live-Kanals                              */
  /* ---------------------------------------------------------------- */

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case 'session:snapshot': {
          const list = (event.providers as ProviderSummary[]) ?? []
          setProviders(list)
          setSession({
            id: String(event.sessionId),
            prompt: String(event.prompt ?? ''),
            createdAt: String(event.createdAt ?? new Date().toISOString()),
          })
          setChannels(Object.fromEntries(list.map((provider) => [provider.id, emptyChannel(provider.id)])))
          setWeights((prev) => {
            const next: Record<string, number> = {}
            for (const provider of list) {
              next[provider.id] = prev[provider.id] ?? provider.weightDefault ?? 25
            }
            return next
          })
          pushLog(
            'info',
            `Sitzung ${String(event.sessionId).slice(0, 8)} verbunden · ${String(event.replayed ?? 0)} gepufferte Ereignisse nachgespielt`,
          )
          break
        }
        case 'session:start': {
          startedAtRef.current = Date.now()
          setPhase('laeuft')
          pushLog('info', `Superposition gestartet · Transport ${String(event.transport ?? 'websocket')}`)
          break
        }
        case 'provider:state': {
          const id = String(event.providerId)
          const state = event.state as ChannelState['state']
          setChannels((prev) => ({
            ...prev,
            [id]: { ...(prev[id] ?? emptyChannel(id)), state },
          }))
          break
        }
        case 'provider:chunk': {
          const id = String(event.providerId)
          const delta = String(event.delta ?? '')
          setChannels((prev) => {
            const current = prev[id] ?? emptyChannel(id)
            return {
              ...prev,
              [id]: {
                ...current,
                state: current.state === 'complete' ? current.state : 'streaming',
                text: current.text + delta,
                tokens: Number(event.tokens ?? current.tokens),
              },
            }
          })
          break
        }
        case 'provider:done': {
          const id = String(event.providerId)
          setChannels((prev) => {
            const current = prev[id] ?? emptyChannel(id)
            return {
              ...prev,
              [id]: {
                ...current,
                state: 'complete',
                latencyMs: Number(event.latencyMs ?? current.latencyMs),
                tokens: Number(event.tokens ?? current.tokens),
              },
            }
          })
          pushLog('ok', `${id}-Kanal abgeschlossen in ${Math.round(Number(event.latencyMs ?? 0))} ms`)
          break
        }
        case 'provider:error': {
          const id = String(event.providerId)
          setChannels((prev) => {
            const current = prev[id] ?? emptyChannel(id)
            return {
              ...prev,
              [id]: { ...current, state: 'error', error: String(event.message ?? 'Unbekannter Fehler') },
            }
          })
          pushLog('error', `${id}-Kanal gestört: ${String(event.message ?? '')}`)
          break
        }
        case 'session:done': {
          setPhase('gesetzt')
          pushLog(
            'ok',
            `Alle Kanäle abgeschlossen · ${String(event.completed ?? 0)} erfolgreich, ${String(event.failed ?? 0)} gestört`,
          )
          break
        }
        case 'telemetry': {
          const payload = event as unknown as Telemetry
          setTelemetry(payload)
          setHistory((prev) => [...prev.slice(-(MAX_HISTORY - 1)), payload.messagesPerSecond])
          break
        }
        case 'fatal': {
          setError(String(event.message ?? 'Der Live-Kanal wurde vom Server abgelehnt.'))
          pushLog('error', String(event.message ?? 'Kanal abgelehnt'))
          break
        }
        default:
          break
      }
    },
    [pushLog],
  )

  /* ---------------------------------------------------------------- */
  /* Adapter und Sicherheitsbericht laden                              */
  /* ---------------------------------------------------------------- */

  const refreshAdapters = useCallback(async () => {
    try {
      const { adapters: list } = await api.adapters()
      setAdapters(list)
      const usable = new Set(list.filter((adapter) => adapter.enabled).map((adapter) => adapter.id))
      setSelectedIds((prev) => {
        if (prev.length > 0) return prev.filter((id) => usable.has(id))
        return list.filter((adapter) => adapter.enabled).map((adapter) => adapter.id)
      })
    } catch (cause) {
      pushLog('error', cause instanceof Error ? cause.message : 'Adapterliste nicht erreichbar')
    }
  }, [pushLog])

  useEffect(() => {
    void refreshAdapters()
    api
      .security()
      .then(setSecurity)
      .catch(() => pushLog('warn', 'Sicherheitsbericht konnte nicht geladen werden'))
  }, [refreshAdapters, pushLog])

  useEffect(
    () => () => {
      handleRef.current?.close()
      clearTimers()
    },
    [clearTimers],
  )

  /* ---------------------------------------------------------------- */
  /* Aktionen                                                          */
  /* ---------------------------------------------------------------- */

  const start = useCallback(async () => {
    if (prompt.trim().length < 8) {
      setError('Die Anfrage muss mindestens 8 Zeichen enthalten.')
      return
    }
    setError(null)
    setResult(null)
    setPhase('startet')
    clearTimers()
    handleRef.current?.close()
    handleRef.current = null

    try {
      const response = await api.startSuperposition({
        prompt: prompt.trim(),
        providerIds: selectedIds,
        collapseRule: settings.collapseRule,
        injectFailure: settings.injectFailure,
        temperature: settings.temperature,
      })
      pushLog('info', `Auftrag angenommen · ${response.providers.length} Adapter in Superposition`)

      handleRef.current = openSessionStream({
        sessionId: response.sessionId,
        onEvent: handleEvent,
        onMode: (mode) => {
          setTransport(mode)
          if (mode === 'server-sent-events') {
            pushLog('warn', 'WebSocket nicht verfügbar — Wechsel auf Server-Sent-Events')
          }
        },
      })
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : 'Die Superposition konnte nicht gestartet werden.'
      setError(message)
      setPhase('leer')
      pushLog('error', message)
    }
  }, [clearTimers, handleEvent, prompt, pushLog, selectedIds, settings])

  const collapseNow = useCallback(async () => {
    if (!session) return
    setError(null)
    setPhase('kollabierend')
    setCollapseStage(1)

    later(() => setCollapseStage(2), 620)
    later(() => setCollapseStage(3), 1320)

    const began = Date.now()
    try {
      const response = await api.collapse(session.id, weights)
      const elapsed = Date.now() - began
      const remaining = Math.max(0, 1900 - elapsed)
      later(() => {
        setResult(response.result)
        setCollapseStage(4)
        setPhase('kollabiert')
        pushLog(
          'ok',
          `Kollaps abgeschlossen · Träger ${response.result.primary?.label ?? '—'} · Konvergenz-Index ${(
            (response.result.metrics?.convergenceIndex ?? 0) * 100
          ).toFixed(1)} %`,
        )
      }, remaining)
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Der Kollaps ist fehlgeschlagen.'
      setError(message)
      setPhase('gesetzt')
      setCollapseStage(0)
      pushLog('error', message)
    }
  }, [later, pushLog, session, weights])

  const reset = useCallback(() => {
    handleRef.current?.close()
    handleRef.current = null
    clearTimers()
    setChannels({})
    setProviders([])
    setSession(null)
    setResult(null)
    setPhase('leer')
    setCollapseStage(0)
    setError(null)
    setTransport('getrennt')
    pushLog('info', 'Arbeitsfläche zurückgesetzt')
  }, [clearTimers, pushLog])

  const setWeight = useCallback((id: string, value: number) => {
    setWeights((prev) => ({ ...prev, [id]: Math.max(0, Math.min(100, Math.round(value))) }))
  }, [])

  const normalizeWeights = useCallback(() => {
    setWeights((prev) => {
      const ids = Object.keys(prev)
      if (ids.length === 0) return prev
      const share = Math.round((100 / ids.length) * 10) / 10
      return Object.fromEntries(ids.map((id) => [id, share]))
    })
  }, [])

  const toggleProvider = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }, [])

  const createAdapter = useCallback(
    async (input: Record<string, unknown>) => {
      const response = await api.createAdapter(input)
      pushLog('ok', `Adapter „${response.adapter.label}“ registriert · Kennung ${response.adapter.id}`)
      await refreshAdapters()
      setSelectedIds((prev) => [...prev, response.adapter.id])
      return response.adapter
    },
    [pushLog, refreshAdapters],
  )

  const setAdapterEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await api.updateAdapter(id, { enabled })
        pushLog('info', `Adapter ${id} ${enabled ? 'aktiviert' : 'deaktiviert'}`)
        await refreshAdapters()
      } catch (cause) {
        const message =
          cause instanceof ApiError ? cause.message : `Adapter ${id} konnte nicht umgeschaltet werden.`
        pushLog('error', message)
        throw cause
      }
    },
    [pushLog, refreshAdapters],
  )

  const deleteAdapter = useCallback(
    async (id: string) => {
      await api.removeAdapter(id)
      pushLog('warn', `Adapter ${id} entfernt`)
      await refreshAdapters()
    },
    [pushLog, refreshAdapters],
  )

  /* ---------------------------------------------------------------- */
  /* Abgeleitete Werte                                                 */
  /* ---------------------------------------------------------------- */

  const channelList = useMemo(
    () =>
      providers.map((provider) => ({
        provider,
        channel: channels[provider.id] ?? emptyChannel(provider.id),
        weight: weights[provider.id] ?? 0,
      })),
    [channels, providers, weights],
  )

  const weightTotal = useMemo(
    () => channelList.reduce((sum, entry) => sum + entry.weight, 0),
    [channelList],
  )

  const distribution = useMemo(
    () =>
      channelList.map((entry) => ({
        id: entry.provider.id,
        label: entry.provider.label,
        accent: entry.provider.accent,
        weight: entry.weight,
        share: weightTotal > 0 ? entry.weight / weightTotal : 0,
      })),
    [channelList, weightTotal],
  )

  const running = phase === 'startet' || phase === 'laeuft'
  const completedChannels = channelList.filter((entry) => entry.channel.state === 'complete').length

  return {
    adapters,
    selectedIds,
    prompt,
    setPrompt,
    settings,
    setSettings,
    providers,
    channels,
    channelList,
    weights,
    setWeight,
    normalizeWeights,
    distribution,
    weightTotal,
    session,
    phase,
    collapseStage,
    result,
    telemetry,
    history,
    transport,
    log,
    error,
    security,
    running,
    completedChannels,
    startedAt: startedAtRef.current,
    start,
    collapseNow,
    reset,
    toggleProvider,
    createAdapter,
    setAdapterEnabled,
    deleteAdapter,
    refreshAdapters,
  }
}

export type SuperpositionStore = ReturnType<typeof useSuperposition>
