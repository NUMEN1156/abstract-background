import type { CollapseResult } from '../types'
import { formatClock, formatMs, formatNumber, formatPercent } from '../utils/format'

const ROLE_CLASS: Record<string, string> = {
  Träger: 'traeger',
  Ergänzung: 'ergaenzung',
  Randnotiz: 'randnotiz',
}

const RULE_LABEL: Record<string, string> = {
  'gewichtete-synthese': 'Gewichtete Synthese',
  'bester-traeger': 'Bester Träger',
  'konsens-erzwingen': 'Konsens erzwingen',
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
        <div className="panel__headActions">
          {result.rule ? (
            <span className="ruleBadge">{RULE_LABEL[result.rule] ?? result.rule}</span>
          ) : null}
          <span className="mono panel__value">
            {result.collapsedAt ? formatClock(result.collapsedAt) : '—'}
          </span>
        </div>
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

          {result.decision ? (
            <div className="result__decision">
              <span className="label">Entscheidung</span>
              <strong className="result__decisionLine">{result.decision.line}</strong>
              <span className="mono result__decisionMeta">
                {result.decision.supporters}/{result.decision.evaluatedVerdicts} Antwortzeilen
                {result.decision.tieBreak ? ' · Gleichstand über Gewicht entschieden' : ''}
              </span>
            </div>
          ) : null}

          <pre className="result__text">{result.finalText}</pre>

          {metrics ? (
            <dl className="result__metrics">
              <div>
                <dt>Konvergenz-Index</dt>
                <dd className="mono">{formatPercent(metrics.convergenceIndex, 1)}</dd>
                <span>
                  Mittlere paarweise Kohärenz der Ausgaben ({metrics.convergenceIndex.toFixed(3)})
                </span>
              </div>
              <div>
                <dt>Gewichtskonzentration</dt>
                <dd className="mono">{metrics.weightConcentration.toFixed(3)}</dd>
                <span>Summe der quadrierten Gewichtsanteile (1 = ein Träger)</span>
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
              {result.consensus ? (
                <div>
                  <dt>Konsens</dt>
                  <dd className="mono">
                    {result.consensus.supportedCount}/{result.consensus.sentenceCount}
                  </dd>
                  <span>
                    Aussagen gestützt · {result.consensus.isolateCount} Isolate verworfen
                    (Schwelle {result.consensus.threshold.toFixed(2)}, mindestens{' '}
                    {result.consensus.minAgreeingModels} Modelle)
                  </span>
                </div>
              ) : null}
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
                    <th scope="col">Getragen</th>
                    <th scope="col">Isolate</th>
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
                      <td className="mono">{step.sentences ?? 0}</td>
                      <td className="mono">{step.isolates ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.coherenceMatrix && result.protocol.length > 1 ? (
            <div className="result__block">
              <h3>Kohärenzmatrix aller Modellpaare</h3>
              <div className="tableWrap">
                <table className="matrix">
                  <thead>
                    <tr>
                      <th scope="col">Modell</th>
                      {result.protocol.map((step) => (
                        <th key={step.providerId} scope="col">
                          {step.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.protocol.map((row) => (
                      <tr key={row.providerId}>
                        <th scope="row">{row.label}</th>
                        {result.protocol.map((column) => {
                          const value = result.coherenceMatrix?.[row.providerId]?.[column.providerId] ?? 0
                          const diagonal = row.providerId === column.providerId
                          return (
                            <td
                              key={column.providerId}
                              className={diagonal ? 'matrix__cell matrix__cell--self' : 'matrix__cell'}
                              style={
                                diagonal
                                  ? undefined
                                  : {
                                      background: `rgba(79, 227, 208, ${(0.06 + Math.min(1, value) * 0.62).toFixed(3)})`,
                                    }
                              }
                              title={`${row.label} ↔ ${column.label}: ${formatPercent(value, 1)}`}
                            >
                              {value.toFixed(2)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="panel__hint">
                Jaccard-Koeffizient über die Wortmengen je Ausgabenpaar; der Vergleich mit sich
                selbst ist 1. Der Konvergenz-Index ist das Mittel aller Werte außerhalb der Diagonale.
              </p>
            </div>
          ) : null}

          {result.consensus ? (
            <div className="result__block">
              <h3>Konsensprüfung</h3>
              <p className="panel__hint">
                Eine Aussage trägt das Ergebnis nur, wenn sie gegenüber mindestens{' '}
                {result.consensus.minAgreeingModels} Modellen eine Jaccard-Ähnlichkeit von{' '}
                {result.consensus.threshold.toFixed(2)} erreicht. Jede andere Aussage ist ein Isolat:
                sie beeinflusst das Ergebnis nicht und wird hier vollständig benannt.
              </p>

              <h4 className="result__subhead">
                Getragene Aussagen — {result.consensus.carried.length} von{' '}
                {result.consensus.supportedCount} in Rangfolge
              </h4>
              <ul className="consensus">
                {result.consensus.carried.length === 0 ? (
                  <li className="consensus__empty">
                    Keine Aussage erreicht diese Schwelle. Das Ergebnis bleibt bewusst leer.
                  </li>
                ) : (
                  result.consensus.carried.map((entry) => (
                    <li key={`${entry.providerId}-${entry.sentence.slice(0, 24)}`}>
                      <span className="consensus__head">
                        <span
                          className="swatch"
                          style={{ background: accentOf(entry.label) }}
                          aria-hidden="true"
                        />
                        {entry.label}
                        <span className="mono">Score {entry.score.toFixed(3)}</span>
                        <span className="mono">
                          Stützung {entry.supportCount}/{result.protocol.length}
                        </span>
                      </span>
                      <span className="consensus__text">{entry.sentence}</span>
                    </li>
                  ))
                )}
              </ul>

              <h4 className="result__subhead">
                Verworfene Isolate — {result.consensus.isolateCount}
              </h4>
              <ul className="consensus consensus--isolate">
                {result.consensus.isolates.length === 0 ? (
                  <li className="consensus__empty">
                    Keine Isolate: jede Aussage ist im Modellverbund verankert.
                  </li>
                ) : (
                  result.consensus.isolates.map((entry) => (
                    <li key={`${entry.providerId}-${entry.sentence.slice(0, 24)}`}>
                      <span className="consensus__head">
                        <span
                          className="swatch"
                          style={{ background: accentOf(entry.label) }}
                          aria-hidden="true"
                        />
                        {entry.label}
                        <span className="mono">
                          beste Ähnlichkeit {formatPercent(entry.bestOverlap, 0)}
                        </span>
                        <span className="mono">Stützung {entry.supportCount}</span>
                      </span>
                      <span className="consensus__text">{entry.sentence}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {result.coherence.length > 0 ? (
            <div className="result__block">
              <h3>Größte Abweichungen</h3>
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
