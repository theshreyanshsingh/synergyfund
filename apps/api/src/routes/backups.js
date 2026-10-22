import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Router } from "express"
import bcrypt from "bcryptjs"
import multer from "multer"
import { asyncHandler, sendError } from "../lib/http.js"
import { BackupSetting } from "../models/index.js"
import { recordActivity } from "../services/notify.js"
import { DOCUMENT_LIMIT_MB } from "../services/files.js"
import { teamTimezone } from "../lib/dates.js"
import {
  KEEP_CHOICES,
  backupJob,
  backupSettings,
  checkBackupFile,
  findBackup,
  listBackups,
  openBackup,
  startBackup,
  startRestore,
  startRestoreUpload,
  storageLabel,
} from "../services/backup.js"

export const backupsRouter = Router()

// Backups hold everything, password hashes included: admins only.
backupsRouter.use((req, res, next) => {
  if (req.user?.role !== "admin") {
    sendError(res, 403, "Only an admin can see and restore backups.")
    return
  }
  next()
})

// A backup file to restore is kept on disk while it is checked and restored, not in memory.
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, done) => done(null, `synergifund-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson.gz`),
  }),
  limits: { fileSize: DOCUMENT_LIMIT_MB * 1024 * 1024, files: 1 },
})

function presentJob(job) {
  if (!job) return null
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    step: job.step,
    by: job.by,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    result: job.type === "restore" && job.result ? { label: job.result.label, backupCreatedAt: job.result.backupCreatedAt, records: job.result.records, files: job.result.files, safetyId: job.result.safetyId } : job.result ? { id: job.result.id, size: job.result.size, documents: job.result.documents, files: job.result.files } : null,
  }
}

function presentSettings(settings) {
  return {
    daily: settings.daily !== false,
    hour: Number.isInteger(settings.hour) ? settings.hour : 2,
    keepDays: KEEP_CHOICES.includes(settings.keepDays) ? settings.keepDays : 30,
    lastAutoDay: settings.lastAutoDay || "",
    timezone: teamTimezone(),
    keepChoices: KEEP_CHOICES,
  }
}

async function passwordMatches(req) {
  const password = String(req.body?.password || "")
  return Boolean(password) && bcrypt.compare(password, req.user.passwordHash)
}

function restoredActivity(req) {
  return async (result) => {
    await recordActivity({ user: req.user, title: "Backup restored", detail: `Restored ${result.label}` }).catch((error) => console.error("Restore activity failed", error))
  }
}

backupsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const [settings, backups] = await Promise.all([backupSettings(), listBackups()])
    res.json({ settings: presentSettings(settings), backups, job: presentJob(backupJob()), storage: storageLabel() })
  }),
)

backupsRouter.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const update = {}
    if ("daily" in req.body) update.daily = req.body.daily === true
    if ("hour" in req.body) {
      const hour = Number(req.body.hour)
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return sendError(res, 400, "Choose an hour of the day.")
      update.hour = hour
    }
    if ("keepDays" in req.body) {
      const days = Number(req.body.keepDays)
      if (!KEEP_CHOICES.includes(days)) return sendError(res, 400, `Keep backups for ${KEEP_CHOICES.join(", ")} days.`)
      update.keepDays = days
    }
    const before = await backupSettings()
    const saved = await BackupSetting.findOneAndUpdate({ key: "org" }, { $set: { ...update, updatedBy: req.user.email } }, { new: true, upsert: true, setDefaultsOnInsert: true })
    const changes = [
      "daily" in update && update.daily !== (before.daily !== false) ? (update.daily ? "Daily backups on" : "Daily backups off") : "",
      "hour" in update && update.hour !== before.hour ? `Backup time ${hourLabel(update.hour)}` : "",
      "keepDays" in update && update.keepDays !== before.keepDays ? `Keep ${update.keepDays} days` : "",
    ].filter(Boolean)
    if (changes.length) await recordActivity({ user: req.user, title: "Backup settings changed", detail: changes.join(" · ") })
    res.json({ settings: presentSettings(saved.toObject()) })
  }),
)

backupsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    try {
      const job = startBackup({ kind: "manual", by: req.user.name })
      await recordActivity({ user: req.user, title: "Backup started", detail: "Back up now" })
      res.status(202).json({ job: presentJob(job) })
    } catch (error) {
      sendError(res, error.status || 500, error.message)
    }
  }),
)

backupsRouter.get(
  "/:id/download",
  asyncHandler(async (req, res) => {
    const meta = await findBackup(req.params.id)
    if (!meta) return sendError(res, 404, "That backup is no longer available.")
    const stream = await openBackup(meta.id)
    res.setHeader("Content-Type", "application/gzip")
    res.setHeader("Content-Disposition", `attachment; filename="synergifund-backup-${meta.id}.ndjson.gz"`)
    res.setHeader("X-Content-Type-Options", "nosniff")
    if (meta.size) res.setHeader("Content-Length", String(meta.size))
    stream.on("error", () => {
      if (!res.headersSent) sendError(res, 404, "That backup could not be read.")
      else res.destroy()
    })
    stream.pipe(res)
  }),
)

backupsRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    if (!(await passwordMatches(req))) return sendError(res, 400, "That password is not right. Enter your own password to restore.")
    const meta = await findBackup(req.params.id)
    if (!meta) return sendError(res, 404, "That backup is no longer available.")
    try {
      const job = startRestore({ id: meta.id, by: req.user.name, onDone: restoredActivity(req) })
      res.status(202).json({ job: presentJob(job) })
    } catch (error) {
      sendError(res, error.status || 500, error.message)
    }
  }),
)

backupsRouter.post(
  "/restore-file",
  (req, res, next) => {
    restoreUpload.single("file")(req, res, (error) => {
      if (!error) return next()
      const tooBig = error.code === "LIMIT_FILE_SIZE"
      sendError(res, tooBig ? 413 : 400, tooBig ? `That file is larger than ${DOCUMENT_LIMIT_MB} MB. Restore it from the list instead.` : "The upload could not be read.")
    })
  },
  asyncHandler(async (req, res) => {
    const file = req.file?.path
    const drop = () => (file ? fs.promises.unlink(file).catch(() => {}) : null)
    if (!file) return sendError(res, 400, "Choose a backup file.")
    if (!(await passwordMatches(req))) {
      await drop()
      return sendError(res, 400, "That password is not right. Enter your own password to restore.")
    }
    try {
      await checkBackupFile(file)
    } catch (error) {
      await drop()
      return sendError(res, 400, error.message)
    }
    try {
      const job = startRestoreUpload({ file, name: path.basename(req.file.originalname || "backup"), by: req.user.name, onDone: restoredActivity(req) })
      res.status(202).json({ job: presentJob(job) })
    } catch (error) {
      await drop()
      sendError(res, error.status || 500, error.message)
    }
  }),
)

function hourLabel(hour) {
  const suffix = hour < 12 ? "AM" : "PM"
  return `${hour % 12 || 12}:00 ${suffix}`
}
