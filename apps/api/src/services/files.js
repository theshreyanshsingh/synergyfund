import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import multer from "multer"
import { sendError } from "../lib/http.js"
import { HEADER_PROBE, currentKeyId, decryptBytes, decryptStream, encryptBytes, encryptionOn, fieldKeys, fileNeedsSealing, plainSizeOf, readFileHeader, sealedRange } from "../lib/crypto.js"

// UPLOADS_DIR moves the folder (the tests use a scratch one).
const uploadDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(path.dirname(fileURLToPath(import.meta.url)), "../../uploads")
fs.mkdirSync(uploadDir, { recursive: true })

let s3Client

export function uploadsPath(...parts) {
  return path.join(uploadDir, ...parts)
}

export function storageConfig() {
  const region = clean(process.env.AWS_REGION)
  const bucket = clean(process.env.AWS_S3_BUCKET)
  const accessKeyId = clean(process.env.AWS_ACCESS_KEY_ID)
  const secretAccessKey = clean(process.env.AWS_SECRET_ACCESS_KEY)
  const prefix = clean(process.env.AWS_S3_PREFIX) || "synergifund"
  const provided = [region, bucket, accessKeyId, secretAccessKey].filter(Boolean)
  return {
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: prefix.replace(/^\/+|\/+$/g, ""),
    // Another S3-compatible store (the tests use a local one). Amazon S3 itself needs none.
    endpoint: clean(process.env.AWS_S3_ENDPOINT),
    enabled: provided.length === 4,
    partial: provided.length > 0 && provided.length < 4,
  }
}

// Browsers send file names as UTF-8; without this, "año.pdf" would be saved as "aÃ±o.pdf".
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  defParamCharset: "utf8",
})

// Documents can be bigger than other uploads: scanned PDFs and property videos. Cloudflare stops uploads at 100 MB.
export const DOCUMENT_LIMIT_MB = 95
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_LIMIT_MB * 1024 * 1024 },
  defParamCharset: "utf8",
})

export function receiveDocument(field) {
  return (req, res, next) => {
    documentUpload.single(field)(req, res, (error) => {
      if (!error) {
        next()
        return
      }
      const tooBig = error.code === "LIMIT_FILE_SIZE"
      sendError(res, tooBig ? 413 : 400, tooBig ? `That file is larger than ${DOCUMENT_LIMIT_MB} MB.` : "The upload could not be read.")
    })
  }
}

export function receiveFile(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (error) => {
      if (!error) {
        next()
        return
      }
      const tooBig = error.code === "LIMIT_FILE_SIZE"
      sendError(res, 400, tooBig ? "That file is larger than 20 MB. Split the workbook and try again." : "The upload could not be read.")
    })
  }
}

// Files are encrypted before they leave this server (when FIELD_ENCRYPTION_KEYS is set), so the bucket or disk only
// holds ciphertext. They reach people only through the signed-in routes, which decrypt them (sendStoredFile).
export async function saveUploadedFile(file, user, extra = {}) {
  const config = storageConfig()
  const safeName = (file.originalname || "upload").replace(/[^\w.\- ]+/g, "") || "upload"
  const { DocumentFile } = await import("../models/index.js")
  let storage = "local"
  let storagePath = `${Date.now()}-${safeName}`
  if (config.enabled) {
    storage = "s3"
    storagePath = `${config.prefix}/${new Date().toISOString().slice(0, 10)}/${storagePath}`
  }
  const keyId = encryptionOn() ? currentKeyId() : ""
  const body = keyId ? encryptBytes(file.buffer, fileContext(storagePath)) : file.buffer
  await writeObject(storedPlace({ storage, storagePath }), body, keyId ? "" : file.mimetype)
  return DocumentFile.create({
    name: file.originalname || safeName,
    mime: file.mimetype,
    size: file.size,
    storage,
    storagePath,
    uploadedBy: user._id,
    versionGroup: extra.versionGroup || storagePath,
    ...(keyId ? { fileKeyId: keyId } : {}),
    ...extra,
  })
}

// A copy of the file on this server's disk, for libraries that read a path (Word and Excel previews, imports).
export async function materializeStoredFile(file) {
  const source = await openStored(file)
  if (file.storage !== "s3" && !source.encrypted) return { path: uploadsPath(file.storagePath), cleanup: async () => {} }
  const temp = path.join(os.tmpdir(), `synergifund-${Date.now()}-${path.basename(file.storagePath)}`)
  await pipeline(await source.stream(), fs.createWriteStream(temp))
  return { path: temp, cleanup: () => fs.promises.unlink(temp).catch(() => {}) }
}

const SAFE_INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/heic", "application/pdf", "text/plain", "video/mp4", "video/quicktime", "video/webm", "video/x-m4v"])

// Byte ranges let videos play and skip ahead (iPhones and Safari will not play a video without them).
function readRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim())
  if (!match || !size || (!match[1] && !match[2])) return null
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  let end = match[1] && match[2] ? Number(match[2]) : size - 1
  end = Math.min(end, size - 1)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { invalid: true }
  return { start, end }
}

// Some browsers send no type, or a generic one, for PDFs, photos and videos; the name tells what they are.
const TYPE_BY_NAME = [
  [/\.pdf$/i, "application/pdf"],
  [/\.jpe?g$/i, "image/jpeg"],
  [/\.png$/i, "image/png"],
  [/\.gif$/i, "image/gif"],
  [/\.webp$/i, "image/webp"],
  [/\.heic$/i, "image/heic"],
  [/\.mp4$/i, "video/mp4"],
  [/\.m4v$/i, "video/x-m4v"],
  [/\.mov$/i, "video/quicktime"],
  [/\.webm$/i, "video/webm"],
]

function storedType(file) {
  const mime = String(file.mime || "").toLowerCase().split(";")[0].trim()
  if (mime && mime !== "application/octet-stream") return mime
  return TYPE_BY_NAME.find(([pattern]) => pattern.test(file.name || ""))?.[1] || mime
}

// `name`: download it under another name (an export named as asked); the stored file keeps its own.
export async function sendStoredFile(res, file, { download = false, range = "", name = "" } = {}) {
  let source
  try {
    source = await openStored(file)
  } catch (error) {
    if (!notFound(error)) throw error
    sendError(res, 404, "That file is missing from storage.")
    return
  }
  const mime = storedType(file)
  const inline = !download && SAFE_INLINE.has(mime)
  const size = source.size
  res.setHeader("Content-Type", inline ? mime : "application/octet-stream")
  const shownName = name || file.name
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeHeaderName(shownName)}"; filename*=UTF-8''${headerNameUtf8(shownName || "file")}`)
  res.setHeader("X-Content-Type-Options", "nosniff")
  // A stored file never changes (a new version is a new file), so the browser may keep its own copy for a day.
  res.setHeader("Cache-Control", "private, max-age=86400")
  if (mime !== "application/pdf") res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
  if (size) res.setHeader("Accept-Ranges", "bytes")
  const part = inline && range ? readRange(range, size) : null
  if (part?.invalid) {
    res.setHeader("Content-Range", `bytes */${size}`)
    res.status(416).end()
    return
  }
  if (part) {
    res.status(206)
    res.setHeader("Content-Range", `bytes ${part.start}-${part.end}/${size}`)
    res.setHeader("Content-Length", String(part.end - part.start + 1))
  } else {
    res.setHeader("Content-Length", String(size))
  }
  const stream = await source.stream(part)
  // A file that fails to decrypt (changed in storage, or a missing key) stops the response. Before anything was sent,
  // the file's headers are taken back so the error goes out as an error.
  stream.on("error", (error) => {
    console.error(`File ${file._id} could not be read`, error.message)
    if (res.headersSent) {
      res.destroy()
      return
    }
    for (const name of ["Content-Length", "Content-Range", "Content-Disposition", "Accept-Ranges", "Cache-Control"]) res.removeHeader(name)
    sendError(res, 500, "That file could not be read.")
  })
  stream.pipe(res)
}

// The whole file in memory, for building a zip of several files.
export async function readStoredFile(file) {
  const source = await openStored(file)
  const chunks = []
  for await (const chunk of await source.stream()) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export async function deleteStoredFile(file) {
  if (file.storage === "s3") {
    const config = storageConfig()
    if (!config.enabled) return
    await s3().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: file.storagePath }))
    return
  }
  await fs.promises.unlink(uploadsPath(file.storagePath)).catch(() => {})
}

// ---- Stored bytes ----

// Bound into every file's encryption: a file moved to another place in storage will not open there. A file's backup
// copy is the same file, so it keeps its context.
export function fileContext(storagePath) {
  return `file:${storagePath}`
}

// Where a file's bytes are: an S3 key, or a path on this server's disk.
export function storedPlace(file) {
  return file.storage === "s3" ? { s3: true, key: file.storagePath } : { s3: false, path: uploadsPath(file.storagePath) }
}

function notFound(error) {
  return error?.code === "ENOENT" || error?.name === "NoSuchKey" || error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404
}

function s3Config() {
  const config = storageConfig()
  if (!config.enabled) throw new Error("This file is in Amazon S3, which is not set up on this server.")
  return config
}

function bodyStream(body) {
  return body instanceof Readable ? body : Readable.fromWeb(body)
}

// The first bytes of a stored object (enough for an encryption header) and its stored size.
async function probeObject(place) {
  if (!place.s3) {
    const handle = await fs.promises.open(place.path, "r")
    try {
      const { size } = await handle.stat()
      const head = Buffer.alloc(Math.min(size, HEADER_PROBE))
      if (head.length) await handle.read(head, 0, head.length, 0)
      return { head, size }
    } finally {
      await handle.close()
    }
  }
  const config = s3Config()
  let response
  try {
    response = await s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: place.key, Range: `bytes=0-${HEADER_PROBE - 1}` }))
  } catch (error) {
    // An empty object has no byte 0 to start a range at.
    if (error?.name === "InvalidRange" || error?.$metadata?.httpStatusCode === 416) return { head: Buffer.alloc(0), size: 0 }
    throw error
  }
  const head = Buffer.from(await response.Body.transformToByteArray())
  const total = /\/(\d+)$/.exec(String(response.ContentRange || ""))
  return { head, size: total ? Number(total[1]) : Number(response.ContentLength ?? head.length) }
}

// Stored bytes `start` to `end` (inclusive), or all of them.
async function readObjectRange(place, start = null, end = null) {
  if (!place.s3) return fs.createReadStream(place.path, start == null ? undefined : { start, end })
  const config = s3Config()
  const response = await s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: place.key, ...(start == null ? {} : { Range: `bytes=${start}-${end}` }) }))
  return bodyStream(response.Body)
}

async function readObject(place) {
  if (!place.s3) return fs.promises.readFile(place.path)
  const config = s3Config()
  const response = await s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: place.key }))
  return Buffer.from(await response.Body.transformToByteArray())
}

// On disk the new bytes are written beside the file and then moved over it, so a failed write never leaves half a file.
async function writeObject(place, body, contentType = "") {
  if (place.s3) {
    const config = s3Config()
    await s3().send(new PutObjectCommand({ Bucket: config.bucket, Key: place.key, Body: body, ContentType: contentType || "application/octet-stream" }))
    return
  }
  await fs.promises.mkdir(path.dirname(place.path), { recursive: true })
  const temp = `${place.path}.${process.pid}-${Date.now()}.tmp`
  try {
    await fs.promises.writeFile(temp, body)
    await fs.promises.rename(temp, place.path)
  } catch (error) {
    await fs.promises.unlink(temp).catch(() => {})
    throw error
  }
}

// A stored file ready to read: its size, and any part of it, decrypted. Files stored before encryption read as they are.
async function openStored(file) {
  const place = storedPlace(file)
  const { head, size: storedSize } = await probeObject(place)
  const header = readFileHeader(head)
  if (!header) return { encrypted: false, size: storedSize, stream: async (part) => readObjectRange(place, part?.start, part?.end) }
  const size = plainSizeOf(header, storedSize)
  const context = fileContext(file.storagePath)
  return {
    encrypted: true,
    size,
    async stream(part) {
      const start = part ? part.start : 0
      const end = part ? part.end : size - 1
      const range = sealedRange(header, storedSize, start, end)
      return decryptStream(await readObjectRange(place, range.start, range.end), { header, storedSize, start, end, context })
    },
  }
}

// Encrypts a stored object saved before encryption, or moves it to the current key. Says whether it had to, and the key
// it is under now. The new bytes are checked before they replace the old ones.
export async function resealObject(place, context) {
  const keys = fieldKeys()
  const stored = await readObject(place)
  if (!fileNeedsSealing(stored, keys)) return { changed: false, keyId: keys[0].id }
  const plain = decryptBytes(stored, context, keys)
  const sealed = encryptBytes(plain, context, keys)
  if (!decryptBytes(sealed, context, keys).equals(plain)) throw new Error("Could not verify the encrypted copy.")
  await writeObject(place, sealed)
  return { changed: true, keyId: keys[0].id }
}

export function resealStoredFile(file) {
  return resealObject(storedPlace(file), fileContext(file.storagePath))
}

// The S3 client, for backups (see backup.js). Only when all four AWS values are set.
export function storageClient() {
  return s3()
}

function s3() {
  const config = storageConfig()
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }
  return s3Client
}

function clean(value) {
  return String(value || "").trim()
}

// filename* allows no apostrophes or brackets (browsers drop it and fall back to the plain name): escape them too.
export function headerNameUtf8(name) {
  return encodeURIComponent(String(name)).replace(/['()*!]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

// The plain filename in the header must be Latin-1; the full name travels in filename* as UTF-8.
function safeHeaderName(name) {
  return String(name || "file").replace(/["\r\n\\]/g, "").replace(/[^\x20-\x7e]/g, "_")
}
