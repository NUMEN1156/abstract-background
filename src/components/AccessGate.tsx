import { useState } from 'react'
import { api, ApiError, setApiKey } from '../api/client'

interface Props {
  /** Wird nach erfolgreicher Prüfung des Schlüssels aufgerufen. */
  onUnlocked: () => void
}

/**
 * Zugangshinweis für Instanzen mit gesetztem Zugangsschlüssel.
 *
 * Der Hinweis erscheint ausschließlich, wenn der Server schreibende Aufrufe schützt. Die
 * Oberfläche bleibt auch gesperrt vollständig lesbar; gesperrt sind Adapterverwaltung, Start
 * eines Auftrags und der Kollaps.
 */
export default function AccessGate({ onUnlocked }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const key = value.trim()
    if (key.length === 0) {
      setError('Bitte den Zugangsschlüssel eingeben.')
      return
    }
    setBusy(true)
    setError(null)
    setApiKey(key)
    try {
      // Prüfung an einem geschützten, aber zustandsfreien Aufruf: der Kollaps ohne Sitzung
      // wird abgewiesen, ein fehlender Schlüssel ebenfalls — die Antwort unterscheidet beides.
      await api.collapse('pruefung', {})
      setError('Der Schlüssel wurde angenommen, aber die Prüfung lieferte ein unerwartetes Ergebnis.')
    } catch (cause) {
      if (cause instanceof ApiError && cause.field === 'apiKey') {
        setError('Der Zugangsschlüssel ist nicht gültig.')
      } else {
        localStorage.setItem('abstract-background.apiKey', key)
        onUnlocked()
        return
      }
    } finally {
      setBusy(false)
    }
    setApiKey('')
  }

  return (
    <section className="accessGate" aria-label="Zugangsschutz">
      <div className="accessGate__text">
        <strong>Geschützte Instanz</strong>
        <p>
          Diese Instanz verlangt für das Anlegen von Adaptern, den Start einer Superposition und den
          Kollaps einen Zugangsschlüssel. Ansehen und Lesen bleibt offen.
        </p>
      </div>
      <form className="accessGate__form" onSubmit={submit}>
        <label className="field">
          <span className="label">Zugangsschlüssel</span>
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Schlüssel der Instanz"
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Prüfe …' : 'Freischalten'}
        </button>
      </form>
      {error ? <p className="console__error">{error}</p> : null}
    </section>
  )
}