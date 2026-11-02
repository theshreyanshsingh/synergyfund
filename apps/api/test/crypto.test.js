import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { Readable } from "node:stream"
import { test } from "node:test"
import { KEY1, KEY2, testEnv } from "./helpers.js"

testEnv()
const crypto = await import("../src/lib/crypto.js")
const { CHUNK, decryptBytes, decryptField, decryptStream, encryptBytes, encryptField, fieldNeedsSealing, fileNeedsSealing, parseFieldKeys, plainSizeOf, readField, readFileHeader, sealedRange } = crypto

const k1 = parseFieldKeys(KEY1)
const k2k1 = parseFieldKeys(`${KEY2},${KEY1}`)
const k2 = parseFieldKeys(KEY2)

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// Reads bytes start..end of an encrypted file the way the app does: only the pieces that hold them.
function readPart(stored, context, start, end, keys) {
  const header = readFileHeader(stored.subarray(0, crypto.HEADER_PROBE))
  const range = sealedRange(header, stored.length, start, end)
  return collect(decryptStream(Readable.from([stored.subarray(range.start, range.end + 1)]), { header, storedSize: stored.length, start, end, context, keys }))
}

test("key list: first key encrypts, ids and lengths are checked", () => {
  assert.deepEqual(k2k1.map((key) => key.id), ["k2", "k1"])
  assert.throws(() => parseFieldKeys("k1:short"), /32 bytes/)
  assert.throws(() => parseFieldKeys(`${KEY1},${KEY1}`), /repeats/)
  assert.throws(() => parseFieldKeys("nokey"), /id:base64key/)
  assert.equal(parseFieldKeys("").length, 0)
})

test("without keys nothing is encrypted", () => {
  process.env.FIELD_ENCRYPTION_KEYS = ""
  assert.equal(crypto.encryptionOn(), false)
  assert.throws(() => encryptField("secret", "ctx"), /not set/)
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  assert.equal(crypto.encryptionOn(), true)
  assert.equal(crypto.currentKeyId(), "k1")
  process.env.FIELD_ENCRYPTION_KEYS = ""
})

test("a value is ciphertext, opens with its context, and fails anywhere else", () => {
  const stored = encryptField("021000021", "Company.wireRoutingNumber:abc", k1)
  assert.match(stored, /^enc1:k1:/)
  assert.ok(!stored.includes("021000021"))
  assert.notEqual(stored, encryptField("021000021", "Company.wireRoutingNumber:abc", k1), "a fresh nonce every time")
  assert.equal(decryptField(stored, "Company.wireRoutingNumber:abc", k1), "021000021")
  // Copied to another record or another field.
  assert.throws(() => decryptField(stored, "Company.wireRoutingNumber:other", k1))
  assert.throws(() => decryptField(stored, "Company.wireAccountNumber:abc", k1))
  // Tampered with.
  const parts = stored.split(":")
  const body = Buffer.from(parts[4], "base64url")
  body[0] ^= 1
  parts[4] = body.toString("base64url")
  assert.throws(() => decryptField(parts.join(":"), "Company.wireRoutingNumber:abc", k1))
  // Another key under the same name.
  assert.throws(() => decryptField(stored, "Company.wireRoutingNumber:abc", parseFieldKeys(`k1:${randomBytes(32).toString("base64")}`)))
})

test("values saved before encryption still read, and rotation is detected", () => {
  assert.equal(readField("12-3456789", "ctx", k1), "12-3456789")
  assert.equal(readField("", "ctx", k1), "")
  const old = encryptField("12-3456789", "ctx", k1)
  assert.equal(fieldNeedsSealing("12-3456789", k1), true)
  assert.equal(fieldNeedsSealing(old, k1), false)
  assert.equal(fieldNeedsSealing(old, k2k1), true)
  assert.equal(fieldNeedsSealing("", k1), false)
  assert.equal(readField(old, "ctx", k2k1), "12-3456789", "an old key still decrypts")
  assert.throws(() => readField(old, "ctx", k2), /k1 is not configured/)
})

test("files round-trip at every size around a piece boundary", () => {
  for (const size of [0, 1, 100, CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK, 3 * CHUNK + 17]) {
    const plain = randomBytes(size)
    const stored = encryptBytes(plain, "file:a.pdf", k1)
    assert.ok(stored.subarray(0, 7).equals(Buffer.from("SFENC1\n")))
    assert.equal(plainSizeOf(readFileHeader(stored.subarray(0, 64)), stored.length), size)
    assert.ok(decryptBytes(stored, "file:a.pdf", k1).equals(plain), `size ${size}`)
  }
})

test("any byte range of an encrypted file reads back exactly", async () => {
  const plain = randomBytes(3 * CHUNK + 1000)
  const stored = encryptBytes(plain, "file:video.mp4", k1)
  const ranges = [[0, 0], [0, 1], [5, CHUNK - 1], [CHUNK - 1, CHUNK], [CHUNK, CHUNK], [100, 2 * CHUNK + 5], [3 * CHUNK, plain.length - 1], [plain.length - 1, plain.length - 1], [0, plain.length - 1]]
  for (const [start, end] of ranges) {
    const part = await readPart(stored, "file:video.mp4", start, end, k1)
    assert.ok(part.equals(plain.subarray(start, end + 1)), `bytes ${start}-${end}`)
  }
})

test("a moved, tampered, reordered or cut-off file fails to decrypt", async () => {
  const plain = randomBytes(2 * CHUNK + 10)
  const stored = encryptBytes(plain, "file:a.pdf", k1)
  assert.throws(() => decryptBytes(stored, "file:b.pdf", k1), "moved to another place")
  const flipped = Buffer.from(stored)
  flipped[flipped.length - 40] ^= 1
  assert.throws(() => decryptBytes(flipped, "file:a.pdf", k1), "a changed byte")
  // A range read checks the pieces it reads: here the last one.
  const lastFlipped = Buffer.from(stored)
  lastFlipped[lastFlipped.length - 5] ^= 1
  await assert.rejects(readPart(lastFlipped, "file:a.pdf", 2 * CHUNK, 2 * CHUNK + 5, k1), "a changed byte, read as a range")
  assert.ok((await readPart(lastFlipped, "file:a.pdf", 0, 10, k1)).equals(plain.subarray(0, 11)), "pieces before it still read")
  const header = readFileHeader(stored.subarray(0, 64))
  const piece = CHUNK + 16
  const first = stored.subarray(header.length, header.length + piece)
  const second = stored.subarray(header.length + piece, header.length + 2 * piece)
  const swapped = Buffer.concat([stored.subarray(0, header.length), second, first, stored.subarray(header.length + 2 * piece)])
  assert.throws(() => decryptBytes(swapped, "file:a.pdf", k1), "pieces swapped")
  const cut = stored.subarray(0, header.length + 2 * piece)
  assert.throws(() => decryptBytes(cut, "file:a.pdf", k1), "the last piece dropped")
})

test("files stored before encryption open as they are, and rotation is detected", () => {
  const plain = Buffer.from("%PDF-1.7 an old receipt")
  assert.ok(decryptBytes(plain, "file:a.pdf", k1).equals(plain))
  assert.equal(fileNeedsSealing(plain, k1), true)
  const stored = encryptBytes(plain, "file:a.pdf", k1)
  assert.equal(fileNeedsSealing(stored, k1), false)
  assert.equal(fileNeedsSealing(stored, k2k1), true)
  assert.ok(decryptBytes(stored, "file:a.pdf", k2k1).equals(plain))
  assert.throws(() => decryptBytes(stored, "file:a.pdf", k2), /k1 is not configured/)
})
