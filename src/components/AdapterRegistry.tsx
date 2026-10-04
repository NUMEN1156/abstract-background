import { useState } from 'react'
import { ApiError } from '../api/client'
import type { AdapterRecord } from '../types'

interface Props {
  adapters: AdapterRecord[]
  selectedIds: string[]
  onToggle: (id: string) => void
  onCreate: (input: Record<string, unknown>) => Promise<AdapterRecord>
  onToggleEnabled: (id: string, enabled: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
  adapterWrites: 'open' | 'key' | 'locked'
}

const PERSONAS = [
  { value: 'struktur', label: 'Strukturgebend — Definition, Struktur, Handlungsschritte' },
  { value: 'abwaegend', label: 'Abwägend — Voraussetzungen, Grenzen, Empfehlung' },
  { value: 'kompakt', label: 'Kompakt — kurze Blöcke zu Kern, Umsetzung, Risiko' },
  { value: 'explorativ', label: 'Explorativ — Denkansätze, Varianten, offene Fragen' },
]

const EMPTY_FORM = {
  label: '',
  vendor: '',
  model: '',
  endpoint: '',
  apiKey: '',
  persona: 'struktur',
  summary: '',
  weightDefault: 15,
}

export function AdapterRegistry({
  adapters,
  selectedIds,
  onToggle,
  onCreate,
  onToggleEnabled,
  onDelete,
  adapterWrites,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const locked = adapterWrites === 'locked'
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onCreate(form)
      setForm({ ...EMPTY_FORM })
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Adapter konnte nicht angelegt werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="registry-title">
      <header className="panel__head">
        <h2 id="registry-title">Adapter-Verzeichnis</h2>
        <div className="panel__headActions">
          <span className="mono panel__value">{adapters.length} registriert</span>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={locked}
            title={locked ? 'Diese Instanz ist schreibgeschützt.' : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Dialog schließen' : 'Adapter hinzufügen'}
          </button>
        </div>
      </header>

      {locked ? (
        <p className="field__note">
          Diese Instanz ist schreibgeschützt: Adapter sind gemeinsamer Zustand und werden von außen
          nicht verändert. Betreiber geben die Verwaltung am Server über <code>ABSTRACT_ADAPTER_WRITES</code>{' '}
          frei.
        </p>
      ) : null}

      {open ? (
        <form
          className="adapterForm"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <p className="adapterForm__intro">
            Neue Adapter werden serverseitig registriert. Zugangsdaten verbleiben im Tresor und werden
            niemals an den Browser ausgeliefert.
          </p>

          <div className="adapterForm__grid">
            <label className="field">
              <span className="label">Anzeigename *</span>
              <input
                required
                minLength={2}
                maxLength={48}
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
                placeholder="z. B. Phi"
              />
            </label>

            <label className="field">
              <span className="label">Anbieter *</span>
              <input
                required
                minLength={2}
                maxLength={48}
                value={form.vendor}
                onChange={(event) => setForm({ ...form, vendor: event.target.value })}
                placeholder="z. B. Microsoft"
              />
            </label>

            <label className="field">
              <span className="label">Modellkennung *</span>
              <input
                required
                minLength={2}
                maxLength={96}
                value={form.model}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
                placeholder="z. B. phi-4-14b"
              />
            </label>

            <label className="field">
              <span className="label">Endpunkt (optional)</span>
              <input
                value={form.endpoint}
                onChange={(event) => setForm({ ...form, endpoint: event.target.value })}
                placeholder="https://gateway.intern/v1/chat/completions"
              />
            </label>

            <label className="field">
              <span className="label">Zugangsschlüssel (optional)</span>
              <input
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                placeholder="wird nur verschlüsselt abgelegt"
              />
              <span className="field__note">
                Der Schlüssel verlässt den Server nicht: gespeichert werden nur Geheimtext,
                maskierte Vorschau und Fingerprint.
              </span>
            </label>

            <label className="field field--wide">
              <span className="label">Persona</span>
              <select
                value={form.persona}
                onChange={(event) => setForm({ ...form, persona: event.target.value })}
              >
                {PERSONAS.map((persona) => (
                  <option key={persona.value} value={persona.value}>
                    {persona.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--wide">
              <span className="label">Kurzbeschreibung (optional)</span>
              <input
                maxLength={160}
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
                placeholder="Wofür dieser Adapter im Verbund steht"
              />
            </label>

            <label className="field">
              <span className="label">Startgewicht ({form.weightDefault})</span>
              <input
                type="range"
                className="slider"
                min={0}
                max={100}
                value={form.weightDefault}
                onChange={(event) => setForm({ ...form, weightDefault: Number(event.target.value) })}
              />
            </label>
          </div>

          {error ? <p className="console__error">{error}</p> : null}

          <div className="panel__actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Registriert …' : 'Adapter registrieren'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setForm({ ...EMPTY_FORM })
                setError(null)
                setOpen(false)
              }}
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : null}

      <ul className="adapterList">
        {adapters.map((adapter) => (
          <li key={adapter.id} className={adapter.enabled ? '' : 'is-muted'}>
            <span className="adapterList__glyph" style={{ ['--accent' as string]: adapter.accent }}>
              {adapter.glyph}
            </span>
            <div className="adapterList__ident">
              <strong>
                {adapter.label}
                {adapter.builtIn ? <span className="tag">Basis</span> : <span className="tag tag--own">eigen</span>}
                {selectedIds.includes(adapter.id) ? <span className="tag tag--sel">im Verbund</span> : null}
              </strong>
              <span className="mono adapterList__model">
                {adapter.vendor} · {adapter.model}
              </span>
              <span className="adapterList__summary">{adapter.summary}</span>
              {adapter.secret ? (
                <span className="mono adapterList__secret">
                  Tresor: {adapter.secret.present ? adapter.secret.hint : 'leer'}
                  {adapter.secret.fingerprint
                    ? ` · FP ${adapter.secret.fingerprint.slice(0, 8)}`
                    : ''}
                </span>
              ) : null}
            </div>
            <div className="adapterList__actions">
              <button type="button" className="btn btn--ghost btn--small" onClick={() => onToggle(adapter.id)}>
                {selectedIds.includes(adapter.id) ? 'Abwählen' : 'Auswählen'}
              </button>
              <label className="switch switch--compact">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={adapter.enabled}
                  onChange={(event) =>
                    void onToggleEnabled(adapter.id, event.target.checked).catch((cause: unknown) => {
                      setListError(
                        cause instanceof ApiError ? cause.message : 'Umschalten fehlgeschlagen.',
                      )
                    })
                  }
                />
                <span>aktiv</span>
              </label>
              {!adapter.builtIn ? (
                <button
                  type="button"
                  className="btn btn--danger btn--small"
                  disabled={locked}
                  onClick={() =>
                    void onDelete(adapter.id).catch((cause: unknown) => {
                      setListError(
                        cause instanceof ApiError
                          ? cause.message
                          : 'Adapter konnte nicht entfernt werden.',
                      )
                    })
                  }
                >
                  Entfernen
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {listError ? <p className="console__error">{listError}</p> : null}
    </section>
  )
}
