import { Router } from "express"
import mammoth from "mammoth"
import xlsx from "xlsx"
import { DocumentFile, ImportJob, Loan, Property, Task } from "../models/index.js"
import { lenderForName } from "../services/lenders.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { propertyFilter } from "../services/access.js"
import { readWorkbook } from "../services/drawImport.js"
import { deleteStoredFile, materializeStoredFile, publicFileUrl, receiveFile, saveUploadedFile, sendStoredFile, upload } from "../services/files.js"
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
    url: publicFileUrl(file),
  }
}

documentsRouter.get(
  "/",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const filter = { kind: { $ne: "chat" } }
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
    if (!file || file.kind === "chat") {
      sendError(res, 404, "That file is not available.")
      return
    }
    await sendStoredFile(res, file, { download: true })
  }),
)

documentsRouter.get(
  "/:id/preview",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const file = await DocumentFile.findById(req.params.id)
    if (!file || file.kind === "chat") {
      sendError(res, 404, "That file is not available.")
      return
    }
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".docx")) {
      const stored = await materializeStoredFile(file)
      try {
        if (lower.endsWith(".docx")) {
          const result = await mammoth.convertToHtml({ path: stored.path })
          res.json({ kind: "document", file: present(file), html: result.value })
          return
        }
        const book = xlsx.readFile(stored.path)
        const sheets = book.SheetNames.map((name) => ({
          name,
          rows: xlsx.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" }).slice(0, 80),
        }))
        res.json({ kind: "sheet", file: present(file), sheets })
      } finally {
        await stored.cleanup()
      }
      return
    }
    if (file.mime?.startsWith("image/")) {
      res.json({ kind: "image", file: present(file), url: publicFileUrl(file) || `/api/documents/${file._id}/raw` })
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
    if (!file || file.kind === "chat") {
      sendError(res, 404, "That file is not available.")
      return
    }
    const direct = publicFileUrl(file)
    if (direct) {
      res.redirect(direct)
      return
    }
    await sendStoredFile(res, file)
  }),
)

documentsRouter.delete(
  "/:id",
  requirePermission("documents.delete"),
  asyncHandler(async (req, res) => {
    const file = await DocumentFile.findById(req.params.id)
    if (!file || file.kind === "chat") {
      sendError(res, 404, "That file is not available.")
      return
    }
    await deleteStoredFile(file)
    await file.deleteOne()
    await recordActivity({ user: req.user, title: "File removed from the library", detail: file.name, propertyId: file.propertyId })
    res.json({ ok: true })
  }),
)

const PROPERTY_FIELDS = [
  ["address", ["address", "property address", "street", "property"], "text"],
  ["city", ["city", "location"], "text"],
  ["stage", ["stage", "property status"], "text"],
  ["strategy", ["strategy"], "text"],
  ["purchasePrice", ["purchase price", "purchase", "price"], "number"],
  ["purchaseDate", ["purchase date", "acquisition date", "acquired"], "date"],
  ["arv", ["arv", "after repair value"], "number"],
  ["rehabBudget", ["rehab budget", "rehab"], "number"],
  ["actualRent", ["actual rent", "rent"], "number"],
  ["marketRent", ["market rent"], "number"],
  ["ownerEntity", ["owner entity", "owner"], "text"],
  ["dealSource", ["deal source", "source"], "text"],
  ["nextAction", ["next action", "next step"], "text"],
  ["rentStatus", ["rent status"], "text"],
  ["rentMarket", ["rent market"], "text"],
  ["accessInfo", ["access info", "access"], "text"],
]

const LOAN_FIELDS = [
  ["lender", ["lender"], "text"],
  ["loanNumber", ["loan number", "loan #", "loan no"], "text"],
  ["balance", ["loan balance", "current balance", "balance"], "number"],
  ["payment", ["monthly payment", "mortgage payment", "payment"], "number"],
  ["maturity", ["maturity date", "maturity"], "date"],
  ["originalAmount", ["original loan amount", "original amount", "loan amount"], "number"],
]

const PORTFOLIO_ALIASES = [...PROPERTY_FIELDS, ...LOAN_FIELDS].flatMap((entry) => entry[1])

documentsRouter.post(
  "/import",
  requirePermission("imports.run"),
  receiveFile("file"),
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
    await recordActivity({ user: req.user, title: "Property workbook uploaded", detail: `${saved.name} · waiting for review` })
    const stored = await materializeStoredFile(saved)
    let tables = []
    try {
      tables = readWorkbook(stored.path, PORTFOLIO_ALIASES)
    } catch {
      sendError(res, 400, "That workbook could not be read. Use an .xls or .xlsx file.")
      return
    } finally {
      await stored.cleanup()
    }
    const rows = tables.flatMap((table) => table.rows.map((source) => ({
      sheet: source.sheet,
      row: source.row,
      cells: sanitizeKeys(source.cells),
      mapped: mapPortfolioRow(source.cells),
    })))
    if (!rows.length) {
      sendError(res, 400, "That workbook has no rows to read.")
      return
    }
    const job = await ImportJob.create({
      fileId: saved._id,
      type: req.body.type || "portfolio",
      sheet: tables.map((table) => table.sheet).join(", "),
      headers: [...new Set(tables.flatMap((table) => table.headers))],
      rows: [],
      createdBy: req.user._id,
    })
    res.status(201).json({
      import: { id: String(job._id), sheet: job.sheet, count: rows.length, fileId: String(saved._id) },
      preview: rows.slice(0, 8).map((row) => row.mapped),
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
    const rows = await portfolioRows(file, job)
    let created = 0
    let updated = 0
    let skipped = 0
    for (const source of rows) {
      const mapped = source.mapped || mapPortfolioRow(source.cells || source)
      const address = String(mapped.address || "").trim()
      const sourceRef = { file: file?.name, sheet: source.sheet || job.sheet, row: source.row }
      if (!address) {
        skipped += 1
        if (Object.values(mapped).some((value) => value != null && value !== "")) {
          await Task.create({ title: "Import row skipped", notes: "No address in the source row, so no property was created.", labels: ["Verify"], priority: "High" })
        }
        continue
      }
      let property = await Property.findOne({ address: new RegExp(`^${escapeRegex(address)}$`, "i") })
      let changed = false
      if (!property) {
        property = await Property.create({
          address,
          city: mapped.city || "",
          stage: mapped.stage || "Under contract",
          strategy: mapped.strategy || "",
          purchasePrice: mapped.purchasePrice,
          purchaseDate: mapped.purchaseDate || "",
          arv: mapped.arv,
          rehabBudget: mapped.rehabBudget,
          actualRent: mapped.actualRent,
          marketRent: mapped.marketRent,
          ownerEntity: mapped.ownerEntity || "",
          dealSource: mapped.dealSource || "",
          nextAction: mapped.nextAction || "",
          rentStatus: mapped.rentStatus || "",
          rentMarket: mapped.rentMarket || "",
          accessInfo: mapped.accessInfo || "",
          importSource: sourceRef,
          updatedBy: req.user.name,
        })
        await saveImportedLoan(property, mapped, sourceRef)
        created += 1
      } else {
        if (fillProperty(property, mapped)) {
          property.updatedBy = req.user.name
          if (!property.importSource?.file) property.importSource = sourceRef
          await property.save()
          changed = true
        }
        if (await saveImportedLoan(property, mapped, sourceRef)) changed = true
        if (changed) updated += 1
      }
      if (mapped.purchasePrice == null && columnPresent(source.cells, "purchasePrice")) {
        await Task.create({ propertyId: property._id, title: "Purchase price not in source", notes: "Left blank. No price was invented.", labels: ["Verify"], priority: "High" })
      }
      if (mapped.arv == null && columnPresent(source.cells, "arv")) {
        await Task.create({ propertyId: property._id, title: "ARV not in source", notes: "Left blank. No value was invented.", labels: ["Verify"], priority: "High" })
      }
    }
    job.status = "Confirmed"
    job.counts = { pending: 0, added: created, duplicate: updated, skipped }
    await job.save()
    await recordActivity({ user: req.user, title: "Workbook imported", detail: `${created} new properties, ${updated} updated, from ${file?.name}` })
    res.json({ created, updated, skipped })
  }),
)

async function portfolioRows(file, job) {
  if (!file) return job.rows || []
  const stored = await materializeStoredFile(file)
  try {
    const tables = readWorkbook(stored.path, PORTFOLIO_ALIASES)
    if (!tables.length) return job.rows || []
    return tables.flatMap((table) => table.rows.map((source) => ({
      sheet: source.sheet,
      row: source.row,
      cells: sanitizeKeys(source.cells),
      mapped: mapPortfolioRow(source.cells),
    })))
  } finally {
    await stored.cleanup()
  }
}

function mapPortfolioRow(cells = {}) {
  return Object.fromEntries([...PROPERTY_FIELDS, ...LOAN_FIELDS].map(([key, , kind]) => [key, readCell(cells, key, kind)]))
}

function readCell(cells, key, kind) {
  const fields = key in Object.fromEntries(LOAN_FIELDS) ? LOAN_FIELDS : PROPERTY_FIELDS
  const aliases = fields.find((entry) => entry[0] === key)?.[1] || []
  const header = Object.keys(cells).find((item) => aliases.includes(String(item).trim().toLowerCase()))
  if (!header) return undefined
  const value = cells[header]
  if (kind === "number") return numberOrEmpty(value)
  if (kind === "date") return asDate(value)
  const text = String(value || "").trim()
  return text || undefined
}

function columnPresent(cells = {}, key) {
  const fields = [...PROPERTY_FIELDS, ...LOAN_FIELDS]
  const aliases = fields.find((entry) => entry[0] === key)?.[1] || []
  return Object.keys(cells).some((item) => aliases.includes(String(item).trim().toLowerCase()))
}

function fillProperty(property, mapped) {
  const thin = property.purchasePrice == null && property.arv == null
  let changed = false
  if (thin && mapped.stage && property.stage === "Under contract" && mapped.stage !== property.stage) {
    property.stage = mapped.stage
    changed = true
  }
  for (const key of ["city", "strategy", "purchasePrice", "purchaseDate", "arv", "rehabBudget", "actualRent", "marketRent", "ownerEntity", "dealSource", "nextAction", "rentStatus", "rentMarket", "accessInfo"]) {
    if (fillBlank(property, key, mapped[key])) changed = true
  }
  return changed
}

function fillBlank(record, key, value) {
  if (value == null || value === "") return false
  if (record[key] != null && record[key] !== "") return false
  record[key] = value
  return true
}

async function saveImportedLoan(property, mapped, sourceRef) {
  const hasLoan = mapped.lender || mapped.loanNumber || mapped.balance != null || mapped.payment != null || mapped.maturity || mapped.originalAmount != null
  if (!hasLoan) return false
  const query = { propertyId: property._id }
  if (mapped.loanNumber) query.loanNumber = mapped.loanNumber
  else if (mapped.lender) query.lender = mapped.lender
  let loan = await Loan.findOne(query)
  if (!loan) {
    const lender = mapped.lender ? await lenderForName(mapped.lender) : null
    await Loan.create({
      propertyId: property._id,
      lenderId: lender?._id,
      lender: lender?.name || mapped.lender || "",
      label: "Financed",
      loanNumber: mapped.loanNumber || "",
      balance: mapped.balance,
      payment: mapped.payment,
      maturity: mapped.maturity || "",
      originalAmount: mapped.originalAmount,
      termsStatus: "Needs verification",
      importSource: sourceRef,
    })
    return true
  }
  let changed = false
  for (const key of ["lender", "loanNumber", "balance", "payment", "maturity", "originalAmount"]) {
    if (fillBlank(loan, key, mapped[key])) changed = true
  }
  if (changed) await loan.save()
  return changed
}

function sanitizeKeys(cells) {
  return Object.fromEntries(Object.entries(cells).map(([key, value]) => [key.replace(/[.$]/g, " "), value]))
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function numberOrEmpty(value) {
  if (value === "" || value == null) return undefined
  const number = Number(String(value).replace(/[$,]/g, ""))
  return Number.isFinite(number) ? number : undefined
}

function asDate(value) {
  const text = String(value || "").trim()
  if (!text) return undefined
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (!parts) return text
  const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3]
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
}
