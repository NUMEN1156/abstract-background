import type {
  AdapterRecord,
  ArchitectureReport,
  CollapseResult,
  SecurityReport,
  StartSettings,
} from '../types'

export class ApiError extends Error {
  field?: string

  constructor(message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.field = field
  }
}

/**
 * Zugangsschlüssel für die schreibenden Aufrufe. Er wird nur gesetzt, wenn der Server einen
 * Schlüssel verlangt; ohne gesetzten Wert bleiben die Aufrufe unverändert offen.
 */
let apiKey = ''

export function setApiKey(value: string) {
  apiKey = value.trim()
}

export function getApiKey() {
  return apiKey
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey.length > 0 ? { 'X-Api-Key': apiKey } : {}),
      ...(init?.headers ?? {}),
    },
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; field?: string }
    throw new ApiError(body.error ?? `Anfrage fehlgeschlagen (HTTP ${response.status}).`, body.field)
  }
  return payload as T
}

export const api = {
  health: () => request<{ status: string; mode: string }>('/api/health'),

  access: () =>
    request<{
      required: boolean
      adapterWrites: 'open' | 'key' | 'locked'
      scheme: string
      protectedPaths: string[]
      adapterWriteDetail?: string
      detail: string
    }>('/api/access'),

  architecture: () => request<ArchitectureReport>('/api/architecture'),

  security: () => request<SecurityReport>('/api/security'),

  adapters: () => request<{ adapters: AdapterRecord[] }>('/api/adapters'),

  createAdapter: (input: Record<string, unknown>) =>
    request<{ ok: boolean; adapter: AdapterRecord }>('/api/adapters', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateAdapter: (id: string, patch: Record<string, unknown>) =>
    request<{ ok: boolean; adapter: AdapterRecord }>(`/api/adapters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  removeAdapter: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/adapters/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  startSuperposition: (input: {
    prompt: string
    providerIds: string[]
    collapseRule: string
    injectFailure: boolean
    temperature: number
  }) =>
    request<{
      ok: boolean
      sessionId: string
      prompt: string
      providers: {
        id: string
        label: string
        model: string
        accent: string
        glyph: string
        weightDefault: number
      }[]
      settings: StartSettings
      wsPath: string
      ssePath: string
    }>('/api/superposition', { method: 'POST', body: JSON.stringify(input) }),

  collapse: (
    sessionId: string,
    weights: Record<string, number>,
    consensus?: { jaccardThreshold: number; minAgreeingModels: number },
  ) =>
    request<{ ok: boolean; sessionId: string; result: CollapseResult }>('/api/collapse', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        weights,
        ...(consensus
          ? {
              jaccardThreshold: consensus.jaccardThreshold,
              minAgreeingModels: consensus.minAgreeingModels,
            }
          : {}),
      }),
    }),
}
