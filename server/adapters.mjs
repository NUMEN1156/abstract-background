import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADAPTER_ACCENTS, BASE_PROVIDERS, PERSONA_PRESETS } from './providers.mjs'
import { describeSecret, dropSecret, storeSecret } from './crypto.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(path.resolve(here, '..'), '.data')
const storeFile = path.join(dataDir, 'adapters.json')

/** Registry der Modelladapter. Basisadapter stammen aus dem Code, eigene aus dem Datenspeicher. */
const custom = new Map()
/** Schaltzustand der Basisadapter; im Datenspeicher überdauernd. */
const builtInState = new Map()

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function persist() {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(
      storeFile,
      JSON.stringify(
        { version: 2, adapters: [...custom.values()], builtInState: Object.fromEntries(builtInState) },
        null,
        2,
      ),
      'utf8',
    )
  } catch {
    /* Persistenz ist im Container optional; die Registry bleibt dann flüchtig. */
  }
}

function restore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
    for (const adapter of parsed?.adapters ?? []) {
      if (adapter?.id) custom.set(adapter.id, adapter)
    }
    for (const [id, state] of Object.entries(parsed?.builtInState ?? {})) {
      builtInState.set(id, Boolean(state?.enabled))
    }
  } catch {
    /* Kein gespeicherter Stand vorhanden. */
  }
}

restore()

/** Adapter ohne serverseitige Geheimnisse, aber mit maskiertem Tresorstatus. */
function publicView(adapter) {
  const { secretHint: _secretHint, ...rest } = adapter
  const secret = adapter.builtIn ? null : describeSecret(adapter.id)
  return {
    ...rest,
    enabled: adapter.builtIn
      ? (builtInState.get(adapter.id) ?? true)
      : adapter.enabled,
    secret: secret
      ? { present: secret.present, hint: secret.hint, fingerprint: secret.fingerprint }
      : undefined,
  }
}

export function listAdapters() {
  return [
    ...BASE_PROVIDERS.map((provider) => publicView({ ...provider, builtIn: true })),
    ...[...custom.values()].map((adapter) => publicView({ ...adapter, builtIn: false })),
  ]
}

export function getAdapter(id) {
  return listAdapters().find((adapter) => adapter.id === id) ?? null
}

export class AdapterError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'AdapterError'
    this.field = field
  }
}

/**
 * Wählt die beteiligten Adapter.
 * Ohne Auswahl nehmen alle aktiven Adapter teil. Eine Auswahl, die keinen aktiven Adapter trifft,
 * wird abgewiesen, damit nicht stillschweigend mehr Modelle befragt werden als angefordert.
 */
export function activeAdapters(ids) {
  const all = listAdapters().filter((adapter) => adapter.enabled)
  if (!ids || ids.length === 0) return all

  const wanted = new Set(ids)
  const selected = all.filter((adapter) => wanted.has(adapter.id))
  if (selected.length === 0) {
    throw new AdapterError(
      'Keiner der gewählten Adapter ist aktiv. Aktivieren Sie die Adapter oder wählen Sie andere aus.',
      'providerIds',
    )
  }
  return selected
}

/** Prüft eine Endpunktangabe und verbietet eingebettete Zugangsdaten. */
function validateEndpoint(raw) {
  const endpoint = String(raw ?? '').trim()
  if (endpoint.length === 0) return ''
  let url
  try {
    url = new URL(endpoint)
  } catch {
    throw new AdapterError('Der Endpunkt muss eine vollständige http(s)-URL sein.', 'endpoint')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AdapterError('Der Endpunkt muss mit http:// oder https:// beginnen.', 'endpoint')
  }
  if (url.username || url.password) {
    throw new AdapterError(
      'Der Endpunkt darf keine Zugangsdaten in der URL enthalten. Hinterlegen Sie den Schlüssel im dafür vorgesehenen Feld.',
      'endpoint',
    )
  }
  return url.toString()
}

export function addAdapter(input = {}) {
  const label = String(input.label ?? '').trim()
  if (label.length < 2 || label.length > 48) {
    throw new AdapterError('Der Anzeigename muss zwischen 2 und 48 Zeichen lang sein.', 'label')
  }

  const vendor = String(input.vendor ?? '').trim()
  if (vendor.length < 2 || vendor.length > 48) {
    throw new AdapterError('Der Anbieter muss zwischen 2 und 48 Zeichen lang sein.', 'vendor')
  }

  const model = String(input.model ?? '').trim()
  if (model.length < 2 || model.length > 96) {
    throw new AdapterError('Die Modellkennung muss zwischen 2 und 96 Zeichen lang sein.', 'model')
  }

  const endpoint = validateEndpoint(input.endpoint)

  const apiKey = String(input.apiKey ?? '')
  if (apiKey.length > 256) {
    throw new AdapterError('Der Zugangsschlüssel ist zu lang (maximal 256 Zeichen).', 'apiKey')
  }

  const personaKey = PERSONA_PRESETS[input.persona] ? input.persona : 'struktur'
  const preset = PERSONA_PRESETS[personaKey]

  const base = slugify(label)
  if (!base) throw new AdapterError('Aus dem Anzeigenamen lässt sich keine Kennung bilden.', 'label')

  let id = base
  let suffix = 2
  const taken = new Set(listAdapters().map((adapter) => adapter.id))
  while (taken.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  if (custom.size >= 24) {
    throw new AdapterError('Es sind höchstens 24 eigene Adapter möglich.', 'label')
  }

  const adapter = {
    id,
    label,
    vendor,
    model,
    endpoint: endpoint || `https://gateway.intern/${id}/v1/chat/completions`,
    accent: ADAPTER_ACCENTS[custom.size % ADAPTER_ACCENTS.length],
    glyph: label.slice(0, 2).toUpperCase(),
    persona: preset.persona,
    style: preset.style,
    summary: String(input.summary ?? '').trim().slice(0, 160) || preset.summary,
    capabilities: Array.isArray(input.capabilities)
      ? input.capabilities.map((c) => String(c).slice(0, 24)).slice(0, 5)
      : ['Adapter', 'Eigene Anbindung'],
    confidence: Math.min(0.95, Math.max(0.5, Number(input.confidence ?? preset.confidence))),
    latencyBase: Math.round(250 + Math.random() * 350),
    cadence: preset.cadence,
    verbosity: preset.verbosity,
    enabled: true,
    builtIn: false,
    weightDefault: Number(input.weightDefault ?? 15),
  }

  // Zugangsschlüssel werden ausschließlich verschlüsselt abgelegt und nie ausgeliefert.
  storeSecret(id, apiKey.length > 0 ? apiKey : `demo-${id}-${Math.random().toString(36).slice(2, 12)}`)

  custom.set(id, adapter)
  persist()
  return publicView({ ...adapter, builtIn: false })
}

export function updateAdapter(id, patch = {}) {
  if (custom.has(id)) {
    const current = custom.get(id)
    const next = { ...current }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (patch.summary !== undefined) next.summary = String(patch.summary).slice(0, 160)
    if (patch.weightDefault !== undefined) {
      next.weightDefault = Math.min(100, Math.max(0, Number(patch.weightDefault) || 0))
    }
    custom.set(id, next)
    persist()
    return publicView({ ...next, builtIn: false })
  }

  const isBuiltIn = BASE_PROVIDERS.some((provider) => provider.id === id)
  if (isBuiltIn) {
    if (typeof patch.enabled !== 'boolean') {
      throw new AdapterError('Basisadapter lassen sich ausschließlich ein- oder ausschalten.', 'enabled')
    }
    builtInState.set(id, patch.enabled)
    persist()
    return getAdapter(id)
  }

  throw new AdapterError('Adapter nicht gefunden.', 'id')
}

export function removeAdapter(id) {
  if (!custom.has(id)) {
    throw new AdapterError('Basisadapter sind fest verdrahtet und können nicht entfernt werden.', 'id')
  }
  custom.delete(id)
  dropSecret(id)
  persist()
  return { id, removed: true }
}
