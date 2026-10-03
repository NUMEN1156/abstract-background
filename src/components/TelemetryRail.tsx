import type { LogEntry, Telemetry } from '../types'
import { formatMs, formatNumber } from '../utils/format'

interface Props {
  telemetry: Telemetry | null
  history: number[]
  log: LogEntry[]
}

export function TelemetryRail({ telemetry, history, log }: Props) {
  const peak = Math.max(1, ...history)

  return (
    <aside className="rail rail--left" aria-label="Telemetrie und Protokoll">
      <section className="panel panel--tight">
        <header className="panel__head">
          <h2>Telemetrie</h2>
        </header>
        <dl className="telemetry">
          <div>
            <dt>Meldungen/s</dt>
            <dd className="mono">{telemetry ? telemetry.messagesPerSecond.toFixed(1) : '—'}</dd>
          </div>
          <div>
            <dt>Kanäle offen</dt>
            <dd className="mono">{telemetry ? telemetry.activeSockets : '—'}</dd>
          </div>
          <div>
            <dt>Sitzungen</dt>
            <dd className="mono">{telemetry ? telemetry.activeSessions : '—'}</dd>
          </div>
          <div>
            <dt>Ø Laufzeit</dt>
            <dd className="mono">{telemetry ? formatMs(telemetry.avgLatencyMs) : '—'}</dd>
          </div>
          <div>
            <dt>Meldungen total</dt>
            <dd className="mono">{telemetry ? formatNumber(telemetry.totalMessages) : '—'}</dd>
          </div>
        </dl>

        <div className="spark" aria-hidden="true">
          {history.length === 0 ? (
            <span className="spark__empty">kein Verlauf</span>
          ) : (
            history.map((value, index) => (
              <span
                key={`${index}-${value}`}
                className="spark__bar"
                style={{ height: `${Math.max(4, (value / peak) * 100)}%` }}
              />
            ))
          )}
        </div>
      </section>

      <section className="panel panel--tight panel--log">
        <header className="panel__head">
          <h2>Protokoll</h2>
          <span className="mono panel__value">{log.length}</span>
        </header>
        <ul className="log">
          {log.length === 0 ? (
            <li className="log__empty">Noch keine Ereignisse.</li>
          ) : (
            log.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className={`log__item log__item--${entry.level}`}>
                <span className="mono log__time">
                  {new Date(entry.at).toLocaleTimeString('de-DE', { hour12: false })}
                </span>
                <span className="log__text">{entry.text}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </aside>
  )
}