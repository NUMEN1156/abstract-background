import type { AdapterRecord, StartSettings } from '../types'
import type { Phase } from '../state/useSuperposition'

interface Props {
  prompt: string
  onPrompt: (value: string) => void
  settings: StartSettings
  onSettings: (patch: Partial<StartSettings>) => void
  adapters: AdapterRecord[]
  selectedIds: string[]
  onToggle: (id: string) => void
  phase: Phase
  onStart: () => void
  onReset: () => void
  error: string | null
}

const LIMIT = 1200

const EXAMPLES = [
  'Wie setzt ein Unternehmen mehrere KI-Modelle gleichzeitig ein, ohne die Nachvollziehbarkeit zu verlieren?',
  'Welche Risiken entstehen, wenn ein Modell allein über Kundenantworten entscheidet?',
  'Was gehört in eine Betriebsrichtlinie für generative Modelle im Kundenservice?',
]

export function PromptConsole({
  prompt,
  onPrompt,
  settings,
  onSettings,
  adapters,
  selectedIds,
  onToggle,
  phase,
  onStart,
  onReset,
  error,
}: Props) {
  const busy = phase === 'startet' || phase === 'laeuft' || phase === 'kollabierend'
  const tooShort = prompt.trim().length < 8

  return (
    <section className="panel panel--console" aria-labelledby="console-title">
      <header className="panel__head">
        <h2 id="console-title">Auftrag</h2>
        <span className="mono panel__value">
          {prompt.length}/{LIMIT}
        </span>
      </header>

      <label className="label" htmlFor="prompt">
        Anfrage an die Superposition
      </label>
      <textarea
        id="prompt"
        className="console__input"
        value={prompt}
        maxLength={LIMIT}
        rows={6}
        placeholder="Formulieren Sie die Frage, die alle Modelle gleichzeitig beantworten sollen …"
        onChange={(event) => onPrompt(event.target.value)}
      />

      <div className="console__examples">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="token"
            onClick={() => onPrompt(example)}
            title={example}
          >
            {example.length > 42 ? `${example.slice(0, 42)}…` : example}
          </button>
        ))}
      </div>

      <div className="console__adapters">
        <span className="label">Aktive Adapter · {selectedIds.length}</span>
        <ul className="adapterChips">
          {adapters.map((adapter) => {
            const selected = selectedIds.includes(adapter.id)
            return (
              <li key={adapter.id}>
                <button
                  type="button"
                  className={`adapterChips__item${selected ? ' is-selected' : ''}${
                    adapter.enabled ? '' : ' is-disabled'
                  }`}
                  style={{ ['--accent' as string]: adapter.accent }}
                  onClick={() => onToggle(adapter.id)}
                  title={adapter.enabled ? adapter.summary : 'Adapter ist deaktiviert'}
                >
                  <span className="adapterChips__glyph">{adapter.glyph}</span>
                  {adapter.label}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="console__settings">
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.injectFailure}
            onChange={(event) => onSettings({ injectFailure: event.target.checked })}
          />
          <span>Störung simulieren</span>
        </label>

        <label className="field">
          <span className="label">Kollapsregel</span>
          <select
            value={settings.collapseRule}
            onChange={(event) => onSettings({ collapseRule: event.target.value })}
          >
            <option value="gewichtete-synthese">Gewichtete Synthese</option>
            <option value="bester-traeger">Bester Träger</option>
            <option value="konsens-erzwingen">Konsens erzwingen</option>
          </select>
        </label>

        <label className="field">
          <span className="label">Streuung {settings.temperature.toFixed(2)}</span>
          <input
            type="range"
            className="slider"
            min={0}
            max={1}
            step={0.05}
            value={settings.temperature}
            onChange={(event) => onSettings({ temperature: Number(event.target.value) })}
          />
        </label>
      </div>

      {error ? <p className="console__error">{error}</p> : null}

      <div className="console__actions">
        <button type="button" className="btn btn--primary" onClick={onStart} disabled={busy || tooShort}>
          {phase === 'startet' ? 'Startet …' : 'Superposition starten'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onReset} disabled={busy}>
          Zurücksetzen
        </button>
      </div>
    </section>
  )
}