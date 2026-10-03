import type { Phase } from '../state/useSuperposition'
import { formatPercent } from '../utils/format'

interface Entry {
  id: string
  label: string
  accent: string
  weight: number
  share: number
}

interface Props {
  distribution: Entry[]
  total: number
  phase: Phase
  canCollapse: boolean
  onNormalize: () => void
  onCollapse: () => void
}

export function WeightPanel({ distribution, total, phase, canCollapse, onNormalize, onCollapse }: Props) {
  const collapsing = phase === 'kollabierend'

  return (
    <section className="panel" aria-labelledby="weights-title">
      <header className="panel__head">
        <h2 id="weights-title">Gewichtungsverteilung</h2>
        <span className="mono panel__value">Σ {total}</span>
      </header>

      {distribution.length === 0 ? (
        <p className="panel__empty">Noch keine Kanäle. Starten Sie eine Superposition.</p>
      ) : (
        <ul className="distribution">
          {distribution.map((entry) => (
            <li key={entry.id}>
              <div className="distribution__row">
                <span className="distribution__label">{entry.label}</span>
                <span className="mono distribution__value">
                  {formatPercent(entry.share, 1)}
                </span>
              </div>
              <div className="distribution__track">
                <span
                  className="distribution__bar"
                  style={{
                    width: `${Math.max(entry.share * 100, entry.share > 0 ? 1.5 : 0)}%`,
                    background: entry.accent,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="panel__actions">
        <button type="button" className="btn btn--ghost" onClick={onNormalize} disabled={distribution.length === 0}>
          Gleichverteilen
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onCollapse}
          disabled={!canCollapse || collapsing}
        >
          {collapsing ? 'Kollaps läuft …' : 'Kollaps einleiten'}
        </button>
      </div>
      <p className="panel__hint">
        Der Kollaps verändert keine Einzelantwort. Er bestimmt einen Träger, ordnet Ergänzungen zu und
        protokolliert jeden Schritt.
      </p>
    </section>
  )
}