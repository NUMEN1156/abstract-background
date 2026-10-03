import crypto from 'node:crypto'

/**
 * Zugangskontrolle für die verändernden Schnittstellen.
 *
 * Ohne gesetzten Schlüssel (`ABSTRACT_API_KEY`) bleibt der Zugang offen: Der Prototyp ist dann
 * wie bisher frei bedienbar. Ist ein Schlüssel gesetzt, verlangen alle schreibenden Aufrufe einen
 * gültigen Nachweis — entweder im Kopf `X-Api-Key` oder als `Authorization: Bearer …`.
 *
 * Lesende Endpunkte, der Live-Kanal und die Oberfläche bleiben in beiden Fällen offen, damit die
 * Demo sichtbar bleibt und der Ereignisstrom nicht an einer Anmeldung hängt.
 */

const EXPECTED_KEY = String(process.env.ABSTRACT_API_KEY ?? '').trim()

export const accessRequired = EXPECTED_KEY.length > 0

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

export function accessStatus() {
  return {
    required: accessRequired,
    scheme: accessRequired ? 'X-Api-Key oder Authorization: Bearer' : 'offen',
    protectedPaths: accessRequired ? GUARDED.map((rule) => `${rule.method} ${rule.path}`) : [],
    detail: accessRequired
      ? 'Schreibende Aufrufe benötigen einen gültigen Zugangsschlüssel. Lesende Endpunkte und der Live-Kanal bleiben offen.'
      : 'Kein Zugangsschlüssel gesetzt: Die Schnittstellen sind offen. Setzen Sie ABSTRACT_API_KEY, um die schreibenden Aufrufe zu schützen.',
  }
}

export function registerAccessGuard(app) {
  if (!accessRequired) return
  app.addHook('onRequest', async (request, reply) => {
    if (!isGuarded(request)) return
    if (matchesPresentedKey(presentedKey(request))) return
    reply.code(401).send({
      ok: false,
      error: 'Zugangsschlüssel fehlt oder ist ungültig.',
      field: 'apiKey',
    })
  })
}