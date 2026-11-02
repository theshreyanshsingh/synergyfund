import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { Readable } from "node:stream"

// Encryption at rest: AES-256-GCM, a key id on every value so keys can rotate, and a context (the field and record,
// or the file's place) bound in as associated data, so a value copied to another field, record or file will not open.
//
// FIELD_ENCRYPTION_KEYS="k2:<base64 32 bytes>,k1:<base64 32 bytes>": the first key encrypts, every key listed decrypts.
// Without it nothing new is encrypted. There is no built-in development key: a local API often runs against the live
// database, and anything it encrypted with a public key would be unreadable on the live site (and not protected).

let parsed = { raw: null, keys: [] }

export function parseFieldKeys(raw) {
  const keys = String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(":")
      if (at < 1) throw new Error("FIELD_ENCRYPTION_KEYS entries look like id:base64key.")
      const id = part.slice(0, at)
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error(`Key id "${id}" must be 1-16 letters, digits, - or _.`)
      const secret = Buffer.from(part.slice(at + 1), "base64")
      if (secret.length !== 32) throw new Error(`Key ${id} must be 32 bytes, base64 encoded (openssl rand -base64 32).`)
      return { id, secret }
    })
  if (new Set(keys.map((key) => key.id)).size !== keys.length) throw new Error("FIELD_ENCRYPTION_KEYS repeats a key id.")
  return keys
}

export function fieldKeys() {
  const raw = process.env.FIELD_ENCRYPTION_KEYS || ""
  if (parsed.raw !== raw) parsed = { raw, keys: parseFieldKeys(raw) }
  return parsed.keys
}

export function encryptionOn() {
  return fieldKeys().length > 0
}

export function currentKeyId() {
  return fieldKeys()[0]?.id || ""
}

function encryptingKey(keys) {
  if (!keys.length) throw new Error("FIELD_ENCRYPTION_KEYS is not set, so nothing can be encrypted.")
  return keys[0]
}

function keyFor(keyId, keys) {
  const key = keys.find((item) => item.id === keyId)
  if (!key) throw new Error(`Encryption key ${keyId} is not configured (FIELD_ENCRYPTION_KEYS).`)
  return key
}

// ---- Single values ----

const PREFIX = "enc1"

export function encryptField(plain, context, keys = fieldKeys()) {
  if (plain === "") return ""
  const key = encryptingKey(keys)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key.secret, iv)
  cipher.setAAD(Buffer.from(context, "utf8"))
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return [PREFIX, key.id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(":")
}

export function decryptField(stored, context, keys = fieldKeys()) {
  if (stored === "") return ""
  const [prefix, keyId, iv, tag, body] = stored.split(":")
  if (prefix !== PREFIX || body === undefined) throw new Error("Not an encrypted value.")
  const decipher = createDecipheriv("aes-256-gcm", keyFor(keyId, keys).secret, Buffer.from(iv, "base64url"))
  decipher.setAAD(Buffer.from(context, "utf8"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")
}

export function isEncrypted(stored) {
  return typeof stored === "string" && stored.startsWith(`${PREFIX}:`)
}

// Reads a value that may have been saved before encryption was switched on.
export function readField(stored, context, keys = fieldKeys()) {
  return isEncrypted(stored) ? decryptField(stored, context, keys) : stored
}

// True for a value saved before encryption, or under an older key, so the encryption job rewrites it.
export function fieldNeedsSealing(stored, keys = fieldKeys()) {
  if (typeof stored !== "string" || stored === "") return false
  return !isEncrypted(stored) || stored.split(":")[1] !== encryptingKey(keys).id
}

// ---- Files ----
//
// A stored file is a header, then the file in 64 KiB pieces, each encrypted on its own with its own tag, so any part
// of a large video can be read without decrypting the rest. The header is "SFENC1\n", the key id's length and the
// key id, and a random salt that gives the file its own key. A piece's number is its nonce, and the last piece is
// marked, so pieces can't be reordered, dropped or cut off. Files stored before encryption have no header and still
// open as they are.

const FILE_MAGIC = Buffer.from("SFENC1\n", "utf8")
export const CHUNK = 64 * 1024
const TAG = 16
const SALT = 16
const SEALED_CHUNK = CHUNK + TAG
// Enough of a file's start to read any header (magic, length, a 16-character key id, salt).
export const HEADER_PROBE = FILE_MAGIC.length + 1 + 16 + SALT

export function isEncryptedFile(stored) {
  return stored.length >= FILE_MAGIC.length && stored.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)
}

// The header of an encrypted file from its first bytes, or null for a file stored before encryption.
export function readFileHeader(start) {
  if (!isEncryptedFile(start)) return null
  const idLength = start[FILE_MAGIC.length]
  const length = FILE_MAGIC.length + 1 + idLength + SALT
  if (!idLength || start.length < length) throw new Error("The encrypted file's header is damaged.")
  return {
    keyId: start.subarray(FILE_MAGIC.length + 1, FILE_MAGIC.length + 1 + idLength).toString("utf8"),
    salt: start.subarray(length - SALT, length),
    length,
  }
}

function fileKey(secret, salt) {
  return Buffer.from(hkdfSync("sha256", secret, salt, "synergifund file", 32))
}

function nonce(index) {
  const value = Buffer.alloc(12)
  value.writeUInt32BE(index, 8)
  return value
}

function chunkAad(context, last) {
  return Buffer.concat([Buffer.from(context, "utf8"), Buffer.from([last ? 1 : 0])])
}

const chunkCount = (plainSize) => Math.max(1, Math.ceil(plainSize / CHUNK))

// The file's size before encryption, from its stored size.
export function plainSizeOf(header, storedSize) {
  const body = storedSize - header.length
  const size = body - TAG * Math.ceil(body / SEALED_CHUNK)
  if (body < TAG || size < 0) throw new Error("The encrypted file is damaged.")
  return size
}

export function encryptBytes(plain, context, keys = fieldKeys()) {
  const key = encryptingKey(keys)
  const salt = randomBytes(SALT)
  const secret = fileKey(key.secret, salt)
  const keyId = Buffer.from(key.id, "utf8")
  const parts = [FILE_MAGIC, Buffer.from([keyId.length]), keyId, salt]
  const count = chunkCount(plain.length)
  for (let index = 0; index < count; index += 1) {
    const cipher = createCipheriv("aes-256-gcm", secret, nonce(index))
    cipher.setAAD(chunkAad(context, index === count - 1))
    parts.push(cipher.update(plain.subarray(index * CHUNK, (index + 1) * CHUNK)), cipher.final(), cipher.getAuthTag())
  }
  return Buffer.concat(parts)
}

function openChunk(secret, sealed, index, last, context) {
  const decipher = createDecipheriv("aes-256-gcm", secret, nonce(index))
  decipher.setAAD(chunkAad(context, last))
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG))
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()])
}

export function decryptBytes(stored, context, keys = fieldKeys()) {
  const header = readFileHeader(stored.subarray(0, HEADER_PROBE))
  if (!header) return stored
  const secret = fileKey(keyFor(header.keyId, keys).secret, header.salt)
  const count = chunkCount(plainSizeOf(header, stored.length))
  const parts = []
  for (let index = 0; index < count; index += 1) {
    const start = header.length + index * SEALED_CHUNK
    parts.push(openChunk(secret, stored.subarray(start, Math.min(stored.length, start + SEALED_CHUNK)), index, index === count - 1, context))
  }
  return Buffer.concat(parts)
}

// Where in the stored file bytes `start` to `end` (inclusive, of the plain file) are: the encrypted pieces to read.
export function sealedRange(header, storedSize, start, end) {
  const first = Math.floor(start / CHUNK)
  const last = Math.floor(Math.max(start, end) / CHUNK)
  return { first, last, start: header.length + first * SEALED_CHUNK, end: Math.min(storedSize, header.length + (last + 1) * SEALED_CHUNK) - 1 }
}

// Decrypts the pieces `sealedRange` named as they arrive, and passes on only bytes `start` to `end` of the plain file.
// `source` is a stream of the stored bytes from `sealedRange(...).start`.
export function decryptStream(source, { header, storedSize, start, end, context, keys = fieldKeys() }) {
  const secret = fileKey(keyFor(header.keyId, keys).secret, header.salt)
  const count = chunkCount(plainSizeOf(header, storedSize))
  const range = sealedRange(header, storedSize, start, end)
  async function* pieces() {
    let index = range.first
    let pending = Buffer.alloc(0)
    let skip = start - range.first * CHUNK
    let left = end - start + 1
    const take = (plain) => {
      const part = plain.subarray(skip, skip + Math.max(0, left))
      skip = Math.max(0, skip - plain.length)
      left -= part.length
      return part
    }
    for await (const data of source) {
      pending = pending.length ? Buffer.concat([pending, data]) : Buffer.from(data)
      while (pending.length >= SEALED_CHUNK && index <= range.last) {
        const piece = take(openChunk(secret, pending.subarray(0, SEALED_CHUNK), index, index === count - 1, context))
        pending = pending.subarray(SEALED_CHUNK)
        index += 1
        if (piece.length) yield piece
      }
    }
    // The file's last piece is shorter than the rest.
    if (index === range.last && index === count - 1 && pending.length) {
      const piece = take(openChunk(secret, pending, index, true, context))
      index += 1
      if (piece.length) yield piece
    }
    if (index <= range.last) throw new Error("The encrypted file ended early.")
  }
  return Readable.from(pieces(), { objectMode: false })
}

// True for a file stored before encryption, or under an older key.
export function fileNeedsSealing(stored, keys = fieldKeys()) {
  const header = readFileHeader(stored.subarray(0, HEADER_PROBE))
  return !header || header.keyId !== encryptingKey(keys).id
}
