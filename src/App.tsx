import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, setApiKey } from './api/client'
import AccessGate from './components/AccessGate'
import { AdapterRegistry } from './components/AdapterRegistry'
import { ArchitecturePanel } from './components/ArchitecturePanel'
import { CollapseStage } from './components/CollapseStage'
import { Header } from './components/Header'
import { PromptConsole } from './components/PromptConsole'
import { ProviderCard } from './components/ProviderCard'
import { ResultPanel } from './components/ResultPanel'
import { SuperpositionField } from './components/SuperpositionField'
import { TelemetryRail } from './components/TelemetryRail'
import { WeightPanel } from './components/WeightPanel'
import { useSuperposition } from './state/useSuperposition'
import type { ArchitectureReport, StartSettings } from './types'

export default function App() {
  const store = useSuperposition()
  const [architecture, setArchitecture] = useState<ArchitectureReport | null>(null)
  const [accessRequired, setAccessRequired] = useState(false)
  const [unlocked, setUnlocked] = useState(false)

  useEffect(() => {
    api
      .architecture()
      .then(setArchitecture)
      .catch(() => setArchitecture(null))
  }, [])

  useEffect(() => {
    // Ein hinterlegter Schlüssel wird vor der Statusabfrage gesetzt, damit die Prüfung
    // bereits mit Nachweis erfolgt.
    const stored = localStorage.getItem('abstract-background.apiKey') ?? ''
    if (stored.length > 0) {
      setApiKey(stored)
      setUnlocked(true)
    }
    api
      .access()
      .then((status) => {
        setAccessRequired(status.required)
        if (!status.required) setUnlocked(true)
      })
      .catch(() => setAccessRequired(false))
  }, [])

  const accentOf = useCallback(
    (label: string) =>
      store.providers.find((provider) => provider.label === label)?.accent ??
      store.adapters.find((adapter) => adapter.label === label)?.accent ??
      '#4fe3d0',
    [store.adapters, store.providers],
  )

  const fieldEntries = useMemo(
    () =>
      store.distribution.map((entry) => ({
        id: entry.id,
        label: entry.label,
        accent: entry.accent,
        share: entry.share,
        active: (store.channels[entry.id]?.state ?? 'queued') === 'streaming',
      })),
    [store.channels, store.distribution],
  )

  const collapsed = store.phase === 'kollabiert' || store.phase === 'kollabierend'
  const canCollapse = store.completedChannels > 0 && store.phase !== 'kollabierend'

  return (
    <div className="app">
      <Header
        phase={store.phase}
        transport={store.transport}
        telemetry={store.telemetry}
        completedChannels={store.completedChannels}
        totalChannels={store.channelList.length}
        hasSession={store.session !== null}
      />

      <div className="shell">
        <TelemetryRail telemetry={store.telemetry} history={store.history} log={store.log} />

        <main className="stage">
          <SuperpositionField entries={fieldEntries} collapsed={collapsed} />

          <section className="stage__channels" aria-label="Modellkanäle">
            {store.channelList.length === 0 ? (
              <div className="empty">
                <h2>Keine Superposition aktiv</h2>
                <p>
                  Wählen Sie rechts die Adapter, formulieren Sie die Anfrage und starten Sie den Auftrag.
                  Die Kanäle erscheinen anschließend hier und streamen parallel.
                </p>
              </div>
            ) : (
              <div className="channels">
                {store.channelList.map((entry) => (
                  <ProviderCard
                    key={entry.provider.id}
                    provider={entry.provider}
                    channel={entry.channel}
                    weight={entry.weight}
                    share={store.weightTotal > 0 ? entry.weight / store.weightTotal : 0}
                    onWeight={(value) => store.setWeight(entry.provider.id, value)}
                  />
                ))}
              </div>
            )}
          </section>

          <CollapseStage stage={store.collapseStage} entries={store.distribution} />

          {store.result ? <ResultPanel result={store.result} accentOf={accentOf} /> : null}

          <AdapterRegistry
            adapters={store.adapters}
            selectedIds={store.selectedIds}
            onToggle={store.toggleProvider}
            onCreate={store.createAdapter}
            onToggleEnabled={store.setAdapterEnabled}
            onDelete={store.deleteAdapter}
          />

          <ArchitecturePanel architecture={architecture} security={store.security} />
        </main>

        <aside className="rail rail--right" aria-label="Steuerung">
          <PromptConsole
            prompt={store.prompt}
            onPrompt={store.setPrompt}
            settings={store.settings}
            onSettings={(patch: Partial<StartSettings>) =>
              store.setSettings((prev) => ({ ...prev, ...patch }))
            }
            adapters={store.adapters}
            selectedIds={store.selectedIds}
            onToggle={store.toggleProvider}
            phase={store.phase}
            onStart={() => void store.start()}
            onReset={store.reset}
            error={store.error}
          />

          <WeightPanel
            distribution={store.distribution}
            total={store.weightTotal}
            phase={store.phase}
            canCollapse={canCollapse}
            onNormalize={store.normalizeWeights}
            onCollapse={() => void store.collapseNow()}
          />
        </aside>
      </div>

      {accessRequired && !unlocked ? (
        <AccessGate
          onUnlocked={() => {
            setUnlocked(true)
            void store.refreshAdapters()
          }}
        />
      ) : null}

      <footer className="footer">
        <span className="mono">
          Abstract Background · Prototyp der AI-Superposition-Middleware · Anbieterantworten werden
          serverseitig simuliert
        </span>
        <span className="mono">
          Schlüssel ausschließlich serverseitig · AES-256-GCM · kein Modellzugriff aus dem Browser
        </span>
      </footer>
    </div>
  )
}
