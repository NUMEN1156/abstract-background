import crypto from 'node:crypto'

/**
 * Demo-Tresor für Provider-Zugangsdaten.
 *
 * Der Zweck dieses Moduls ist der Sicherheitsnachweis des Prototyps: API-Schlüssel
 * existieren ausschließlich serverseitig, liegen dort AES-256-GCM-verschlüsselt und
 * werden nach außen niemals im Klartext ausgegeben. Nach außen sichtbar sind nur
 * eine maskierte Vorschau, der Fingerprint des Geheimtextes und die Kennung des
 * verwendeten Verfahrens.
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12

function resolveMasterKey() {
  const fromEnv = process.env.ABSTRACT_MASTER_KEY
  if (fromEnv && fromEnv.length >= 32) {
    return crypto.createHash('sha256').update(fromEnv).digest()
  }
  return crypto.randomBytes(KEY_BYTES)
}

const masterKey = resolveMasterKey()
const vault = new Map()

/** Legt ein Geheimnis verschlüsselt ab und gibt nur Metadaten zurück. */
export function storeSecret(providerId, plaintext, hint) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  vault.set(providerId, {
    iv,
    tag,
    ciphertext,
    updatedAt: new Date().toISOString(),
    hint: hint ?? maskPreview(plaintext),
  })

  return describeSecret(providerId)
}

export function describeSecret(providerId) {
  const entry = vault.get(providerId)
  if (!entry) {
    return {
      providerId,
      present: false,
      algorithm: ALGORITHM,
      keyOrigin: process.env.ABSTRACT_MASTER_KEY ? 'umgebung' : 'laufzeit-generiert',
    }
  }
  const fingerprint = crypto
    .createHash('sha256')
    .update(entry.ciphertext)
    .digest('hex')
    .slice(0, 16)
  return {
    providerId,
    present: true,
    algorithm: ALGORITHM,
    keyOrigin: process.env.ABSTRACT_MASTER_KEY ? 'umgebung' : 'laufzeit-generiert',
    hint: entry.hint,
    fingerprint,
    updatedAt: entry.updatedAt,
    ciphertextBytes: entry.ciphertext.length,
  }
}

export function describeVault() {
  const entries = [...vault.keys()].map((id) => describeSecret(id))
  return {
    algorithm: ALGORITHM,
    keyOrigin: process.env.ABSTRACT_MASTER_KEY ? 'umgebung' : 'laufzeit-generiert',
    entries,
    frontendExposure: false,
  }
}

/** Entschlüsselt nur serverseitig; wird im Prototyp ausschließlich zum Selbsttest genutzt. */
export function revealSecret(providerId) {
  const entry = vault.get(providerId)
  if (!entry) return null
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, entry.iv)
  decipher.setAuthTag(entry.tag)
  return Buffer.concat([decipher.update(entry.ciphertext), decipher.final()]).toString('utf8')
}

export function maskPreview(value) {
  const head = value.slice(0, 3)
  const tail = value.slice(-2)
  return `${head}${'•'.repeat(Math.max(6, Math.min(18, value.length - 5)))}${tail}`
}

/** Belegt den Tresor mit erkennbar fiktiven Demo-Schlüsseln. */
export function seedVault(providers) {
  for (const provider of providers) {
    storeSecret(provider.id, `demo-${provider.id}-${crypto.randomBytes(12).toString('hex')}`)
  }
  return describeVault()
}