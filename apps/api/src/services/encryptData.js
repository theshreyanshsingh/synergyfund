import { currentKeyId, decryptField, encryptField, encryptionOn, fieldKeys, fieldNeedsSealing, readField } from "../lib/crypto.js"
import { sealedContext } from "../lib/sealed.js"
import { Activity, Company, DocumentFile, EncryptionKey, HouseSummary, Notification, Property, SEALED_FIELDS } from "../models/index.js"
import { resealFileCopies } from "./backup.js"
import { resealStoredFile } from "./files.js"

// Encrypts what was saved before encryption was switched on, and moves everything to the newest key after a rotation.
// The app reads both forms, so this can run while it serves traffic, and running it again changes nothing. Run by
// `npm run db:encrypt` after a deploy, and before each daily backup.

const CHECK_TEXT = "SynergiFund"
const checkContext = (keyId) => `EncryptionKey:${keyId}`

// Refuses keys that don't match the ones this database was encrypted with: the same name with a different secret, or
// none of the earlier keys at all (a rotation lists the new key first and keeps the old one after it).
export async function checkEncryptionKeys() {
  const keys = fieldKeys()
  if (!keys.length) return
  const saved = await EncryptionKey.find().lean()
  let matched = false
  for (const record of saved) {
    const key = keys.find((item) => item.id === record.keyId)
    if (!key) continue
    let opened = ""
    try {
      opened = decryptField(record.check, checkContext(key.id), [key])
    } catch {}
    if (opened !== CHECK_TEXT) throw new Error(`FIELD_ENCRYPTION_KEYS key ${key.id} is not the key ${key.id} this database was encrypted with. Put the right key back; nothing was changed.`)
    matched = true
  }
  if (saved.length && !matched) {
    throw new Error(`This database was encrypted with key ${saved.map((record) => record.keyId).join(", ")}, which FIELD_ENCRYPTION_KEYS does not list. Put it back (after the new key, to rotate); nothing was changed.`)
  }
  for (const key of keys) {
    if (saved.some((record) => record.keyId === key.id)) continue
    await EncryptionKey.updateOne({ keyId: key.id }, { $setOnInsert: { check: encryptField(CHECK_TEXT, checkContext(key.id), [key]) } }, { upsert: true })
  }
}

export async function encryptStoredData() {
  if (!encryptionOn()) throw new Error("FIELD_ENCRYPTION_KEYS is not set, so there is nothing to encrypt with.")
  await checkEncryptionKeys()
  const done = { companies: 0, properties: 0, documentNotes: 0, houseSummaries: 0, logEntries: 0, files: 0, fileCopies: 0, missing: 0 }
  done.companies = await sealRecords(Company, "Company")
  done.properties = await sealRecords(Property, "Property")
  // What the Agent read in documents before encryption was on.
  done.documentNotes = await sealRecords(DocumentFile, "Document")
  // The house summaries the Agent wrote from them.
  done.houseSummaries = await sealRecords(HouseSummary, "HouseSummary")
  done.logEntries = await hideAccessCodes()

  // Reading a file back is the slow, costly part, so only files not yet under the current key are read.
  const current = currentKeyId()
  const files = await DocumentFile.find({ fileKeyId: { $ne: current }, storagePath: { $nin: [null, ""] } }).select("storage storagePath").lean()
  for (const file of files) {
    try {
      const { changed, keyId } = await resealStoredFile(file)
      await DocumentFile.updateOne({ _id: file._id }, { $set: { fileKeyId: keyId } }, { timestamps: false })
      if (changed) done.files += 1
    } catch (error) {
      // One lost file must not stop the rest being protected. The count tells whoever ran this to look.
      done.missing += 1
      console.error(`Encryption: the file of document ${file._id} could not be encrypted:`, error.message)
    }
  }
  const copies = await resealFileCopies()
  done.fileCopies = copies.changed
  done.missing += copies.missing
  return done
}

// Straight to the collection: the model decrypts on load and refuses update queries on these fields.
async function sealRecords(Model, name) {
  const fields = SEALED_FIELDS[name]
  let count = 0
  const records = await Model.collection.find({}, { projection: Object.fromEntries(fields.map((field) => [field, 1])) }).toArray()
  for (const record of records) {
    const changes = {}
    for (const field of fields) {
      if (!fieldNeedsSealing(record[field])) continue
      const context = sealedContext(name, field, record._id)
      changes[field] = encryptField(readField(record[field], context), context)
    }
    const changed = Object.keys(changes)
    if (!changed.length) continue
    // Only while the values are still the ones read: a save in between was encrypted by the app itself.
    const { modifiedCount } = await Model.collection.updateOne({ _id: record._id, ...Object.fromEntries(changed.map((field) => [field, record[field]])) }, { $set: changes })
    count += modifiedCount
  }
  return count
}

// Before encryption, changing a property's access info put the old and new codes in the activity log and in the
// admins' "Property updated" alerts ("Access info 1234 → 5678"). They now only say it changed. Only a change that
// starts an entry is rewritten, up to the next " · " or " | " (so a code that itself contains one leaves the rest).
const ACCESS_CHANGE = /(?<=^|: | · | \| )Access info (?:(?! · | \| )[\s\S])+/g
const hidden = (text) => String(text || "").replace(ACCESS_CHANGE, "Access info changed")

async function hideAccessCodes() {
  let count = 0
  const lists = [
    [Activity, "detail", await Activity.find({ title: "Property updated", detail: /Access info / }).select("detail").lean()],
    [Notification, "body", await Notification.find({ event: "property.updated", body: /Access info / }).select("body").lean()],
  ]
  for (const [Model, field, records] of lists) {
    for (const record of records) {
      const next = hidden(record[field])
      if (next === record[field]) continue
      const { modifiedCount } = await Model.updateOne({ _id: record._id, [field]: record[field] }, { $set: { [field]: next } }, { timestamps: false })
      count += modifiedCount
    }
  }
  return count
}
