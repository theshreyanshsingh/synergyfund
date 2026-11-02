import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { after, before, test } from "node:test"
import { KEY1, KEY2, contains, startFakeS3, startMongo, testEnv, useS3 } from "./helpers.js"

testEnv()
const mongo = await startMongo()
const s3 = await startFakeS3()
const { default: mongoose } = await import("mongoose")
const { Activity, BackupFileCopy, Company, DocumentFile, EncryptionKey, Notification, Property } = await import("../src/models/index.js")
const files = await import("../src/services/files.js")
const { checkEncryptionKeys, encryptStoredData } = await import("../src/services/encryptData.js")
const { decryptBytes } = await import("../src/lib/crypto.js")

// Records and files the way the live site has them today: nothing encrypted.
const PDF = Buffer.concat([Buffer.from("%PDF-1.7 Operating agreement, EIN 12-3456789 "), randomBytes(200000)])
const PHOTO = Buffer.concat([Buffer.from("JPEG lockbox photo 4821 "), randomBytes(5000)])
const OLD_COPY = Buffer.from("receipt for a deleted expense, card 4242")
const ids = {}

before(async () => {
  await mongoose.connect(mongo.uri)
  useS3(s3)
  ids.company = (await Company.collection.insertOne({ name: "Oak Street LLC", ein: "12-3456789", wireBankName: "First Bank", wireRoutingNumber: "021000021", wireAccountNumber: "000012345678", wireEntityName: "Oak Street LLC", wireAddress: "1 Main St", notes: "" })).insertedId
  ids.property = (await Property.collection.insertOne({ address: "12 Elm St", accessInfo: "Lockbox 4821 on the back door", stage: "Rehab" })).insertedId
  ids.emptyProperty = (await Property.collection.insertOne({ address: "9 Pine St", accessInfo: "" })).insertedId
  ids.activity = (await Activity.collection.insertOne({ title: "Property updated", detail: "Stage Purchased → Rehab · Customer terms blank → Access info is in the app · Access info Lockbox 1111 → Lockbox 4821 on the back door · Labels none → BRRRR", actorName: "Sam" })).insertedId
  ids.notice = (await Notification.collection.insertOne({ userId: new mongoose.Types.ObjectId(), event: "property.updated", title: "Property updated (2)", body: "Sam: Access info blank → Gate 9999 | Stage Rehab → Rented" })).insertedId
  ids.otherActivity = (await Activity.collection.insertOne({ title: "Company updated", detail: "Oak Street LLC: Notes blank → Access info is in the shared drive", actorName: "Sam" })).insertedId

  const s3Path = "synergifund/2026-10-01/1790000000000-Operating agreement.pdf"
  s3.objects.set(`test-bucket/${s3Path}`, PDF)
  s3.objects.set(`test-bucket/synergifund/backups/files/${s3Path}`, PDF)
  ids.s3File = (await DocumentFile.collection.insertOne({ name: "Operating agreement.pdf", mime: "application/pdf", size: PDF.length, storage: "s3", storagePath: s3Path, kind: "file" })).insertedId
  await BackupFileCopy.collection.insertOne({ storage: "s3", storagePath: s3Path, copiedAt: new Date() })
  // A copy kept for a backup after its document was deleted.
  const gonePath = "synergifund/2026-09-01/1780000000000-receipt.jpg"
  s3.objects.set(`test-bucket/synergifund/backups/files/${gonePath}`, OLD_COPY)
  await BackupFileCopy.collection.insertOne({ storage: "s3", storagePath: gonePath, copiedAt: new Date(), goneSince: new Date() })

  fs.mkdirSync(path.join(process.env.UPLOADS_DIR), { recursive: true })
  fs.writeFileSync(path.join(process.env.UPLOADS_DIR, "1790000000001-lockbox.jpg"), PHOTO)
  ids.localFile = (await DocumentFile.collection.insertOne({ name: "lockbox.jpg", mime: "image/jpeg", size: PHOTO.length, storage: "local", storagePath: "1790000000001-lockbox.jpg", kind: "photo" })).insertedId
  fs.mkdirSync(path.join(process.env.BACKUPS_DIR, "files"), { recursive: true })
  fs.writeFileSync(path.join(process.env.BACKUPS_DIR, "files", "1790000000001-lockbox.jpg"), PHOTO)
  await BackupFileCopy.collection.insertOne({ storage: "local", storagePath: "1790000000001-lockbox.jpg", copiedAt: new Date() })
  // Its file was lost from the bucket: counted, and the rest still get encrypted.
  ids.lostFile = (await DocumentFile.collection.insertOne({ name: "lost.pdf", mime: "application/pdf", size: 10, storage: "s3", storagePath: "synergifund/2026-10-02/lost.pdf", kind: "file" })).insertedId
})

after(async () => {
  await mongoose.disconnect()
  await mongo.stop()
  await s3.stop()
})

const raw = (Model, id) => Model.collection.findOne({ _id: id })
const localCopy = () => fs.readFileSync(path.join(process.env.BACKUPS_DIR, "files", "1790000000001-lockbox.jpg"))
const keyOf = (stored) => stored.subarray(8, 8 + stored[7]).toString("utf8")

test("refuses to run without a key", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = ""
  await assert.rejects(encryptStoredData(), /not set/)
})

test("encrypts every record, log entry, file and backup copy saved before encryption", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const done = await encryptStoredData()
  assert.deepEqual(done, { companies: 1, properties: 1, logEntries: 2, files: 2, fileCopies: 3, missing: 1 })

  const company = await raw(Company, ids.company)
  for (const field of ["ein", "wireBankName", "wireRoutingNumber", "wireAccountNumber", "wireEntityName", "wireAddress"]) assert.match(company[field], /^enc1:k1:/, field)
  assert.equal(company.name, "Oak Street LLC")
  assert.match((await raw(Property, ids.property)).accessInfo, /^enc1:k1:/)
  assert.equal((await raw(Property, ids.emptyProperty)).accessInfo, "")
  assert.equal((await raw(Activity, ids.activity)).detail, "Stage Purchased → Rehab · Customer terms blank → Access info is in the app · Access info changed · Labels none → BRRRR")
  assert.equal((await raw(Notification, ids.notice)).body, "Sam: Access info changed | Stage Rehab → Rented")
  assert.equal((await raw(Activity, ids.otherActivity)).detail, "Oak Street LLC: Notes blank → Access info is in the shared drive", "other entries are left alone")

  const s3File = await raw(DocumentFile, ids.s3File)
  assert.equal(s3File.fileKeyId, "k1")
  const stored = s3.object(s3File.storagePath)
  assert.ok(!contains(stored, "12-3456789"), "no plain text left in the bucket")
  assert.ok(!contains(s3.object(`synergifund/backups/files/${s3File.storagePath}`), "12-3456789"), "nor in its backup copy")
  assert.ok(!contains(s3.object("synergifund/backups/files/synergifund/2026-09-01/1780000000000-receipt.jpg"), "4242"), "nor in a deleted file's copy")
  assert.ok(!contains(fs.readFileSync(path.join(process.env.UPLOADS_DIR, "1790000000001-lockbox.jpg")), "lockbox photo"), "nor on this server's disk")
  assert.ok(!contains(localCopy(), "lockbox photo"))
  assert.equal((await raw(DocumentFile, ids.lostFile)).fileKeyId, undefined)

  // The app reads all of it as before.
  assert.equal((await Company.findById(ids.company)).wireAccountNumber, "000012345678")
  assert.equal((await Property.findById(ids.property)).accessInfo, "Lockbox 4821 on the back door")
  assert.ok((await files.readStoredFile(await DocumentFile.findById(ids.s3File))).equals(PDF))
  assert.ok((await files.readStoredFile(await DocumentFile.findById(ids.localFile))).equals(PHOTO))
  // A backup copy opens as its file (what a restore puts back).
  assert.ok(decryptBytes(localCopy(), files.fileContext("1790000000001-lockbox.jpg")).equals(PHOTO))
})

test("running it again changes nothing and reads no file again", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const before = { company: await raw(Company, ids.company), file: Buffer.from(s3.object("synergifund/2026-10-01/1790000000000-Operating agreement.pdf")) }
  const reads = [...s3.gets.values()].reduce((total, count) => total + count, 0)
  const done = await encryptStoredData()
  assert.deepEqual(done, { companies: 0, properties: 0, logEntries: 0, files: 0, fileCopies: 0, missing: 1 })
  assert.deepEqual(await raw(Company, ids.company), before.company)
  assert.ok(s3.object("synergifund/2026-10-01/1790000000000-Operating agreement.pdf").equals(before.file))
  const readsAfter = [...s3.gets.values()].reduce((total, count) => total + count, 0)
  assert.equal(readsAfter - reads, 0, "no file is downloaded again (the lost one is only asked for)")
})

test("a rotation moves everything to the new key, after which the old key can go", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = `${KEY2},${KEY1}`
  const done = await encryptStoredData()
  assert.deepEqual(done, { companies: 1, properties: 1, logEntries: 0, files: 2, fileCopies: 3, missing: 1 })
  assert.match((await raw(Company, ids.company)).ein, /^enc1:k2:/)
  assert.equal(keyOf(s3.object("synergifund/2026-10-01/1790000000000-Operating agreement.pdf")), "k2")
  assert.equal(keyOf(localCopy()), "k2")
  assert.deepEqual((await EncryptionKey.find().lean()).map((record) => record.keyId).sort(), ["k1", "k2"])

  process.env.FIELD_ENCRYPTION_KEYS = KEY2
  await checkEncryptionKeys()
  assert.equal((await Company.findById(ids.company)).ein, "12-3456789")
  assert.equal((await Property.findById(ids.property)).accessInfo, "Lockbox 4821 on the back door")
  assert.ok((await files.readStoredFile(await DocumentFile.findById(ids.s3File))).equals(PDF))
  assert.deepEqual(await encryptStoredData(), { companies: 0, properties: 0, logEntries: 0, files: 0, fileCopies: 0, missing: 1 })
})

test("a wrong key is refused before anything is written with it", async () => {
  const before = await raw(Company, ids.company)
  // The right name with another secret.
  process.env.FIELD_ENCRYPTION_KEYS = `k2:${randomBytes(32).toString("base64")}`
  await assert.rejects(checkEncryptionKeys(), /not the key k2/)
  await assert.rejects(encryptStoredData(), /not the key k2/)
  // A new key alone, without the one the data is under.
  process.env.FIELD_ENCRYPTION_KEYS = `k9:${randomBytes(32).toString("base64")}`
  await assert.rejects(encryptStoredData(), /encrypted with key k1, k2/)
  assert.deepEqual(await raw(Company, ids.company), before)
  assert.equal(await EncryptionKey.countDocuments({ keyId: "k9" }), 0)
})

test("a record saved by the app while the job runs keeps the app's value", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY2
  const { insertedId } = await Company.collection.insertOne({ name: "Race LLC", ein: "11-1111111" })
  // The app saves a new EIN between the job reading the record and writing it back.
  const original = Company.collection.updateOne.bind(Company.collection)
  let raced = false
  Company.collection.updateOne = async (filter, update, options) => {
    if (!raced && String(filter._id) === String(insertedId)) {
      raced = true
      const company = await Company.findById(insertedId)
      company.ein = "22-2222222"
      await company.save()
    }
    return original(filter, update, options)
  }
  try {
    await encryptStoredData()
  } finally {
    Company.collection.updateOne = original
  }
  assert.ok(raced)
  assert.equal((await Company.findById(insertedId)).ein, "22-2222222")
})
