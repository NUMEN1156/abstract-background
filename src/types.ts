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
  /** Getragene Aussagen dieses Modells nach der Konsensprüfung. */
  sentences?: number
  /** Als Isolat verworfene Aussagen dieses Modells. */
  isolates?: number
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
  jaccardThreshold?: number
  minAgreeingModels?: number
  sentenceCount?: number
  supportedSentences?: number
  isolates?: number
}

export interface CollapseResult {
  status: string
  rule?: string
  message?: string
  finalText: string
  /**
   * Vom Kollaps ausgewiesene Entscheidung: die am stärksten gestützte Antwortzeile der Kanäle.
   * Kurze Antwortzeilen sind die kürzesten und wichtigsten Zeilen einer Ausgabe; ohne diese
   * Ausweisung trägt der Bericht nur die ähnlichste Prosa.
   */
  decision?: {
    line: string
    value: string
    supporters: number
    evaluatedVerdicts: number
    channels: string[]
    tieBreak: boolean
  } | null
  collapsedAt?: string
  primary?: { providerId: string; label: string; model: string; share: number }
  protocol: ProtocolStep[]
  metrics: CollapseMetrics | null
  consensus?: ConsensusReport | null
  convergenceIndex?: number
  coherenceMatrix?: Record<string, Record<string, number>>
  coherence: { ids?: string[]; pair: string[]; overlap: number }[]
}

export interface ConsensusAssessment {
  providerId: string
  label: string
  sentence: string
  supportCount: number
  supportLabels: string[]
  bestOverlap: number
  consensusScore: number
  share: number
  score: number
}

/** Ergebnis der satzweisen Konsensprüfung: was das Ergebnis trägt und was verworfen wurde. */
export interface ConsensusReport {
  threshold: number
  minAgreeingModels: number
  sentenceCount: number
  supportedCount: number
  isolateCount: number
  byModel: Record<string, { supported: number; isolates: number }>
  topSupported: ConsensusAssessment[]
  isolates: {
    providerId: string
    label: string
    sentence: string
    supportCount: number
    bestOverlap: number
  }[]
  carried: ConsensusAssessment[]
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
  /** Ab dieser Jaccard-Ähnlichkeit gelten zwei Aussagen als übereinstimmend (0,05–0,5). */
  jaccardThreshold: number
  /** So viele Modelle müssen eine Aussage mindestens stützen (1–6). */
  minAgreeingModels: number
}

export interface SessionMeta {
  id: string
  prompt: string
  createdAt: string
}
