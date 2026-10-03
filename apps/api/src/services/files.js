import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import multer from "multer"

const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../uploads")
fs.mkdirSync(uploadDir, { recursive: true })

export function uploadsPath(...parts) {
  return path.join(uploadDir, ...parts)
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, callback) => {
    const safe = file.originalname.replace(/[^\w.\- ]+/g, "")
    callback(null, `${Date.now()}-${safe}`)
  },
})

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
})

export async function saveUploadedFile(file, user, extra = {}) {
  const { DocumentFile } = await import("../models/index.js")
  return DocumentFile.create({
    name: file.originalname,
    mime: file.mimetype,
    size: file.size,
    storagePath: file.filename,
    uploadedBy: user._id,
    versionGroup: extra.versionGroup || file.filename,
    ...extra,
  })
}
