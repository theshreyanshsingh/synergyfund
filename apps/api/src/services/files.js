import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import multer from "multer"
import { sendError } from "../lib/http.js"

const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../uploads")
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
    cloudfrontUrl: clean(process.env.AWS_CLOUDFRONT_URL).replace(/\/+$/, ""),
    enabled: provided.length === 4,
    partial: provided.length > 0 && provided.length < 4,
  }
}

export function publicFileUrl(file) {
  const config = storageConfig()
  if (!config.cloudfrontUrl || file?.storage !== "s3") return ""
  const image = file.kind === "photo" || file.kind === "receipt" || String(file.mime || "").startsWith("image/")
  if (!image) return ""
  const key = String(file.storagePath || "").split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/")
  return key ? `${config.cloudfrontUrl}/${key}` : ""
}

export async function withProofUrls(itemOrItems) {
  const list = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems]
  const ids = [...new Set(list.flatMap((item) => item?.proofFileIds || []).map(String).filter(Boolean))]
  const urls = {}
  if (ids.length) {
    const { DocumentFile } = await import("../models/index.js")
    const files = await DocumentFile.find({ _id: { $in: ids } })
    for (const file of files) {
      const url = publicFileUrl(file)
      if (url) urls[String(file._id)] = url
    }
  }
  const next = list.map((item) => {
    const proofUrls = {}
    for (const id of item?.proofFileIds || []) {
      if (urls[id]) proofUrls[id] = urls[id]
    }
    return { ...item, proofUrls }
  })
  return Array.isArray(itemOrItems) ? next : next[0]
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

export async function saveUploadedFile(file, user, extra = {}) {
  const config = storageConfig()
  const safeName = (file.originalname || "upload").replace(/[^\w.\- ]+/g, "") || "upload"
  const { DocumentFile } = await import("../models/index.js")
  let storage = "local"
  let storagePath = `${Date.now()}-${safeName}`
  if (config.enabled) {
    storage = "s3"
    storagePath = `${config.prefix}/${new Date().toISOString().slice(0, 10)}/${storagePath}`
    const image = String(file.mimetype || "").startsWith("image/")
    await s3().send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: storagePath,
      Body: file.buffer,
      ContentType: file.mimetype || "application/octet-stream",
      ...(image ? { CacheControl: "public, max-age=31536000" } : {}),
    }))
  } else {
    await fs.promises.writeFile(uploadsPath(storagePath), file.buffer)
  }
  return DocumentFile.create({
    name: file.originalname || safeName,
    mime: file.mimetype,
    size: file.size,
    storage,
    storagePath,
    uploadedBy: user._id,
    versionGroup: extra.versionGroup || storagePath,
    ...extra,
  })
}

export async function materializeStoredFile(file) {
  if (file.storage !== "s3") return { path: uploadsPath(file.storagePath), cleanup: async () => {} }
  const stream = await openStoredStream(file)
  const temp = path.join(os.tmpdir(), `synergifund-${Date.now()}-${path.basename(file.storagePath)}`)
  await pipeline(stream, fs.createWriteStream(temp))
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

export async function sendStoredFile(res, file, { download = false, range = "" } = {}) {
  const mime = storedType(file)
  const inline = !download && SAFE_INLINE.has(mime)
  const size = Number(file.size) || 0
  res.setHeader("Content-Type", inline ? mime : "application/octet-stream")
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeHeaderName(file.name)}"; filename*=UTF-8''${headerNameUtf8(file.name || "file")}`)
  res.setHeader("X-Content-Type-Options", "nosniff")
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
  } else if (size) {
    res.setHeader("Content-Length", String(size))
  }
  const stream = await openStoredStream(file, part)
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).end()
    else res.destroy()
  })
  stream.pipe(res)
}

// The whole file in memory, for building a zip of several files.
export async function readStoredFile(file) {
  const stream = await openStoredStream(file)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
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

async function openStoredStream(file, part = null) {
  if (file.storage !== "s3") return fs.createReadStream(uploadsPath(file.storagePath), part ? { start: part.start, end: part.end } : undefined)
  const config = storageConfig()
  const response = await s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: file.storagePath, ...(part ? { Range: `bytes=${part.start}-${part.end}` } : {}) }))
  if (response.Body instanceof Readable) return response.Body
  return Readable.fromWeb(response.Body)
}

function s3() {
  const config = storageConfig()
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.region,
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
