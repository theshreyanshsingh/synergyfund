import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import { after, before, test } from "node:test"
import { KEY1, contains, startFakeS3, startMongo, testEnv, useS3 } from "./helpers.js"

testEnv()
const mongo = await startMongo()
const s3 = await startFakeS3()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { DocumentFile } = await import("../src/models/index.js")
const files = await import("../src/services/files.js")
const { CHUNK } = await import("../src/lib/crypto.js")

const user = { _id: new mongoose.Types.ObjectId() }
let server
let base

// The app's own way of sending a file: the same function the document, chat and Agent routes use.
before(async () => {
  await mongoose.connect(mongo.uri)
  const app = express()
  app.get("/files/:id", async (req, res, next) => {
    try {
      const file = await DocumentFile.findById(req.params.id)
      await files.sendStoredFile(res, file, { range: req.headers.range, download: req.query.download === "1" })
    } catch (error) {
      next(error)
    }
  })
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.close()
  await mongoose.disconnect()
  await mongo.stop()
  await s3.stop()
})

const upload = (name, buffer, mimetype) => ({ originalname: name, buffer, mimetype, size: buffer.length })

async function fetchBytes(id, headers = {}) {
  const response = await fetch(`${base}/files/${id}`, { headers })
  return { response, body: Buffer.from(await response.arrayBuffer()) }
}

async function checkServing(file, plain, mime) {
  const whole = await fetchBytes(file._id)
  assert.equal(whole.response.status, 200)
  assert.equal(whole.response.headers.get("content-type"), mime)
  assert.equal(Number(whole.response.headers.get("content-length")), plain.length)
  assert.ok(whole.body.equals(plain), "the whole file")
  for (const [start, end] of [[0, 1], [CHUNK - 3, CHUNK + 3], [plain.length - 10, plain.length - 1]]) {
    const part = await fetchBytes(file._id, { Range: `bytes=${start}-${end}` })
    assert.equal(part.response.status, 206)
    assert.equal(part.response.headers.get("content-range"), `bytes ${start}-${end}/${plain.length}`)
    assert.ok(part.body.equals(plain.subarray(start, end + 1)), `bytes ${start}-${end}`)
  }
  const tail = await fetchBytes(file._id, { Range: "bytes=-5" })
  assert.ok(tail.body.equals(plain.subarray(plain.length - 5)), "the last five bytes")
  assert.equal((await fetchBytes(file._id, { Range: `bytes=${plain.length}-` })).response.status, 416)
  assert.ok((await files.readStoredFile(file)).equals(plain), "read whole for zips and the AI")
  const copy = await files.materializeStoredFile(file)
  assert.ok(fs.readFileSync(copy.path).equals(plain), "a decrypted copy on disk for previews")
  await copy.cleanup()
}

test("an upload to this server's disk is stored encrypted and served decrypted, in any range", async () => {
  useS3(s3, false)
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const plain = Buffer.concat([Buffer.from("VIDEO-HEADER Lockbox 4821 "), randomBytes(3 * CHUNK)])
  const file = await files.saveUploadedFile(upload("walkthrough.mp4", plain, "video/mp4"), user, { kind: "file" })
  assert.equal(file.storage, "local")
  assert.equal(file.fileKeyId, "k1")
  const stored = fs.readFileSync(files.uploadsPath(file.storagePath))
  assert.ok(stored.subarray(0, 7).equals(Buffer.from("SFENC1\n")))
  assert.ok(!contains(stored, "Lockbox 4821"), "no plain text on disk")
  await checkServing(file, plain, "video/mp4")
})

test("an upload to S3 is stored encrypted and served decrypted, in any range", async () => {
  useS3(s3)
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const plain = Buffer.concat([Buffer.from("%PDF-1.7 EIN 12-3456789 "), randomBytes(2 * CHUNK + 333)])
  const file = await files.saveUploadedFile(upload("EIN letter.pdf", plain, "application/pdf"), user, { kind: "file" })
  assert.equal(file.storage, "s3")
  assert.match(file.storagePath, /^synergifund\/\d{4}-\d{2}-\d{2}\/\d+-EIN letter\.pdf$/)
  const stored = s3.object(file.storagePath)
  assert.ok(stored.subarray(0, 7).equals(Buffer.from("SFENC1\n")))
  assert.ok(!contains(stored, "12-3456789"), "no plain text in the bucket")
  await checkServing(file, plain, "application/pdf")
})

test("files stored before encryption are still served as they are", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const plain = randomBytes(CHUNK + 50)
  useS3(s3, false)
  fs.writeFileSync(files.uploadsPath("1700000000000-old.jpg"), plain)
  const local = await DocumentFile.create({ name: "old.jpg", mime: "image/jpeg", size: plain.length, storage: "local", storagePath: "1700000000000-old.jpg" })
  await checkServing(local, plain, "image/jpeg")
  useS3(s3)
  s3.objects.set("test-bucket/synergifund/2026-10-01/1700000000000-old.png", plain)
  const remote = await DocumentFile.create({ name: "old.png", mime: "image/png", size: plain.length, storage: "s3", storagePath: "synergifund/2026-10-01/1700000000000-old.png" })
  await checkServing(remote, plain, "image/png")
  s3.objects.set("test-bucket/synergifund/2026-10-01/empty.txt", Buffer.alloc(0))
  const empty = await DocumentFile.create({ name: "empty.txt", mime: "text/plain", size: 0, storage: "s3", storagePath: "synergifund/2026-10-01/empty.txt" })
  const { response, body } = await fetchBytes(empty._id)
  assert.equal(response.status, 200)
  assert.equal(body.length, 0)
})

test("a file moved to another key or changed in storage is refused, and a missing one is a 404", async () => {
  useS3(s3)
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const plain = randomBytes(1000)
  const one = await files.saveUploadedFile(upload("one.pdf", plain, "application/pdf"), user)
  const two = await files.saveUploadedFile(upload("two.pdf", randomBytes(1000), "application/pdf"), user)
  s3.objects.set(`test-bucket/${two.storagePath}`, s3.object(one.storagePath))
  assert.notEqual((await fetchBytes(two._id)).response.status, 200, "one file's bytes under another's name")
  await assert.rejects(files.readStoredFile(two))
  const changed = Buffer.from(s3.object(one.storagePath))
  changed[changed.length - 3] ^= 1
  s3.objects.set(`test-bucket/${one.storagePath}`, changed)
  await assert.rejects(files.readStoredFile(one))
  s3.objects.delete(`test-bucket/${one.storagePath}`)
  assert.equal((await fetchBytes(one._id)).response.status, 404)
})

test("with no key set, uploads are stored as before", async () => {
  useS3(s3)
  process.env.FIELD_ENCRYPTION_KEYS = ""
  const plain = Buffer.from("plain photo bytes")
  const file = await files.saveUploadedFile(upload("photo.jpg", plain, "image/jpeg"), user)
  assert.equal(file.fileKeyId, undefined)
  assert.ok(s3.object(file.storagePath).equals(plain))
  assert.ok((await fetchBytes(file._id)).body.equals(plain))
})
