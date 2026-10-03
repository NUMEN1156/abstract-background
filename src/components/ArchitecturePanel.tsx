import type { ArchitectureReport, SecurityReport } from '../types'
import { formatClock } from '../utils/format'

interface Props {
  architecture: ArchitectureReport | null
  security: SecurityReport | null
}

export function ArchitecturePanel({ architecture, security }: Props) {
  return (
    <section className="panel" aria-labelledby="arch-title">
      <header className="panel__head">
        <h2 id="arch-title">Architektur und Sicherheitsstatus</h2>
        <span className={`chip ${security?.frontendExposure ? 'chip--error' : 'chip--complete'}`}>
          <i className="chip__dot" aria-hidden="true" />
          {security?.frontendExposure ? 'Exposition erkannt' : 'keine Schlüssel im Frontend'}
        </span>
      </header>

      <div className="arch">
        <ul className="arch__stack">
          {architecture ? (
            <>
              <li>
                <span className="label">Frontend</span>
                <strong>{architecture.frontend.name}</strong>
                <p>{architecture.frontend.detail}</p>
              </li>
              <li>
                <span className="label">Backend</span>
                <strong>{architecture.backend.name}</strong>
                <p>{architecture.backend.detail}</p>
              </li>
              <li>
                <span className="label">Transport</span>
                <strong>
                  {architecture.transport.primary} · Rückfall {architecture.transport.fallback}
                </strong>
                <p>{architecture.transport.detail}</p>
              </li>
              <li>
                <span className="label">Adapter</span>
                <strong>Modulare Registry</strong>
                <p>{architecture.adapters.detail}</p>
              </li>
              <li>
                <span className="label">Sicherheit</span>
                <strong>AES-256-GCM · serverseitig</strong>
                <p>{architecture.security.detail}</p>
              </li>
              <li>
                <span className="label">Simulation</span>
                <strong>Gemessene Ströme</strong>
                <p>{architecture.simulation.detail}</p>
              </li>
            </>
          ) : (
            <li className="panel__empty">Architekturbericht wird geladen …</li>
          )}
        </ul>

        <div className="arch__vault">
          <h3>Schlüsseltresor</h3>
          <dl className="vault">
            <div>
              <dt>Verfahren</dt>
              <dd className="mono">{security?.algorithm ?? '—'}</dd>
            </div>
            <div>
              <dt>Schlüsselherkunft</dt>
              <dd className="mono">{security?.keyOrigin ?? '—'}</dd>
            </div>
            <div>
              <dt>Geheimnisse</dt>
              <dd className="mono">{security ? security.entries.length : '—'}</dd>
            </div>
          </dl>

          <ul className="vault__entries">
            {(security?.entries ?? []).slice(0, 8).map((entry) => (
              <li key={entry.providerId}>
                <span className="mono vault__id">{entry.providerId}</span>
                <span className="mono vault__hint">{entry.hint ?? '—'}</span>
                <span className="mono vault__fingerprint">
                  {entry.fingerprint ? `FP ${entry.fingerprint}` : 'kein Eintrag'}
                </span>
                {entry.updatedAt ? (
                  <span className="mono vault__time">{formatClock(entry.updatedAt)}</span>
                ) : null}
              </li>
            ))}
          </ul>

          <ul className="vault__measures">
            {(security?.measures ?? []).map((measure) => (
              <li key={measure}>{measure}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}