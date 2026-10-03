import fs from "node:fs"
import path from "node:path"
import { Router } from "express"
import mammoth from "mammoth"
import xlsx from "xlsx"
import { DocumentFile, ImportJob, Property, Task } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { propertyFilter } from "../services/access.js"
import { saveUploadedFile, upload, uploadsPath } from "../services/files.js"
import { recordActivity } from "../services/notify.js"

export const documentsRouter = Router()

function present(file) {
  return {
    id: String(file._id),
    name: file.name,
    mime: file.mime || "",
    size: file.size || 0,
    propertyId: file.propertyId ? String(file.propertyId) : "",
    kind: file.kind,
    version: file.version,
    createdAt: file.createdAt,
  }
}

documentsRouter.get(
  "/",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const filter = {}
    if (req.user.role === "contractor") {
      const properties = await Property.find(propertyFilter(req.user)).select("_id")
      filter.propertyId = { $in: properties.map((property) => property._id) }
    }
    if (req.query.q) filter.name = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    const items = await DocumentFile.find(filter).sort({ createdAt: -1 })
    res.json({ items: items.map(present) })
  }),
)

documentsRouter.post(
  "/",
  requirePermission("documents.write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      sendError(res, 400, "Choose a file to upload.")
      return
    }
    const file = await saveUploadedFile(req.file, req.user, {
      propertyId: req.body.propertyId || undefined,
      kind: req.body.kind || "file",
    })
    await recordActivity({ user: req.user, title: "File uploaded", detail: file.name, propertyId: file.propertyId })
    res.status(201).json({ file: present(file) })
  }),
)

documentsRouter.get(
  "/:id/download",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const file = await DocumentFile.findById(req.params.id)
    if (!file) {
      sendError(res, 404, "That file is not available.")
      return
    }
    res.download(uploadsPath(file.storagePath), file.name)
  }),
)

documentsRouter.get(
  "/:id/preview",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const file = await DocumentFile.findById(req.params.id)
    if (!file) {
      sendError(res, 404, "That file is not available.")
      return
    }
    const fullPath = uploadsPath(file.storagePath)
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      const book = xlsx.readFile(fullPath)
      const sheets = book.SheetNames.map((name) => ({
        name,
        rows: xlsx.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" }).slice(0, 80),
      }))
      res.json({ kind: "sheet", file: present(file), sheets })
      return
    }
    if (lower.endsWith(".docx")) {
      const result = await mammoth.convertToHtml({ path: fullPath })
      res.json({ kind: "document", file: present(file), html: result.value })
      return
    }
    if (file.mime?.startsWith("image/")) {
      res.json({ kind: "image", file: present(file), url: `/api/documents/${file._id}/raw` })
      return
    }
    res.json({ kind: "file", file: present(file) })
  }),
)

documentsRouter.get(
  "/:id/raw",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const file = await DocumentFile.findById(req.params.id)
    if (!file) {
      sendError(res, 404, "That file is not available.")
      return
    }
    res.setHeader("Content-Type", file.mime || "application/octet-stream")
    fs.createReadStream(uploadsPath(file.storagePath)).pipe(res)
  }),
)

documentsRouter.delete(
  "/:id",
  requirePermission("documents.delete"),
  asyncHandler(async (req, res) => {
    const file = await DocumentFile.findById(req.params.id)
    if (!file) {
      sendError(res, 404, "That file is not available.")
      return
    }
    await file.deleteOne()
    await recordActivity({ user: req.user, title: "File removed from the library", detail: file.name, propertyId: file.propertyId })
    res.json({ ok: true })
  }),
)

const HEADER_MAP = [
  ["address", ["address", "property address", "street"]],
  ["city", ["city", "city state zip", "location"]],
  ["stage", ["stage", "status"]],
  ["purchasePrice", ["purchase", "purchase price", "price"]],
  ["arv", ["arv", "after repair value"]],
  ["rehabBudget", ["rehab", "rehab budget", "budget"]],
  ["actualRent", ["rent", "actual rent"]],
]

function pick(row, key) {
  const aliases = HEADER_MAP.find((entry) => entry[0] === key)?.[1] || []
  const found = Object.keys(row).find((header) => aliases.includes(String(header).trim().toLowerCase()))
  return found ? row[found] : undefined
}

documentsRouter.post(
  "/import",
  requirePermission("imports.run"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      sendError(res, 400, "Upload an Excel workbook.")
      return
    }
    const lower = req.file.originalname.toLowerCase()
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      sendError(res, 400, "Import a .xls or .xlsx workbook.")
      return
    }
    const saved = await saveUploadedFile(req.file, req.user, { kind: "import" })
    const book = xlsx.readFile(uploadsPath(saved.storagePath))
    const sheet = book.SheetNames[0]
    const rows = xlsx.utils.sheet_to_json(book.Sheets[sheet], { defval: "" })
    const job = await ImportJob.create({
      fileId: saved._id,
      type: req.body.type || "portfolio",
      sheet,
      rows,
      createdBy: req.user._id,
    })
    res.status(201).json({
      import: { id: String(job._id), sheet, count: rows.length, fileId: String(saved._id) },
      preview: rows.slice(0, 8),
    })
  }),
)

documentsRouter.post(
  "/import/:id/confirm",
  requirePermission("imports.run"),
  asyncHandler(async (req, res) => {
    const job = await ImportJob.findById(req.params.id)
    if (!job || job.status !== "Draft") {
      sendError(res, 404, "That import is not waiting for confirmation.")
      return
    }
    if (job.type === "draws") {
      sendError(res, 400, "Confirm a draw workbook from Draws. This import does not change existing records.")
      return
    }
    const file = await DocumentFile.findById(job.fileId)
    let created = 0
    for (const [index, row] of job.rows.entries()) {
      const address = String(pick(row, "address") || "").trim()
      if (!address) {
        await Task.create({ title: "Import row skipped", notes: "No address in the source row, so no property was created.", labels: ["Verify"], priority: "High" })
        continue
      }
      const existing = await Property.findOne({ address })
      if (existing) {
        await Task.create({ propertyId: existing._id, title: "Import address already on file", notes: `${address} was not overwritten.`, labels: ["Verify"], priority: "High" })
        continue
      }
      const purchase = numberOrEmpty(pick(row, "purchasePrice"))
      const arv = numberOrEmpty(pick(row, "arv"))
      const rehab = numberOrEmpty(pick(row, "rehabBudget"))
      const property = await Property.create({
        address,
        city: String(pick(row, "city") || ""),
        stage: String(pick(row, "stage") || "") || "Under contract",
        purchasePrice: purchase,
        arv,
        rehabBudget: rehab,
        actualRent: numberOrEmpty(pick(row, "actualRent")),
        importSource: { file: file?.name, sheet: job.sheet, row: index + 2 },
        updatedBy: req.user.name,
      })
      if (purchase == null) await Task.create({ propertyId: property._id, title: "Purchase price not in source", notes: "Left blank. No price was invented.", labels: ["Verify"], priority: "High" })
      if (arv == null) await Task.create({ propertyId: property._id, title: "ARV not in source", notes: "Left blank. No value was invented.", labels: ["Verify"], priority: "High" })
      created += 1
    }
    job.status = "Confirmed"
    await job.save()
    await recordActivity({ user: req.user, title: "Workbook imported", detail: `${created} properties from ${file?.name}` })
    res.json({ created })
  }),
)

function numberOrEmpty(value) {
  if (value === "" || value == null) return undefined
  const number = Number(String(value).replace(/[$,]/g, ""))
  return Number.isFinite(number) ? number : undefined
}
