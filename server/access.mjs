import crypto from 'node:crypto'

/**
 * Zugangskontrolle für die verändernden Schnittstellen.
 *
 * Ohne gesetzten Schlüssel (`ABSTRACT_API_KEY`) bleibt das Anlegen von Sitzungen offen: Die Demo
 * bleibt bedienbar. Ist ein Schlüssel gesetzt, verlangen alle schreibenden Aufrufe einen gültigen
 * Nachweis — entweder im Kopf `X-Api-Key` oder als `Authorization: Bearer …`.
 *
 * Die Adapter-Registry ist gemeinsamer Zustand: Wer sie verändert, verändert das System für alle.
 * Deshalb gilt für sie eine eigene Regel (`ABSTRACT_ADAPTER_WRITES`):
 *   - `open`   — Verwaltung ohne Nachweis erlaubt (Standard in der Entwicklung)
 *   - `key`    — Verwaltung nur mit gültigem Zugangsschlüssel (Standard, wenn ein Schlüssel gesetzt ist)
 *   - `locked` — Verwaltung gesperrt (Standard im Produktionsbetrieb ohne Schlüssel)
 * Ohne Vorgabe entscheidet der Betriebsmodus: Produktion ohne Schlüssel sperrt die Verwaltung.
 *
 * Lesende Endpunkte, der Live-Kanal und die Oberfläche bleiben in beiden Fällen offen, damit die
 * Demo sichtbar bleibt und der Ereignisstrom nicht an einer Anmeldung hängt.
 */

const EXPECTED_KEY = String(process.env.ABSTRACT_API_KEY ?? '').trim()

export const accessRequired = EXPECTED_KEY.length > 0

const ADAPTER_WRITES_ENV = String(process.env.ABSTRACT_ADAPTER_WRITES ?? '').trim().toLowerCase()

function resolveAdapterWriteMode() {
  if (ADAPTER_WRITES_ENV === 'open' || ADAPTER_WRITES_ENV === 'key' || ADAPTER_WRITES_ENV === 'locked') {
    return ADAPTER_WRITES_ENV
  }
  if (accessRequired) return 'key'
  return process.env.NODE_ENV === 'production' ? 'locked' : 'open'
}

export const adapterWriteMode = resolveAdapterWriteMode()

/** Vergleich in konstanter Zeit, damit der Schlüssel nicht über Laufzeitunterschiede auslesbar ist. */
function matchesPresentedKey(presented) {
  if (presented.length === 0) return false
  const expected = Buffer.from(EXPECTED_KEY, 'utf8')
  const actual = Buffer.from(presented, 'utf8')
  if (expected.length !== actual.length) {
    // Längenunterschiede werden nicht verraten: trotzdem vollständig vergleichen.
    crypto.timingSafeEqual(expected, expected)
    return false
  }
  return crypto.timingSafeEqual(expected, actual)
}

function presentedKey(request) {
  const direct = request.headers['x-api-key']
  if (typeof direct === 'string' && direct.trim().length > 0) return direct.trim()
  const authorization = request.headers.authorization
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }
  return ''
}

/** Die geschützten Aufrufe: alles, was Adapter, Aufträge oder Zustand verändert. */
const GUARDED = [
  { method: 'POST', path: '/api/superposition' },
  { method: 'POST', path: '/api/collapse' },
  { method: 'POST', path: '/api/adapters' },
  { method: 'PATCH', path: '/api/adapters' },
  { method: 'DELETE', path: '/api/adapters' },
]

function isGuarded(request) {
  const url = String(request.url ?? '').split('?')[0]
  return GUARDED.some(
    (rule) =>
      request.method === rule.method &&
      (url === rule.path || url.startsWith(`${rule.path}/`)),
  )
}

/** Sind Adapterverwaltung und Registry betroffen? */
function isAdapterWrite(request) {
  const url = String(request.url ?? '').split('?')[0]
  if (!url.startsWith('/api/adapters')) return false
  return request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE'
}

const ADAPTER_WRITE_DETAIL = {
  open: 'Die Adapter-Registry dieses Systems ist offen: Adapter lassen sich ohne Zugangsschlüssel verwalten.',
  key: 'Die Adapter-Registry ist gemeinsamer Zustand und nur mit gültigem Zugangsschlüssel veränderbar.',
  locked:
    'Die Adapter-Registry dieses Systems ist schreibgeschützt: Sie ist gemeinsamer Zustand und wird von außen nicht verändert. Betreiber setzen am Server ABSTRACT_ADAPTER_WRITES=key (mit ABSTRACT_API_KEY) oder =open, um die Verwaltung freizugeben.',
}

export function accessStatus() {
  return {
    required: accessRequired,
    adapterWrites: adapterWriteMode,
    scheme: accessRequired ? 'X-Api-Key oder Authorization: Bearer' : 'offen',
    protectedPaths: accessRequired ? GUARDED.map((rule) => `${rule.method} ${rule.path}`) : [],
    adapterWriteDetail: ADAPTER_WRITE_DETAIL[adapterWriteMode],
    detail: accessRequired
      ? `Schreibende Aufrufe benötigen einen gültigen Zugangsschlüssel. ${ADAPTER_WRITE_DETAIL[adapterWriteMode]}`
      : `Kein Zugangsschlüssel gesetzt. ${ADAPTER_WRITE_DETAIL[adapterWriteMode]}`,
  }
}

export function registerAccessGuard(app) {
  app.addHook('onRequest', async (request, reply) => {
    if (isAdapterWrite(request) && adapterWriteMode === 'locked') {
      reply.code(403).send({
        ok: false,
        error: ADAPTER_WRITE_DETAIL.locked,
        field: 'adapterWrites',
        adapterWrites: 'locked',
      })
      return
    }
    if (!accessRequired) return
    if (!isGuarded(request)) return
    if (matchesPresentedKey(presentedKey(request))) return
    reply.code(401).send({
      ok: false,
      error: 'Zugangsschlüssel fehlt oder ist ungültig.',
      field: 'apiKey',
    })
  })
}
