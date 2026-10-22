import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import zlib from "node:zlib"
import { once } from "node:events"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import mongoose from "mongoose"
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3"
import { BackupFileCopy, BackupSetting, DocumentFile } from "../models/index.js"
import { storageClient as s3Client, storageConfig, uploadsPath } from "./files.js"
import { teamHour, teamTimezone, teamToday } from "../lib/dates.js"

// Backups of all the workspace's data. Each backup is one gzipped file: a header line, then one line per record
// ({"c": collection, "d": record in MongoDB Extended JSON, so ids and dates come back exactly}), then a closing line
// with the count per collection (a file without it is incomplete). Stored next to the documents (Amazon S3, or the
// server's disk when S3 is not set up), with a small .json beside it describing it.
//
// Uploaded files (documents, photos, receipts) are copied once each into the backups area, so a restore can bring back
// a file that was deleted since. A copy is removed only when no kept backup can need it any more.

const { EJSON } = mongoose.mongo.BSON
const FORMAT = "synergifund-backup"
const VERSION = 1
const LOCAL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backups")
const ALWAYS_KEEP = 3
const KEEP_CHOICES = [7, 14, 30, 60, 90]
const BATCH = 500
const COPY_PARALLEL = 8
const ID_PATTERN = /^\d{8}-\d{6}-(daily|manual|before-restore)-[a-z0-9]{4}$/
const NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$/
const KIND_LABELS = { daily: "Daily", manual: "Manual", "before-restore": "Before a restore" }

let job = null
let lastJob = null
let restoring = false
let scheduleTimer = null
let retryAfter = 0

export { KEEP_CHOICES }

// The backup bookkeeping collections are never in a backup and never replaced by a restore.
function ownCollections() {
  return new Set([BackupSetting.collection.collectionName, BackupFileCopy.collection.collectionName])
}

function usableName(name) {
  return NAME_PATTERN.test(name) && !name.startsWith("system.") && !ownCollections().has(name)
}

// Where backups live: Amazon S3 under <prefix>/backups when it is set up, otherwise apps/api/backups on this server.
function store() {
  const config = storageConfig()
  if (config.enabled) {
    const client = s3Client()
    const root = `${config.prefix}/backups`
    const key = (name) => `${root}/${name}`
    return {
      kind: "s3",
      label: `Amazon S3 · ${config.bucket}/${root}`,
      async putFile(name, file, type) {
        const { size } = await fs.promises.stat(file)
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key(name), Body: fs.createReadStream(file), ContentLength: size, ContentType: type }))
      },
      async putText(name, text) {
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key(name), Body: text, ContentType: "application/json" }))
      },
      async open(name) {
        const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key(name) }))
        return response.Body instanceof Readable ? response.Body : Readable.fromWeb(response.Body)
      },
      async list(folder) {
        const items = []
        let token
        do {
          const page = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: key(`${folder}/`), ContinuationToken: token }))
          for (const item of page.Contents || []) items.push({ name: item.Key.slice(root.length + 1), size: item.Size || 0 })
          token = page.IsTruncated ? page.NextContinuationToken : undefined
        } while (token)
        return items
      },
      async remove(name) {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key(name) }))
      },
    }
  }
  const place = (name) => inside(LOCAL_ROOT, name)
  return {
    kind: "local",
    label: "This server's disk (set up Amazon S3 to keep backups off the server)",
    async putFile(name, file) {
      const target = place(name)
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.copyFile(file, target)
    },
    async putText(name, text) {
      const target = place(name)
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.writeFile(target, text)
    },
    async open(name) {
      return fs.createReadStream(place(name))
    },
    async list(folder) {
      const dir = place(folder)
      const names = await fs.promises.readdir(dir).catch(() => [])
      const items = []
      for (const name of names) {
        const stat = await fs.promises.stat(path.join(dir, name)).catch(() => null)
        if (stat?.isFile()) items.push({ name: `${folder}/${name}`, size: stat.size })
      }
      return items
    },
    async remove(name) {
      await fs.promises.unlink(place(name)).catch((error) => {
        if (error.code !== "ENOENT") throw error
      })
    },
  }
}

// A path under root, refusing anything that would leave it ("../").
function inside(root, relative) {
  const target = path.resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("That path is outside the backups folder.")
  return target
}

function notFound(error) {
  return error?.code === "ENOENT" || error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404
}

function tempFile(label) {
  return path.join(os.tmpdir(), `synergifund-${label}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.ndjson.gz`)
}

async function removeTemp(file) {
  if (file) await fs.promises.unlink(file).catch(() => {})
}

function newId(kind, date) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
  return `${stamp}-${kind}-${crypto.randomBytes(2).toString("hex")}`
}

async function sha256(file) {
  const hash = crypto.createHash("sha256")
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest("hex")
}

// ---- Writing a backup ----

async function writeDump(target, { snapshot }) {
  const db = mongoose.connection.db
  const own = ownCollections()
  const infos = await db.listCollections({}, { nameOnly: false }).toArray()
  const names = infos
    .filter((info) => (info.type || "collection") === "collection" && NAME_PATTERN.test(info.name) && !info.name.startsWith("system.") && !own.has(info.name))
    .map((info) => info.name)
    .sort()
  // One moment for every collection (a snapshot), when the database allows it; the caller retries without.
  const session = snapshot ? mongoose.connection.getClient().startSession({ snapshot: true }) : null
  const gzip = zlib.createGzip({ level: 6 })
  const finished = pipeline(gzip, fs.createWriteStream(target))
  const write = async (text) => {
    if (!gzip.write(text)) await once(gzip, "drain")
  }
  const counts = {}
  try {
    await write(`${JSON.stringify({ format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), database: db.databaseName, collections: names })}\n`)
    for (const name of names) {
      counts[name] = 0
      const cursor = db.collection(name).find({}, { sort: { _id: 1 }, batchSize: BATCH, promoteValues: false, ...(session ? { session } : {}) })
      for await (const doc of cursor) {
        await write(`{"c":${JSON.stringify(name)},"d":${EJSON.stringify(doc, { relaxed: false })}}\n`)
        counts[name] += 1
      }
    }
    await write(`${JSON.stringify({ end: true, counts })}\n`)
    gzip.end()
    await finished
    return { names, counts }
  } catch (error) {
    gzip.destroy(error)
    await finished.catch(() => {})
    throw error
  } finally {
    await session?.endSession().catch(() => {})
  }
}

async function dumpDatabase(target) {
  try {
    return await writeDump(target, { snapshot: true })
  } catch (error) {
    // Snapshots need a replica set (Atlas has one; a single local server does not) and finish within 5 minutes.
    console.warn("Backup: a snapshot was not possible, copying collection by collection instead.", error.message)
    await removeTemp(target)
    return writeDump(target, { snapshot: false })
  }
}

// Makes a backup now. Keeps the file in `keepLocal` (for a restore's undo) when asked.
async function makeBackup({ kind, by = "", keepLocal = false, step = () => {} }) {
  const started = new Date()
  const id = newId(kind, started)
  const target = tempFile("backup")
  const place = store()
  let uploaded = false
  try {
    step("Saving the data")
    const { names, counts } = await dumpDatabase(target)
    const size = (await fs.promises.stat(target)).size
    const checksum = await sha256(target)
    step("Storing the backup")
    await place.putFile(`db/${id}.ndjson.gz`, target, "application/gzip")
    uploaded = true
    step("Copying documents and photos")
    const files = await syncFileCopies()
    const meta = {
      id,
      kind,
      createdAt: started.toISOString(),
      by,
      size,
      sha256: checksum,
      format: FORMAT,
      version: VERSION,
      database: mongoose.connection.db.databaseName,
      collections: names.length,
      documents: Object.values(counts).reduce((total, count) => total + count, 0),
      counts,
      files,
      durationMs: Date.now() - started.getTime(),
    }
    // Written last: a backup is listed only once everything above worked.
    await place.putText(`db/${id}.json`, JSON.stringify(meta, null, 1))
    step("Removing old backups")
    await pruneBackups().catch((error) => console.error("Backup: removing old backups failed", error))
    if (!keepLocal) await removeTemp(target)
    return { meta, file: keepLocal ? target : "" }
  } catch (error) {
    await removeTemp(target)
    if (uploaded) await place.remove(`db/${id}.ndjson.gz`).catch(() => {})
    throw error
  }
}

// ---- Copies of uploaded files ----

function copyName(storagePath) {
  return `files/${storagePath}`
}

function copySource(bucket, key) {
  return `${bucket}/${key.split("/").map((part) => encodeURIComponent(part)).join("/")}`
}

async function copyOut(file) {
  const config = storageConfig()
  if (file.storage === "s3") {
    if (!config.enabled) return "skipped"
    try {
      await s3Client().send(new CopyObjectCommand({ Bucket: config.bucket, Key: `${config.prefix}/backups/${copyName(file.storagePath)}`, CopySource: copySource(config.bucket, file.storagePath) }))
      return "copied"
    } catch (error) {
      if (notFound(error)) return "missing"
      throw error
    }
  }
  try {
    const target = inside(LOCAL_ROOT, copyName(file.storagePath))
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.copyFile(inside(uploadsPath(), file.storagePath), target)
    return "copied"
  } catch (error) {
    if (notFound(error)) return "missing"
    throw error
  }
}

async function copyBack(file) {
  const config = storageConfig()
  if (file.storage === "s3") {
    if (!config.enabled) return "skipped"
    try {
      await s3Client().send(new CopyObjectCommand({ Bucket: config.bucket, Key: file.storagePath, CopySource: copySource(config.bucket, `${config.prefix}/backups/${copyName(file.storagePath)}`) }))
      return "restored"
    } catch (error) {
      if (notFound(error)) return "missing"
      throw error
    }
  }
  try {
    const target = inside(uploadsPath(), file.storagePath)
    await fs.promises.copyFile(inside(LOCAL_ROOT, copyName(file.storagePath)), target, fs.constants.COPYFILE_EXCL)
    return "restored"
  } catch (error) {
    if (error.code === "EEXIST") return "present"
    if (notFound(error)) return "missing"
    throw error
  }
}

async function liveFileExists(file) {
  const config = storageConfig()
  if (file.storage === "s3") {
    if (!config.enabled) return true
    try {
      await s3Client().send(new HeadObjectCommand({ Bucket: config.bucket, Key: file.storagePath }))
      return true
    } catch (error) {
      if (notFound(error)) return false
      throw error
    }
  }
  try {
    await fs.promises.access(inside(uploadsPath(), file.storagePath))
    return true
  } catch {
    return false
  }
}

async function eachLimit(list, limit, work) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const item = list[next]
      next += 1
      await work(item)
    }
  })
  await Promise.all(runners)
}

const fileKey = (storage, storagePath) => `${storage || "local"}:${storagePath}`

// Copies every uploaded file that has no backup copy yet, and notes copies whose document is gone.
async function syncFileCopies() {
  const docs = await DocumentFile.find({ storagePath: { $nin: [null, ""] } }).select("storage storagePath").lean()
  const copies = await BackupFileCopy.find({}).lean()
  const have = new Map(copies.map((copy) => [fileKey(copy.storage, copy.storagePath), copy]))
  const live = new Map()
  for (const doc of docs) live.set(fileKey(doc.storage, doc.storagePath), { storage: doc.storage || "local", storagePath: doc.storagePath })
  const todo = [...live.entries()].filter(([key]) => !have.has(key)).map(([, file]) => file)
  const counts = { total: live.size, copied: 0, missing: 0, skipped: 0 }
  await eachLimit(todo, COPY_PARALLEL, async (file) => {
    const result = await copyOut(file)
    counts[result] += 1
    if (result === "copied") {
      await BackupFileCopy.updateOne({ storage: file.storage, storagePath: file.storagePath }, { $set: { copiedAt: new Date() }, $unset: { goneSince: 1 } }, { upsert: true })
    }
  })
  const gone = copies.filter((copy) => !live.has(fileKey(copy.storage, copy.storagePath)) && !copy.goneSince).map((copy) => copy._id)
  const back = copies.filter((copy) => live.has(fileKey(copy.storage, copy.storagePath)) && copy.goneSince).map((copy) => copy._id)
  if (gone.length) await BackupFileCopy.updateMany({ _id: { $in: gone } }, { $set: { goneSince: new Date() } })
  if (back.length) await BackupFileCopy.updateMany({ _id: { $in: back } }, { $unset: { goneSince: 1 } })
  counts.kept = counts.total - counts.missing - counts.skipped
  return counts
}

// A copy whose document was already gone before the oldest kept backup was made is in no kept backup.
async function pruneFileCopies(oldestKept) {
  if (!oldestKept) return
  const stale = await BackupFileCopy.find({ goneSince: { $lt: oldestKept } }).lean()
  const config = storageConfig()
  await eachLimit(stale, COPY_PARALLEL, async (copy) => {
    if (copy.storage === "s3") {
      if (!config.enabled) return
      await s3Client().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: `${config.prefix}/backups/${copyName(copy.storagePath)}` }))
    } else {
      await fs.promises.unlink(inside(LOCAL_ROOT, copyName(copy.storagePath))).catch((error) => {
        if (!notFound(error)) throw error
      })
    }
    await BackupFileCopy.deleteOne({ _id: copy._id })
  })
}

// ---- Listing and removing ----

export async function listBackups() {
  const place = store()
  const items = await place.list("db")
  const sizes = new Map(items.map((item) => [item.name, item.size]))
  const metas = []
  await eachLimit(items.filter((item) => item.name.endsWith(".json")), 8, async (item) => {
    try {
      const meta = JSON.parse(await readText(await place.open(item.name)))
      if (!ID_PATTERN.test(String(meta.id || "")) || !sizes.has(`db/${meta.id}.ndjson.gz`)) return
      metas.push(meta)
    } catch (error) {
      console.error(`Backup: ${item.name} could not be read`, error.message)
    }
  })
  return metas.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

async function readText(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

export async function backupSettings() {
  return (await BackupSetting.findOneAndUpdate({ key: "org" }, { $setOnInsert: { key: "org" } }, { upsert: true, new: true, setDefaultsOnInsert: true })).toObject()
}

async function pruneBackups() {
  const settings = await backupSettings()
  const keepDays = KEEP_CHOICES.includes(settings.keepDays) ? settings.keepDays : 30
  const cutoff = Date.now() - keepDays * 86400000
  const metas = await listBackups()
  const kept = metas.filter((meta, index) => index < ALWAYS_KEEP || new Date(meta.createdAt).getTime() >= cutoff)
  const old = metas.filter((meta) => !kept.includes(meta))
  const place = store()
  for (const meta of old) {
    await place.remove(`db/${meta.id}.json`)
    await place.remove(`db/${meta.id}.ndjson.gz`)
  }
  const oldest = kept.length ? new Date(kept[kept.length - 1].createdAt) : null
  await pruneFileCopies(oldest)
}

// ---- Reading and restoring ----

function documentsCollection() {
  return DocumentFile.collection.collectionName
}

// Where an uploaded file is kept, relative to the uploads folder or the S3 bucket: never absolute, never "..".
function safeStoragePath(value) {
  if (value == null) return true
  const text = String(value)
  return Boolean(text) && !text.startsWith("/") && !text.includes("\\") && !text.split("/").some((part) => part === ".." || part === ".")
}

// Reads a backup file from start to end, checking it as it goes. `onRecord(collection, record)` gets every record in
// order; without it the file is only checked.
async function readBackup(file, onRecord = null) {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip())
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  let header = null
  let trailer = null
  let current = ""
  const done = new Set()
  const counts = {}
  let number = 0
  try {
    for await (const line of lines) {
      number += 1
      if (!line.trim()) continue
      if (trailer) throw new Error("The backup file has data after its end.")
      if (!header) {
        let parsed = null
        try {
          parsed = JSON.parse(line)
        } catch {}
        if (parsed?.format !== FORMAT) throw new Error("This is not a SynergiFund backup file.")
        if (!(parsed.version >= 1 && parsed.version <= VERSION)) throw new Error("This backup was made by a newer version of SynergiFund.")
        if (!Array.isArray(parsed.collections) || parsed.collections.some((name) => typeof name !== "string" || !NAME_PATTERN.test(name) || name.startsWith("system."))) throw new Error("The backup file's list of collections is damaged.")
        header = parsed
        for (const name of header.collections) counts[name] = 0
        continue
      }
      let entry
      try {
        entry = EJSON.parse(line, { relaxed: false })
      } catch {
        throw new Error(`Line ${number} of the backup file is damaged.`)
      }
      if (entry?.end === true) {
        trailer = entry
        continue
      }
      const name = entry?.c
      if (typeof name !== "string" || !(name in counts) || !entry.d || typeof entry.d !== "object" || entry.d._id == null) throw new Error(`Line ${number} of the backup file is damaged.`)
      if (name !== current) {
        if (done.has(name)) throw new Error(`Line ${number} of the backup file is out of order.`)
        if (current) done.add(current)
        current = name
      }
      if (name === documentsCollection() && !safeStoragePath(entry.d.storagePath)) throw new Error(`Line ${number} of the backup file has a file location that is not allowed.`)
      counts[name] += 1
      if (onRecord) await onRecord(name, entry.d)
    }
  } catch (error) {
    if (/incorrect header check/i.test(error.message)) throw new Error("This is not a SynergiFund backup file. Use a .ndjson.gz file downloaded from Settings › Backups.")
    if (error.code === "Z_DATA_ERROR" || error.code === "Z_BUF_ERROR" || /unexpected end of file/i.test(error.message)) throw new Error("The backup file is damaged or incomplete.")
    throw error
  }
  if (!header) throw new Error("The backup file is empty.")
  if (!trailer) throw new Error("The backup file is incomplete (it has no end). It may have been cut off while downloading.")
  for (const name of header.collections) {
    if (Number(trailer.counts?.[name] ?? 0) !== counts[name]) throw new Error(`The backup file is incomplete: ${name} should have ${trailer.counts?.[name]} records and has ${counts[name]}.`)
  }
  return { header, counts }
}

// Replaces the data with the backup's: every collection in it is emptied and filled from it, and any other
// collection (made after the backup) is emptied. The backup bookkeeping is left alone.
async function applyBackup(file, step) {
  const db = mongoose.connection.db
  const own = ownCollections()
  let current = ""
  let batch = []
  const flush = async () => {
    if (!batch.length) return
    const docs = batch
    batch = []
    await db.collection(current).insertMany(docs, { ordered: true })
  }
  const cleared = new Set()
  let written = 0
  const { header } = await readBackup(file, async (name, doc) => {
    if (own.has(name)) return
    if (name !== current) {
      await flush()
      current = name
      step(`Restoring ${name}`)
      await db.collection(name).deleteMany({})
      cleared.add(name)
    }
    batch.push(doc)
    written += 1
    if (batch.length >= BATCH) await flush()
  })
  await flush()
  const infos = await db.listCollections({}, { nameOnly: false }).toArray()
  for (const info of infos) {
    const name = info.name
    // In the backup with no records, or made after it: emptied.
    if ((info.type || "collection") !== "collection" || cleared.has(name) || !usableName(name)) continue
    await db.collection(name).deleteMany({})
  }
  // Indexes the app expects (a collection the backup brought back may be new).
  for (const model of Object.values(mongoose.models)) await model.createIndexes().catch((error) => console.error(`Restore: index for ${model.modelName}`, error.message))
  return { written, collections: header.collections.length }
}

async function restoreFiles(step) {
  const docs = await DocumentFile.find({ storagePath: { $nin: [null, ""] } }).select("storage storagePath").lean()
  const counts = { checked: docs.length, restored: 0, missing: 0 }
  let seen = 0
  await eachLimit(docs, COPY_PARALLEL, async (doc) => {
    seen += 1
    if (seen % 200 === 0) step(`Checking files (${seen} of ${docs.length})`)
    const file = { storage: doc.storage || "local", storagePath: doc.storagePath }
    if (await liveFileExists(file)) return
    const result = await copyBack(file)
    if (result === "restored") counts.restored += 1
    else if (result === "missing") counts.missing += 1
  })
  // The restored records decide which copies are still needed.
  await syncFileCopies().catch((error) => console.error("Backup: noting file copies after a restore failed", error))
  return counts
}

async function download(id, target) {
  await pipeline(await store().open(`db/${id}.ndjson.gz`), fs.createWriteStream(target))
}

async function restoreFrom(file, { by, label, step }) {
  step("Checking the backup")
  const checked = await readBackup(file)
  // From here nobody can change anything (see index.js), so the backup made just before has every last change.
  restoring = true
  let safety = null
  try {
    step("Backing up the current data first")
    safety = await makeBackup({ kind: "before-restore", by, keepLocal: true, step: (text) => step(`Backing up the current data first: ${text.toLowerCase()}`) })
    let applied
    try {
      applied = await applyBackup(file, step)
    } catch (error) {
      console.error("Restore failed, putting the data back", error)
      step("The restore failed. Putting the data back as it was")
      try {
        await applyBackup(safety.file, step)
      } catch (undoError) {
        console.error("Restore: putting the data back failed too", undoError)
        throw new Error(`The restore failed (${error.message}) and putting the data back also failed (${undoError.message}). Restore the "Before a restore" backup from ${new Date(safety.meta.createdAt).toLocaleString("en-US")} to get back the data from just before.`)
      }
      throw new Error(`The restore failed and nothing was changed: ${error.message}`)
    }
    step("Bringing back documents and photos")
    const files = await restoreFiles(step)
    return { label, backupCreatedAt: checked.header.createdAt || null, records: applied.written, collections: applied.collections, counts: checked.counts, files, safetyId: safety.meta.id }
  } finally {
    restoring = false
    await removeTemp(safety?.file)
  }
}

// ---- Jobs (one at a time) ----

export function restoreRunning() {
  return restoring
}

export function backupJob() {
  return job || lastJob
}

function startJob(type, by, work) {
  if (job) {
    const error = new Error(job.type === "restore" ? "A restore is running. Wait for it to finish." : "A backup is running. Wait for it to finish.")
    error.status = 409
    throw error
  }
  const current = { id: crypto.randomBytes(6).toString("hex"), type, status: "running", step: "Starting", by, startedAt: new Date().toISOString(), finishedAt: null, error: "", result: null }
  job = current
  const step = (text) => {
    current.step = text
  }
  const run = (async () => {
    try {
      current.result = await work(step)
      current.status = "done"
      current.step = "Done"
    } catch (error) {
      console.error(`Backup job (${type}) failed`, error)
      current.status = "failed"
      current.error = error.message || "Something went wrong."
    } finally {
      current.finishedAt = new Date().toISOString()
      lastJob = current
      job = null
    }
  })()
  current.done = run
  return current
}

export function startBackup({ kind = "manual", by = "" } = {}) {
  return startJob("backup", by, async (step) => (await makeBackup({ kind, by, step })).meta)
}

export async function findBackup(id) {
  if (!ID_PATTERN.test(String(id || ""))) return null
  return (await listBackups()).find((meta) => meta.id === id) || null
}

// Restores a stored backup (after checking the file is the one that was saved).
export function startRestore({ id, by, onDone }) {
  return startJob("restore", by, async (step) => {
    const meta = await findBackup(id)
    if (!meta) throw new Error("That backup is no longer available.")
    const file = tempFile("restore")
    try {
      step("Fetching the backup")
      await download(id, file)
      if (meta.sha256 && (await sha256(file)) !== meta.sha256) throw new Error("The stored backup file does not match what was saved. It was not restored.")
      const result = await restoreFrom(file, { by, label: describe(meta), step })
      await onDone?.(result)
      return result
    } finally {
      await removeTemp(file)
    }
  })
}

// Restores a backup file someone uploaded (one they downloaded earlier). The file is removed afterwards.
export function startRestoreUpload({ file, name, by, onDone }) {
  return startJob("restore", by, async (step) => {
    try {
      const result = await restoreFrom(file, { by, label: `the uploaded file ${name || "backup"}`, step })
      await onDone?.(result)
      return result
    } finally {
      await removeTemp(file)
    }
  })
}

// Checks an uploaded file before anything else happens, so a wrong file is turned away at once.
export async function checkBackupFile(file) {
  const { header, counts } = await readBackup(file)
  return { createdAt: header.createdAt, documents: Object.values(counts).reduce((total, count) => total + count, 0) }
}

export function describe(meta) {
  const when = new Date(meta.createdAt)
  return `the ${String(KIND_LABELS[meta.kind] || "").toLowerCase() || "saved"} backup from ${when.toLocaleString("en-US", { timeZone: teamTimezone(), dateStyle: "medium", timeStyle: "short" })}`
}

export async function openBackup(id) {
  return store().open(`db/${id}.ndjson.gz`)
}

export function storageLabel() {
  const place = store()
  return { kind: place.kind, label: place.label }
}

// ---- The daily backup ----

// Every few minutes: once the team's clock passes the chosen hour, today's backup is made (once, even with more than
// one server). A failure is tried again an hour later.
async function dailyTick() {
  if (job || Date.now() < retryAfter || mongoose.connection.readyState !== 1) return
  const settings = await backupSettings()
  if (!settings.daily) return
  const today = teamToday()
  if (settings.lastAutoDay === today || teamHour() < settings.hour) return
  const claimed = await BackupSetting.findOneAndUpdate({ key: "org", lastAutoDay: settings.lastAutoDay ?? null }, { $set: { lastAutoDay: today } }, { new: true })
  if (!claimed) return
  let started
  try {
    started = startBackup({ kind: "daily", by: "Daily backup" })
  } catch {
    await BackupSetting.updateOne({ key: "org", lastAutoDay: today }, { $set: { lastAutoDay: settings.lastAutoDay ?? null } })
    return
  }
  await started.done
  if (started.status === "failed") {
    retryAfter = Date.now() + 60 * 60 * 1000
    await BackupSetting.updateOne({ key: "org", lastAutoDay: today }, { $set: { lastAutoDay: settings.lastAutoDay ?? null } })
  }
}

export function startBackupSchedule({ everyMs = 5 * 60 * 1000 } = {}) {
  if (scheduleTimer) return
  const tick = () => dailyTick().catch((error) => console.error("Daily backup check failed", error))
  scheduleTimer = setInterval(tick, everyMs)
  scheduleTimer.unref?.()
  setTimeout(tick, 15000).unref?.()
}

export function stopBackupSchedule() {
  clearInterval(scheduleTimer)
  scheduleTimer = null
}

export { dailyTick as runDailyCheck }
