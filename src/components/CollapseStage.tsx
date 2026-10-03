import { formatPercent } from '../utils/format'

interface Entry {
  id: string
  label: string
  accent: string
  share: number
}

interface Props {
  stage: number
  entries: Entry[]
}

const STAGES = [
  { index: 1, title: 'Bündeln', detail: 'Kanäle werden auf gleiche Bezugszeit gebracht und ausgerichtet.' },
  { index: 2, title: 'Verschmelzen', detail: 'Gewichte greifen: Träger bestimmten die Kernaussage, übrige Beiträge lagern sich an.' },
  { index: 3, title: 'Auflösen', detail: 'Randnotizen werden ausgewiesen, Herkunft jeder Passage bleibt erhalten.' },
]

export function CollapseStage({ stage, entries }: Props) {
  if (stage === 0) return null

  const radius = 108
  const center = 150
  const ranked = [...entries].sort((a, b) => b.share - a.share)
  const dominant = ranked[0]
  const gather = stage >= 1 ? 1 : 0

  return (
    <section className={`collapse collapse--stage${stage}`} aria-live="polite">
      <header className="panel__head">
        <h2>Kollaps-Bühne</h2>
        <span className="mono panel__value">
          {stage < 4 ? `Phase ${Math.min(stage, 3)} / 3` : 'abgeschlossen'}
        </span>
      </header>

      <div className="collapse__grid">
        <svg viewBox="0 0 300 300" className="collapse__svg" role="img" aria-label="Konvergierende Modellkanäle">
          <circle cx={center} cy={center} r={radius} className="collapse__orbit" />
          <circle cx={center} cy={center} r={radius * 0.55} className="collapse__orbit collapse__orbit--inner" />
          <circle
            cx={center}
            cy={center}
            r={stage >= 2 ? 26 : 14}
            className="collapse__core"
            style={{ transition: 'r 600ms ease' }}
          />
          {ranked.map((entry, index) => {
            const angle = (index / Math.max(1, ranked.length)) * Math.PI * 2 - Math.PI / 2
            const startX = center + Math.cos(angle) * radius
            const startY = center + Math.sin(angle) * radius
            const pull = stage >= 2 ? 0.94 : stage >= 1 ? 0.55 : 0
            const endX = startX + (center - startX) * pull * gather
            const endY = startY + (center - startY) * pull * gather
            const opacity = stage >= 3 && entry.id !== dominant?.id ? 0.25 : 1
            return (
              <g key={entry.id} style={{ opacity, transition: 'opacity 400ms ease' }}>
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  stroke={entry.accent}
                  strokeWidth={1.2 + entry.share * 5}
                  opacity={0.65}
                  style={{ transition: 'all 700ms cubic-bezier(0.22, 1, 0.36, 1)' }}
                />
                <circle
                  cx={endX}
                  cy={endY}
                  r={stage >= 2 ? 5 : 9}
                  fill={entry.accent}
                  style={{ transition: 'all 700ms cubic-bezier(0.22, 1, 0.36, 1)' }}
                />
              </g>
            )
          })}
        </svg>

        <ol className="collapse__stages">
          {STAGES.map((item) => (
            <li key={item.index} className={stage >= item.index ? 'is-active' : ''}>
              <span className="mono collapse__index">
                {String(item.index).padStart(2, '0')}
              </span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {dominant ? (
        <p className="collapse__footnote mono">
          Voraussichtlicher Träger: {dominant.label} · Gewichtsanteil {formatPercent(dominant.share, 1)}
        </p>
      ) : null}
    </section>
  )
}