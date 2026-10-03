import type { CollapseResult } from '../types'
import { formatClock, formatMs, formatNumber, formatPercent } from '../utils/format'

const ROLE_CLASS: Record<string, string> = {
  Träger: 'traeger',
  Ergänzung: 'ergaenzung',
  Randnotiz: 'randnotiz',
}

interface Props {
  result: CollapseResult
  accentOf: (label: string) => string
}

export function ResultPanel({ result, accentOf }: Props) {
  const metrics = result.metrics

  return (
    <section className="panel panel--result" aria-labelledby="result-title">
      <header className="panel__head">
        <h2 id="result-title">Finales Ergebnis</h2>
        <span className="mono panel__value">
          {result.collapsedAt ? formatClock(result.collapsedAt) : '—'}
        </span>
      </header>

      {result.status !== 'kollabiert' ? (
        <p className="panel__empty">{result.message}</p>
      ) : (
        <>
          <div className="result__carrier">
            <span className="label">Träger der Kernaussage</span>
            <strong style={{ color: accentOf(result.primary?.label ?? '') }}>
              {result.primary?.label}
            </strong>
            <span className="mono">{result.primary?.model}</span>
            <span className="mono">{formatPercent(result.primary?.share ?? 0, 1)}</span>
          </div>

          <pre className="result__text">{result.finalText}</pre>

          {metrics ? (
            <dl className="result__metrics">
              <div>
                <dt>Konvergenz-Index</dt>
                <dd className="mono">{metrics.convergence.toFixed(3)}</dd>
                <span>Nähe zur Einigkeit der Gewichte (1 = ein Träger)</span>
              </div>
              <div>
                <dt>Modellgüte</dt>
                <dd className="mono">{formatPercent(metrics.confidence, 1)}</dd>
                <span>Gewichtetes Mittel der Selbstbewertungen</span>
              </div>
              <div>
                <dt>Beiträge</dt>
                <dd className="mono">{metrics.contributors}</dd>
                <span>
                  {metrics.supporters} Ergänzungen · {metrics.notes} Randnotizen
                </span>
              </div>
              <div>
                <dt>Umfang</dt>
                <dd className="mono">{formatNumber(metrics.tokens)}</dd>
                <span>Token · mittlere Laufzeit {formatMs(metrics.latencyMs)}</span>
              </div>
            </dl>
          ) : null}

          <div className="result__block">
            <h3>Kollaps-Protokoll</h3>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Modell</th>
                    <th scope="col">Rolle</th>
                    <th scope="col">Gewicht</th>
                    <th scope="col">Anteil</th>
                    <th scope="col">Token</th>
                    <th scope="col">Laufzeit</th>
                  </tr>
                </thead>
                <tbody>
                  {result.protocol.map((step) => (
                    <tr key={step.providerId}>
                      <td className="mono">{String(step.step).padStart(2, '0')}</td>
                      <td>
                        <span className="swatch" style={{ background: accentOf(step.label) }} aria-hidden="true" />
                        {step.label}
                        <span className="table__sub mono">{step.model}</span>
                      </td>
                      <td>
                        <span className={`role role--${ROLE_CLASS[step.contribution] ?? 'randnotiz'}`}>
                          {step.contribution}
                        </span>
                      </td>
                      <td className="mono">{step.weight}</td>
                      <td className="mono">{formatPercent(step.share, 1)}</td>
                      <td className="mono">{formatNumber(step.tokens)}</td>
                      <td className="mono">{formatMs(step.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.coherence.length > 0 ? (
            <div className="result__block">
              <h3>Kohärenz zwischen den Modellen</h3>
              <ul className="coherence">
                {result.coherence.map((entry) => (
                  <li key={entry.pair.join('-')}>
                    <span className="coherence__pair">
                      {entry.pair[0]} ↔ {entry.pair[1]}
                    </span>
                    <span className="coherence__track">
                      <span
                        className="coherence__bar"
                        style={{ width: `${Math.max(entry.overlap * 100, 2)}%` }}
                      />
                    </span>
                    <span className="mono">{formatPercent(entry.overlap, 0)}</span>
                  </li>
                ))}
              </ul>
              <p className="panel__hint">
                Geringe Überlappung markiert Stellen, die vor einer Entscheidung einzeln zu prüfen sind.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
