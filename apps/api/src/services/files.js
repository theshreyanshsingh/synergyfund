import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import multer from "multer"

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

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

export async function saveUploadedFile(file, user, extra = {}) {
  const config = storageConfig()
  if (config.partial) {
    throw new Error("S3 storage is incomplete. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY together.")
  }
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

export async function sendStoredFile(res, file, { download = false } = {}) {
  res.setHeader("Content-Type", file.mime || "application/octet-stream")
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${safeHeaderName(file.name)}"`)
  const stream = await openStoredStream(file)
  stream.on("error", () => {
    if (!res.headersSent) res.status(404).end()
  })
  stream.pipe(res)
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

async function openStoredStream(file) {
  if (file.storage !== "s3") return fs.createReadStream(uploadsPath(file.storagePath))
  const config = storageConfig()
  const response = await s3().send(new GetObjectCommand({ Bucket: config.bucket, Key: file.storagePath }))
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

function safeHeaderName(name) {
  return String(name || "file").replace(/["\r\n]/g, "")
}
