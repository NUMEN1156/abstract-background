import { useEffect, useRef } from 'react'
import type { ChannelState, ProviderSummary } from '../types'
import { STATE_LABEL, formatMs, formatNumber, formatPercent } from '../utils/format'

interface Props {
  provider: ProviderSummary
  channel: ChannelState
  weight: number
  share: number
  onWeight: (value: number) => void
}

export function ProviderCard({ provider, channel, weight, share, onWeight }: Props) {
  const textRef = useRef<HTMLDivElement | null>(null)
  const streaming = channel.state === 'streaming' || channel.state === 'connecting'

  useEffect(() => {
    if (!streaming) return
    const node = textRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [channel.text, streaming])

  return (
    <article
      className={`channel channel--${channel.state}`}
      style={{ ['--accent' as string]: provider.accent }}
    >
      <header className="channel__head">
        <span className="channel__glyph" aria-hidden="true">
          {provider.glyph}
        </span>
        <div className="channel__ident">
          <h3>
            {provider.label}
            <span className="channel__vendor">{provider.vendor}</span>
          </h3>
          <p className="channel__model mono">{provider.model}</p>
        </div>
        <span className={`chip chip--${channel.state}`}>
          <i className="chip__dot" aria-hidden="true" />
          {STATE_LABEL[channel.state] ?? channel.state}
        </span>
      </header>

      <p className="channel__persona">{provider.summary}</p>

      <div className="channel__body" ref={textRef}>
        {channel.text.length > 0 ? (
          <p className="channel__text">
            {channel.text}
            {streaming ? <span className="caret" aria-hidden="true" /> : null}
          </p>
        ) : channel.state === 'error' && channel.error ? (
          <p className="channel__error">{channel.error}</p>
        ) : (
          <p className="channel__idle">Kanal wartet auf Auftrag.</p>
        )}
      </div>

      <dl className="channel__metrics mono">
        <div>
          <dt>Token</dt>
          <dd>{formatNumber(channel.tokens)}</dd>
        </div>
        <div>
          <dt>Laufzeit</dt>
          <dd>{formatMs(channel.latencyMs)}</dd>
        </div>
        <div>
          <dt>Gewicht</dt>
          <dd>{formatPercent(share, 0)}</dd>
        </div>
        <div>
          <dt>Güte</dt>
          <dd>{formatPercent(provider.confidence, 0)}</dd>
        </div>
      </dl>

      <div className="channel__weight">
        <label className="label" htmlFor={`weight-${provider.id}`}>
          Gewichtung
        </label>
        <input
          id={`weight-${provider.id}`}
          className="slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={weight}
          onChange={(event) => onWeight(Number(event.target.value))}
          aria-label={`Gewichtung für ${provider.label}`}
        />
        <output className="mono channel__weightValue">{weight}</output>
      </div>

      {provider.capabilities.length > 0 ? (
        <ul className="channel__caps">
          {provider.capabilities.slice(0, 3).map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}