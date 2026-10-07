import { Router } from "express"
import { DocumentFile, Draw, DrawBudget, Expense, ExpenseRequest, ImportJob, PhotoReport, Property } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { propertyFilter } from "../services/access.js"
import { comparePhotosForDraw } from "../services/agent.js"
import { DRAW_FIELD_ALIASES, appendNewDrawRows, classifyDrawRows, readWorkbook } from "../services/drawImport.js"
import { materializeStoredFile, saveUploadedFile, upload } from "../services/files.js"
import { notify, recordActivity } from "../services/notify.js"

export const drawsRouter = Router()

function presentBudget(item) {
  return {
    id: String(item._id),
    propertyId: String(item.propertyId),
    title: item.title,
    budget: item.budget ?? null,
    fundingLimit: item.fundingLimit ?? null,
    fundingPercent: item.fundingPercent ?? null,
    fundingBasis: item.fundingBasis,
    approvalStatus: item.approvalStatus,
    loanNumber: item.loanNumber || "",
    borrower: item.borrower || "",
    notes: item.notes || "",
  }
}

export function presentDraw(item) {
  const lines = (item.lines || []).map((line) => ({
    id: String(line._id),
    title: line.title || "",
    description: line.description || "",
    amount: line.amount ?? null,
  }))
  const figured = lines.some((line) => line.amount != null)
  const amount = figured ? lines.reduce((total, line) => total + Number(line.amount || 0), 0) : item.amount ?? null
  const pulled = item.fundedAmount != null ? Number(item.fundedAmount) : item.status === "Funded" && amount != null ? Number(amount) : 0
  return {
    id: String(item._id),
    propertyId: String(item.propertyId),
    budgetId: item.budgetId ? String(item.budgetId) : "",
    title: item.title,
    status: item.status,
    amount,
    fundedAmount: item.fundedAmount ?? null,
    pulled,
    remaining: amount == null ? null : Math.max(0, Number(amount) - pulled),
    cashBasis: item.cashBasis,
    requestedDate: item.requestedDate || "",
    fundedDate: item.fundedDate || "",
    notes: item.notes || "",
    lines,
  }
}

export function presentContractorDraw(item) {
  const draw = presentDraw(item)
  return {
    id: draw.id,
    propertyId: draw.propertyId,
    title: draw.title,
    status: draw.status,
    amount: draw.amount,
    pulled: draw.pulled,
    remaining: draw.remaining,
    requestedDate: draw.requestedDate,
    lines: draw.lines,
  }
}

drawsRouter.get(
  "/",
  requirePermission("draws.read"),
  asyncHandler(async (req, res) => {
    const properties = await Property.find(propertyFilter(req.user)).select("_id address city stage strategy rehabBudget rehabRemaining scopeLines")
    const ids = properties.map((property) => property._id)
    const [budgets, draws, expenses, requests, reports] = await Promise.all([
      DrawBudget.find({ propertyId: { $in: ids } }),
      Draw.find({ propertyId: { $in: ids } }).sort({ createdAt: -1 }),
      Expense.find({ propertyId: { $in: ids } }),
      ExpenseRequest.find({ propertyId: { $in: ids }, status: { $in: ["Submitted", "Needs information", "Needs second approval"] } }),
      PhotoReport.find({ propertyId: { $in: ids } }).sort({ createdAt: -1 }),
    ])
    if (req.user.role === "contractor") {
      res.json({
        properties: properties.map((property) => ({
          id: String(property._id),
          address: property.address,
          city: property.city,
          stage: property.stage,
        })),
        budgets: [],
        draws: draws.map(presentContractorDraw),
        reports: [],
        totals: null,
      })
      return
    }
    await syncRehabRemaining(properties, expenses)
    const funded = draws.filter((draw) => draw.status === "Funded").reduce((sum, draw) => sum + Number(draw.fundedAmount || 0), 0)
    const pendingShare = requests.reduce((sum, request) => sum + Number(request.amount || 0), 0)
    const rehab = budgets.reduce((sum, budget) => sum + Number(budget.budget || 0), 0)
    res.json({
      properties: properties.map((property) => ({
        id: String(property._id),
        address: property.address,
        city: property.city,
        stage: property.stage,
        strategy: property.strategy || "",
        rehabBudget: property.rehabBudget ?? null,
        rehabRemaining: property.rehabRemaining ?? null,
        scopeLines: (property.scopeLines || []).map((line) => ({
          title: line.title,
          description: line.description || "",
          budget: line.budget ?? null,
          status: line.status || "Not started",
        })),
        spent: sumFor(expenses.filter(countsAsRehab), property._id),
        pending: sumFor(requests, property._id),
      })),
      budgets: budgets.map(presentBudget),
      draws: draws.map(presentDraw),
      reports: reports.map((report) => ({
        id: String(report._id),
        propertyId: String(report.propertyId),
        drawId: report.drawId ? String(report.drawId) : "",
        summary: report.summary,
        changes: report.changes,
      })),
      totals: {
        rehabBudget: rehab,
        reportedCash: funded,
        pending: pendingShare,
        undrawn: rehab - funded - pendingShare,
        postedExpenses: expenses.filter(countsAsRehab).reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
      },
    })
  }),
)

drawsRouter.get(
  "/imports",
  requirePermission("draws.read"),
  asyncHandler(async (req, res) => {
    const jobs = await ImportJob.find({ type: "draws" }).sort({ createdAt: -1 }).limit(12)
    const files = await DocumentFile.find({ _id: { $in: jobs.map((job) => job.fileId) } })
    const names = new Map(files.map((file) => [String(file._id), file.name]))
    res.json({
      imports: jobs.map((job) => ({
        id: String(job._id),
        name: names.get(String(job.fileId)) || "Workbook",
        status: job.status,
        counts: job.counts || {},
        createdAt: job.createdAt,
      })),
    })
  }),
)

drawsRouter.get(
  "/imports/:id",
  requirePermission("draws.read"),
  asyncHandler(async (req, res) => {
    const job = await ImportJob.findById(req.params.id)
    if (!job || job.type !== "draws") {
      sendError(res, 404, "That draw workbook was not found.")
      return
    }
    const file = await DocumentFile.findById(job.fileId)
    res.json({ import: presentImport(job, file) })
  }),
)

drawsRouter.post(
  "/import",
  requirePermission("imports.run"),
  requirePermission("draws.write"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      sendError(res, 400, "Choose an Excel workbook.")
      return
    }
    const lower = req.file.originalname.toLowerCase()
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      sendError(res, 400, "Import a .xls or .xlsx workbook.")
      return
    }
    const saved = await saveUploadedFile(req.file, req.user, { kind: "import" })
    const stored = await materializeStoredFile(saved)
    let tables
    try {
      tables = readWorkbook(stored.path, DRAW_FIELD_ALIASES.flatMap((entry) => entry[1]))
    } finally {
      await stored.cleanup()
    }
    if (!tables.length) {
      sendError(res, 400, "That workbook has no rows to read.")
      return
    }
    const [properties, draws] = await loadDrawContext(req.user)
    const classified = classifyDrawRows(tables, properties, draws)
    const job = await ImportJob.create({
      fileId: saved._id,
      type: "draws",
      sheet: tables.map((table) => table.sheet).join(", "),
      headers: classified.headers,
      rows: classified.rows.map((row) => ({ sheet: row.sheet, row: row.row, cells: row.cells })),
      marks: classified.rows.map((row) => ({ sheet: row.sheet, row: row.row, status: row.status, reason: row.reason })),
      counts: classified.counts,
      createdBy: req.user._id,
    })
    res.status(201).json({ import: presentImport(job, saved) })
  }),
)

drawsRouter.post(
  "/import/:id/confirm",
  requirePermission("imports.run"),
  requirePermission("draws.write"),
  asyncHandler(async (req, res) => {
    const job = await ImportJob.findById(req.params.id)
    if (!job || job.type !== "draws" || job.status !== "Draft") {
      sendError(res, 404, "That draw workbook is not waiting to be appended.")
      return
    }
    const [properties, draws] = await loadDrawContext(req.user)
    const result = await appendNewDrawRows({
      rows: job.rows,
      properties,
      draws,
      Draw,
      Property,
      userName: req.user.name,
    })
    job.marks = result.marks
    job.counts = result.counts
    job.status = "Confirmed"
    await job.save()
    if (result.propertyIds.length) {
      const fresh = await Property.find({ _id: { $in: result.propertyIds } })
      const expenses = await Expense.find({ propertyId: { $in: result.propertyIds } })
      await syncRehabRemaining(fresh, expenses)
    }
    await recordActivity({
      user: req.user,
      title: "Draw workbook appended",
      detail: `${result.counts.added} added, ${result.counts.duplicate} duplicates left unchanged, ${result.counts.skipped} skipped`,
    })
    const file = await DocumentFile.findById(job.fileId)
    res.json({ import: presentImport(job, file) })
  }),
)

drawsRouter.post(
  "/budgets",
  requirePermission("draws.write"),
  asyncHandler(async (req, res) => {
    const budget = await DrawBudget.create({
      propertyId: req.body.propertyId,
      title: req.body.title || "Rehab funding",
      budget: numberOrUndefined(req.body.budget),
      fundingLimit: numberOrUndefined(req.body.fundingLimit),
      fundingPercent: numberOrUndefined(req.body.fundingPercent) ?? 100,
      fundingBasis: req.body.fundingBasis || "Reported in source",
      approvalStatus: req.body.approvalStatus || "Not confirmed",
      loanNumber: req.body.loanNumber || "",
      borrower: req.body.borrower || "",
      notes: req.body.notes || "",
    })
    res.status(201).json({ budget: presentBudget(budget) })
  }),
)

drawsRouter.post(
  "/",
  requirePermission("draws.write"),
  asyncHandler(async (req, res) => {
    if (!req.body.propertyId || !req.body.title) {
      sendError(res, 400, "A draw needs a property and a name.")
      return
    }
    const lines = parseDrawLines(req.body.lines)
    const draw = await Draw.create({
      propertyId: req.body.propertyId,
      budgetId: req.body.budgetId || undefined,
      title: req.body.title,
      status: req.body.status || "Requested",
      amount: lines.some((line) => line.amount != null)
        ? lines.reduce((total, line) => total + Number(line.amount || 0), 0)
        : numberOrUndefined(req.body.amount),
      fundedAmount: numberOrUndefined(req.body.fundedAmount),
      cashBasis: req.body.cashBasis || "Confirmed receipt",
      requestedDate: req.body.requestedDate || "",
      fundedDate: req.body.fundedDate || "",
      notes: req.body.notes || "",
      lines,
    })
    await recordActivity({ user: req.user, title: "Draw recorded", detail: draw.title, propertyId: draw.propertyId })
    res.status(201).json({ draw: presentDraw(draw) })
  }),
)

drawsRouter.patch(
  "/:id",
  requirePermission("draws.write"),
  asyncHandler(async (req, res) => {
    const draw = await Draw.findById(req.params.id)
    if (!draw) {
      sendError(res, 404, "That draw was not found.")
      return
    }
    if ("requestedDate" in req.body) draw.requestedDate = req.body.requestedDate || ""
    if ("title" in req.body && req.body.title) draw.title = req.body.title
    if ("amount" in req.body) draw.amount = numberOrUndefined(req.body.amount)
    if ("lines" in req.body) {
      draw.lines = parseDrawLines(req.body.lines)
      if (draw.lines.some((line) => line.amount != null)) {
        draw.amount = draw.lines.reduce((total, line) => total + Number(line.amount || 0), 0)
      }
    }
    await draw.save()
    res.json({ draw: presentDraw(draw) })
  }),
)

drawsRouter.post(
  "/:id/pull",
  requirePermission("draws.write"),
  asyncHandler(async (req, res) => {
    const draw = await Draw.findById(req.params.id)
    if (!draw) {
      sendError(res, 404, "That draw was not found.")
      return
    }
    draw.status = "Funded"
    draw.fundedDate = draw.fundedDate || new Date().toISOString().slice(0, 10)
    if (draw.fundedAmount == null) draw.fundedAmount = draw.amount
    await draw.save()
    const [property, propertyExpenses] = await Promise.all([
      Property.findById(draw.propertyId),
      Expense.find({ propertyId: draw.propertyId }),
    ])
    if (property) await syncRehabRemaining([property], propertyExpenses)
    const report = await comparePhotosForDraw(draw)
    await notify({
      roles: ["admin", "finance", "investor"],
      title: "Draw pulled",
      body: report.summary,
      href: "/draws",
      event: "draw.pulled",
    })
    await recordActivity({ user: req.user, title: "Draw pulled", detail: draw.title, propertyId: draw.propertyId })
    res.json({
      draw: presentDraw(draw),
      report: { id: String(report._id), summary: report.summary, changes: report.changes },
    })
  }),
)

function presentImport(job, file) {
  const marks = new Map((job.marks || []).map((item) => [`${item.sheet}:${item.row}`, item]))
  return {
    id: String(job._id),
    name: file?.name || "Workbook",
    status: job.status,
    counts: job.counts || {},
    headers: job.headers || [],
    createdAt: job.createdAt,
    rows: (job.rows || []).map((row) => {
      const marked = marks.get(`${row.sheet}:${row.row}`) || {}
      return { sheet: row.sheet, row: row.row, cells: row.cells || {}, status: marked.status || "skipped", reason: marked.reason || "" }
    }),
  }
}

async function loadDrawContext(user) {
  const properties = await Property.find(propertyFilter(user))
  const draws = await Draw.find({ propertyId: { $in: properties.map((property) => property._id) } })
  return [properties, draws]
}

function sumFor(items, propertyId) {
  const id = String(propertyId)
  return items.reduce((sum, item) => sum + (String(item.propertyId) === id ? Number(item.amount) || 0 : 0), 0)
}

function countsAsRehab(expense) {
  return expense.costTreatment !== "Exclude from construction margin"
}

async function syncRehabRemaining(properties, expenses) {
  const rehabCosts = expenses.filter(countsAsRehab)
  await Promise.all(properties.map(async (property) => {
    if (property.rehabBudget == null) return
    const spent = sumFor(rehabCosts, property._id)
    const remaining = Math.max(0, Number(property.rehabBudget) - spent)
    if (property.rehabRemaining === remaining) return
    property.rehabRemaining = remaining
    await property.save()
  }))
}

export async function refreshRehabRemaining(propertyId) {
  if (!propertyId) return
  const property = await Property.findById(propertyId)
  if (!property) return
  const expenses = await Expense.find({ propertyId: property._id })
  await syncRehabRemaining([property], expenses)
}

function parseDrawLines(value) {
  const list = Array.isArray(value) ? value : []
  return list.flatMap((line) => {
    const title = String(line?.title || "").trim()
    if (!title) return []
    return [{
      _id: line.id || line._id || undefined,
      title,
      description: String(line.description || "").trim(),
      amount: numberOrUndefined(line.amount),
    }]
  })
}

function numberOrUndefined(value) {
  if (value === "" || value == null) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}
