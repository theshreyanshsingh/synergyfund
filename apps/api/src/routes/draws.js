import { Router } from "express"
import xlsx from "xlsx"
import { DocumentFile, Draw, DrawBudget, Expense, ExpenseRequest, ImportJob, PhotoReport, Property } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { propertyFilter } from "../services/access.js"
import { comparePhotosForDraw } from "../services/agent.js"
import { DRAW_FIELD_ALIASES, appendNewDrawRows, classifyDrawRows, importPortfolioRecords, parsePortfolioWorkbook, readWorkbook } from "../services/drawImport.js"
import { materializeStoredFile, receiveFile, saveUploadedFile } from "../services/files.js"
import { changeSummary, notify, recordActivity } from "../services/notify.js"

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

const DRAW_FIELDS = [["title", "Name"], ["amount", "Amount", true], ["fundedAmount", "Pulled", true], ["status", "Status"], ["requestedDate", "Forecast"], ["fundedDate", "Funded date"]]
const BUDGET_FIELDS = [["budget", "Budget", true], ["fundingLimit", "Lender funding", true], ["fundingPercent", "Funding percent"]]

async function addressOf(propertyId) {
  if (!propertyId) return ""
  const property = await Property.findById(propertyId).select("address").catch(() => null)
  return property?.address || ""
}

export function presentDraw(item) {
  const lines = (item.lines || []).map((line) => ({
    id: String(line._id),
    title: line.title || "",
    description: line.description || "",
    amount: line.amount ?? null,
  }))
  const lineTotal = lines.reduce((total, line) => total + Number(line.amount || 0), 0)
  const amount = item.amount != null ? Number(item.amount) : lines.length ? lineTotal : null
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
    const portfolio = await portfolioFromFile(file)
    if (portfolio) {
      res.json({ import: sheetImport(job, file, portfolio) })
      return
    }
    const liveRows = await drawRows(file, job)
    res.json({ import: presentImport(job, file, liveRows) })
  }),
)

drawsRouter.post(
  "/import",
  requirePermission("imports.run"),
  requirePermission("draws.write"),
  receiveFile("file"),
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
    await recordActivity({ user: req.user, title: "Draw workbook uploaded", detail: `${saved.name} · waiting for review` })
    const portfolio = await portfolioFromFile(saved)
    if (portfolio) {
      const job = await ImportJob.create({
        fileId: saved._id,
        type: "draws",
        sheet: "Dashboard",
        headers: portfolio.columns,
        rows: [],
        counts: portfolio.counts,
        createdBy: req.user._id,
      })
      res.status(201).json({ import: sheetImport(job, saved, portfolio) })
      return
    }
    let tables
    try {
      tables = await tablesFromFile(saved)
    } catch {
      sendError(res, 400, "That workbook could not be read. Use an .xls or .xlsx file.")
      return
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
      rows: [],
      marks: classified.rows.map((row) => ({ sheet: row.sheet, row: row.row, status: row.status, reason: row.reason })),
      counts: classified.counts,
      createdBy: req.user._id,
    })
    res.status(201).json({ import: presentImport(job, saved, classified.rows) })
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
    const fileForRows = await DocumentFile.findById(job.fileId)
    const portfolio = await portfolioFromFile(fileForRows)
    if (portfolio) {
      const result = await importPortfolioRecords({
        records: portfolio.records,
        properties,
        draws,
        Draw,
        DrawBudget,
        Property,
        userName: req.user.name,
      })
      job.marks = result.marks
      job.counts = result.counts
      job.status = "Confirmed"
      await job.save()
      await recordActivity({
        user: req.user,
        title: "Draw workbook appended",
        detail: `${result.counts.added} draws added, ${result.counts.duplicate} already on file`,
      })
      res.json({ import: sheetImport(job, fileForRows, portfolio) })
      return
    }
    const rows = await drawRows(fileForRows, job)
    const result = await appendNewDrawRows({
      rows,
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
    res.json({ import: presentImport(job, fileForRows, rows) })
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
    await recordActivity({
      user: req.user,
      title: "Draw budget set",
      detail: [await addressOf(budget.propertyId), budget.budget != null ? `Budget $${budget.budget.toLocaleString("en-US")}` : "", budget.fundingLimit != null ? `Lender funding $${budget.fundingLimit.toLocaleString("en-US")}` : ""].filter(Boolean).join(" · "),
      propertyId: budget.propertyId,
    })
    res.status(201).json({ budget: presentBudget(budget) })
  }),
)

drawsRouter.patch(
  "/budgets/:id",
  requirePermission("draws.write"),
  asyncHandler(async (req, res) => {
    const budget = await DrawBudget.findById(req.params.id)
    if (!budget) {
      sendError(res, 404, "That draw budget was not found.")
      return
    }
    const before = budget.toObject()
    for (const field of ["budget", "fundingLimit", "fundingPercent"]) {
      if (!(field in req.body)) continue
      const value = numberOrUndefined(req.body[field])
      if (value == null || value < 0) {
        sendError(res, 400, `${field} needs to be zero or more.`)
        return
      }
      budget[field] = value
    }
    await budget.save()
    const changes = changeSummary(before, budget.toObject(), BUDGET_FIELDS)
    await recordActivity({ user: req.user, title: "Draw budget updated", detail: [await addressOf(budget.propertyId), changes].filter(Boolean).join(" · "), propertyId: budget.propertyId })
    res.json({ budget: presentBudget(budget) })
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

drawsRouter.get(
  "/export",
  requirePermission("draws.read"),
  asyncHandler(async (req, res) => {
    const allowed = await Property.find(propertyFilter(req.user)).select("address city")
    const allowedIds = new Set(allowed.map((property) => String(property._id)))
    let properties = allowed
    if (req.query.propertyId) {
      properties = allowed.filter((property) => String(property._id) === String(req.query.propertyId))
      if (!properties.length) {
        sendError(res, 404, "That property is not available.")
        return
      }
    }
    const draws = await Draw.find({ propertyId: { $in: properties.map((property) => property._id) } }).sort({ createdAt: 1 })
    const names = new Map(properties.map((property) => [String(property._id), property]))
    const header = ["Property", "City", "Draw", "Status", "Line item", "Description", "Line amount", "Draw amount", "Pulled", "Remaining", "Forecast finish", "Funded date"]
    const rows = [header]
    for (const draw of draws) {
      if (!allowedIds.has(String(draw.propertyId))) continue
      const view = presentDraw(draw)
      const property = names.get(String(draw.propertyId))
      const lines = view.lines.length ? view.lines : [{ title: "", description: "", amount: "" }]
      for (const line of lines) {
        rows.push([
          property?.address || "",
          property?.city || "",
          view.title,
          view.status,
          line.title || "",
          line.description || "",
          line.amount ?? "",
          view.amount ?? "",
          view.pulled ?? "",
          view.remaining ?? "",
          view.requestedDate || "",
          view.fundedDate || "",
        ])
      }
    }
    if (rows.length === 1) rows.push(header.map(() => ""))
    const book = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), "Draws")
    const buffer = xlsx.write(book, { type: "buffer", bookType: "xlsx" })
    const filename = properties.length === 1 ? `${fileSlug(properties[0].address)}-draws.xlsx` : "draws.xlsx"
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.send(buffer)
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
    const before = draw.toObject()
    if ("requestedDate" in req.body) draw.requestedDate = req.body.requestedDate || ""
    if ("title" in req.body && req.body.title) draw.title = req.body.title
    if ("amount" in req.body) draw.amount = numberOrUndefined(req.body.amount)
    if ("lines" in req.body) {
      draw.lines = parseDrawLines(req.body.lines)
      if (draw.lines.some((line) => line.amount != null)) {
        draw.amount = draw.lines.reduce((total, line) => total + Number(line.amount || 0), 0)
      }
    }
    if ("fundedAmount" in req.body) {
      const pulled = moneyOrZero(req.body.fundedAmount)
      if (pulled == null) {
        sendError(res, 400, "Pulled needs to be zero or more.")
        return
      }
      draw.fundedAmount = pulled
      const amount = Number(draw.amount)
      if (Number.isFinite(amount) && amount > 0 && pulled >= amount) {
        draw.status = "Funded"
        draw.fundedDate = draw.fundedDate || new Date().toISOString().slice(0, 10)
      } else if (pulled > 0) {
        draw.status = "Partial"
      } else if (draw.status === "Funded" || draw.status === "Partial") {
        draw.status = "Requested"
        draw.fundedDate = ""
      }
    }
    await draw.save()
    const changes = changeSummary(before, draw.toObject(), DRAW_FIELDS)
    const lineNote = "lines" in req.body ? `${draw.lines.length} scope lines` : ""
    await recordActivity({ user: req.user, title: "Draw updated", detail: [await addressOf(draw.propertyId), draw.title, changes || lineNote].filter(Boolean).join(" · "), propertyId: draw.propertyId })
    res.json({ draw: presentDraw(draw) })
  }),
)

drawsRouter.delete(
  "/:id",
  requirePermission("draws.write"),
  asyncHandler(async (req, res) => {
    const draw = await Draw.findById(req.params.id)
    if (!draw) {
      sendError(res, 404, "That draw was not found.")
      return
    }
    await draw.deleteOne()
    await recordActivity({ user: req.user, title: "Draw removed", detail: draw.title, propertyId: draw.propertyId })
    res.json({ ok: true })
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

const PREVIEW_ROWS = 400

function sheetImport(job, file, portfolio) {
  return {
    id: String(job._id),
    name: file?.name || "Workbook",
    status: job.status,
    counts: job.status === "Confirmed" ? (job.counts || portfolio.counts) : portfolio.counts,
    format: "sheet",
    columns: portfolio.columns,
    grid: portfolio.grid,
    properties: portfolio.records.map((record) => ({
      address: record.address,
      city: record.city,
      budget: record.rehabBudget,
      draws: record.draws.length,
    })),
    createdAt: job.createdAt,
    totalRows: portfolio.grid.length,
    truncated: false,
    rows: [],
  }
}

async function portfolioFromFile(file) {
  if (!file) return null
  const stored = await materializeStoredFile(file)
  try {
    return parsePortfolioWorkbook(stored.path)
  } catch {
    return null
  } finally {
    await stored.cleanup()
  }
}

function presentImport(job, file, liveRows) {
  const marks = new Map((job.marks || []).map((item) => [`${item.sheet}:${item.row}`, item]))
  const source = liveRows || job.rows || []
  const rows = source.map((row) => {
    const marked = marks.get(`${row.sheet}:${row.row}`) || {}
    return {
      sheet: row.sheet,
      row: row.row,
      cells: row.cells || {},
      status: marked.status || row.status || "skipped",
      reason: marked.reason || row.reason || "",
    }
  })
  return {
    id: String(job._id),
    name: file?.name || "Workbook",
    status: job.status,
    counts: job.counts || {},
    headers: job.headers || [],
    createdAt: job.createdAt,
    totalRows: rows.length,
    truncated: rows.length > PREVIEW_ROWS,
    rows: rows.slice(0, PREVIEW_ROWS),
  }
}

async function tablesFromFile(file) {
  if (!file) return []
  const stored = await materializeStoredFile(file)
  try {
    return readWorkbook(stored.path, DRAW_FIELD_ALIASES.flatMap((entry) => entry[1]))
  } finally {
    await stored.cleanup()
  }
}

async function drawRows(file, job) {
  try {
    const tables = await tablesFromFile(file)
    if (tables.length) return tables.flatMap((table) => table.rows)
  } catch {
    return job.rows || []
  }
  return job.rows || []
}

async function loadDrawContext(user) {
  const properties = await Property.find(propertyFilter(user))
  const draws = await Draw.find({ propertyId: { $in: properties.map((property) => property._id) } })
  return [properties, draws]
}

function fileSlug(value) {
  const slug = String(value || "draws").replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
  return slug || "draws"
}

function moneyOrZero(value) {
  if (value === "" || value == null) return 0
  const number = Number(String(value).replace(/[$,]/g, ""))
  if (!Number.isFinite(number) || number < 0) return null
  return number
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
