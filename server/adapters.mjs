import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADAPTER_ACCENTS, BASE_PROVIDERS, PERSONA_PRESETS } from './providers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(path.resolve(here, '..'), '.data')
const storeFile = path.join(dataDir, 'adapters.json')

/** Registry der Modelladapter. Basisadapter stammen aus dem Code, eigene aus dem Datenspeicher. */
const custom = new Map()

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
      JSON.stringify({ version: 1, adapters: [...custom.values()] }, null, 2),
      'utf8',
    )
  } catch {
    /* Persistenz ist im Container optional; die Registry bleibt dann flüchtig. */
  }
}

function restore() {
  try {
    const raw = fs.readFileSync(storeFile, 'utf8')
    const parsed = JSON.parse(raw)
    for (const adapter of parsed?.adapters ?? []) {
      if (adapter?.id) custom.set(adapter.id, adapter)
    }
  } catch {
    /* Kein gespeicherter Stand vorhanden. */
  }
}

restore()

export function listAdapters() {
  return [
    ...BASE_PROVIDERS.map((provider) => ({ ...provider, builtIn: true })),
    ...[...custom.values()].map((adapter) => ({ ...adapter, builtIn: false })),
  ]
}

export function getAdapter(id) {
  return listAdapters().find((adapter) => adapter.id === id) ?? null
}

export function activeAdapters(ids) {
  const all = listAdapters().filter((adapter) => adapter.enabled)
  if (!ids || ids.length === 0) return all
  const wanted = new Set(ids)
  const selected = all.filter((adapter) => wanted.has(adapter.id))
  return selected.length > 0 ? selected : all
}

export class AdapterError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'AdapterError'
    this.field = field
  }
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

  const endpoint = String(input.endpoint ?? '').trim()
  if (endpoint.length > 0 && !/^https?:\/\/[^\s]+$/i.test(endpoint)) {
    throw new AdapterError('Der Endpunkt muss eine vollständige http(s)-URL sein.', 'endpoint')
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
    secretHint: String(input.secretHint ?? '').slice(0, 64) || 'serverseitig hinterlegt',
    createdAt: new Date().toISOString(),
  }

  custom.set(id, adapter)
  persist()
  return adapter
}

export function updateAdapter(id, patch = {}) {
  const current = custom.get(id)
  if (!current) {
    throw new AdapterError('Nur eigene Adapter lassen sich ändern.', 'id')
  }
  const next = { ...current }
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (patch.summary !== undefined) next.summary = String(patch.summary).slice(0, 160)
  if (patch.weightDefault !== undefined) {
    next.weightDefault = Math.min(100, Math.max(0, Number(patch.weightDefault) || 0))
  }
  custom.set(id, next)
  persist()
  return next
}

export function removeAdapter(id) {
  if (!custom.has(id)) {
    throw new AdapterError('Basisadapter sind fest verdrahtet und können nicht entfernt werden.', 'id')
  }
  custom.delete(id)
  persist()
  return { id, removed: true }
}