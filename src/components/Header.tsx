import type { Telemetry } from '../types'
import type { Phase, } from '../state/useSuperposition'
import type { TransportMode } from '../api/stream'
import { formatDuration } from '../utils/format'

interface Props {
  phase: Phase
  transport: TransportMode
  telemetry: Telemetry | null
  completedChannels: number
  totalChannels: number
  hasSession: boolean
}

const PHASE_TEXT: Record<Phase, string> = {
  leer: 'bereit',
  startet: 'Auftrag wird angenommen',
  laeuft: 'Superposition aktiv',
  gesetzt: 'Kanäle abgeschlossen',
  kollabierend: 'Kollaps läuft',
  kollabiert: 'Kollaps abgeschlossen',
}

const TRANSPORT_TEXT: Record<TransportMode, string> = {
  verbindet: 'Kanal wird aufgebaut',
  websocket: 'WebSocket',
  'server-sent-events': 'Server-Sent-Events',
  getrennt: 'kein Live-Kanal',
}

export function Header({ phase, transport, telemetry, completedChannels, totalChannels, hasSession }: Props) {
  return (
    <header className="masthead">
      <div className="masthead__brand">
        <svg viewBox="0 0 44 44" className="mark" aria-hidden="true">
          <rect x="2" y="2" width="40" height="40" rx="9" className="mark__frame" />
          <path d="M9 28 C 15 18, 20 34, 26 24 S 33 14, 36 20" className="mark__wave mark__wave--a" />
          <path d="M9 22 C 15 30, 21 14, 27 24 S 33 30, 36 24" className="mark__wave mark__wave--b" />
        </svg>
        <div>
          <h1 className="wordmark">
            ABSTRACT<span>/</span>BACKGROUND
          </h1>
          <p className="masthead__claim">AI-Superposition-Enterprise-Middleware</p>
        </div>
      </div>

      <div className="masthead__status">
        <div className={`statusPill statusPill--${phase}`}>
          <i className="chip__dot" aria-hidden="true" />
          {PHASE_TEXT[phase]}
        </div>
        <div className="statusReadouts mono">
          <span>
            <em>Transport</em> {TRANSPORT_TEXT[transport]}
          </span>
          <span>
            <em>Kanäle</em> {completedChannels}/{totalChannels || '–'}
          </span>
          <span>
            <em>Laufzeit</em> {telemetry ? formatDuration(telemetry.uptimeSec) : '—'}
          </span>
          <span>
            <em>Sitzung</em> {hasSession ? 'verbunden' : 'keine'}
          </span>
        </div>
      </div>
    </header>
  )
}