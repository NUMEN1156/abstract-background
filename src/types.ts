export type StreamState = 'idle' | 'queued' | 'connecting' | 'streaming' | 'complete' | 'error'

export interface ProviderSummary {
  id: string
  label: string
  vendor: string
  model: string
  accent: string
  glyph: string
  persona: string
  summary: string
  capabilities: string[]
  confidence: number
  weightDefault: number
}

export interface AdapterRecord extends ProviderSummary {
  endpoint: string
  enabled: boolean
  builtIn: boolean
  createdAt?: string
  style?: string
  latencyBase?: number
  secret?: { present: boolean; hint?: string; fingerprint?: string }
}

export interface ChannelState {
  id: string
  state: StreamState
  text: string
  tokens: number
  latencyMs: number
  error: string | null
}

export interface Telemetry {
  at: string
  activeSessions: number
  activeSockets: number
  messagesPerSecond: number
  totalMessages: number
  avgLatencyMs: number
  uptimeSec: number
  bufferedEvents?: number
  bufferedChars?: number
  droppedEvents?: number
  truncatedSessions?: number
  bufferLimits?: { events: number; chars: number }
  maxSessions?: number
  memory?: { rssMb: number; heapUsedMb: number }
}

export interface ProtocolStep {
  step: number
  providerId: string
  label: string
  model: string
  weight: number
  share: number
  sharePct: number
  contribution: 'Träger' | 'Ergänzung' | 'Randnotiz'
  tokens: number
  latencyMs: number
  confidence: number | null
}

export interface CollapseMetrics {
  convergenceIndex: number
  weightConcentration: number
  confidence: number
  tokens: number
  latencyMs: number
  contributors: number
  supporters: number
  notes: number
}

export interface CollapseResult {
  status: string
  rule?: string
  message?: string
  finalText: string
  collapsedAt?: string
  primary?: { providerId: string; label: string; model: string; share: number }
  protocol: ProtocolStep[]
  metrics: CollapseMetrics | null
  convergenceIndex?: number
  coherenceMatrix?: Record<string, Record<string, number>>
  coherence: { ids?: string[]; pair: string[]; overlap: number }[]
}

export interface SecurityReport {
  algorithm: string
  keyOrigin: string
  frontendExposure: boolean
  measures: string[]
  entries: {
    providerId: string
    present: boolean
    hint?: string
    fingerprint?: string
    updatedAt?: string
    ciphertextBytes?: number
  }[]
}

export interface ArchitectureReport {
  frontend: { name: string; detail: string }
  backend: { name: string; detail: string }
  transport: { primary: string; fallback: string; detail: string }
  adapters: { detail: string }
  security: { detail: string }
  simulation: { detail: string }
}

export interface LogEntry {
  at: string
  level: 'info' | 'warn' | 'ok' | 'error'
  text: string
}

export interface StartSettings {
  collapseRule: string
  injectFailure: boolean
  temperature: number
}

export interface SessionMeta {
  id: string
  prompt: string
  createdAt: string
}
