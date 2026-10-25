import { Router } from "express"
import { APPROVAL_THRESHOLD, COST_TYPES, EXPENSE_CATEGORIES, RECEIPT_CATEGORIES, RECEIPT_MAX_ITEMS, SALES_TAX, costSheet, costType, fromCents, toCents } from "@synergifund/shared"
import { DocumentFile, Draw, Expense, ExpenseRequest, Property, Receipt, User } from "../models/index.js"
import { writeZip } from "./documents.js"
import { asyncHandler, blockContractors, requirePermission, sendError } from "../lib/http.js"
import { ownsProperty, propertyFilter } from "../services/access.js"
import { saveUploadedFile, upload, withProofUrls } from "../services/files.js"
import { changeSummary, notify, recordActivity } from "../services/notify.js"
import { refreshRehabRemaining } from "./draws.js"
import { teamToday } from "../lib/dates.js"
import { costSheetCsv, costSheetName, costSheetWorkbook, expensesCsv, expensesWorkbook, exportName, quickbooksCsv, readFilters, trackingData } from "../services/expenseTracking.js"

export const expensesRouter = Router()

const RECEIPT_ZIP_MAX = 1000

function presentRequest(item) {
  return {
    id: String(item._id),
    propertyId: item.propertyId ? String(item.propertyId) : "",
    title: item.title,
    amount: item.amount,
    category: item.category,
    vendor: item.vendor || "",
    date: item.date || "",
    entity: item.entity,
    costTreatment: item.costTreatment,
    status: item.status,
    proofFileId: item.proofFileId ? String(item.proofFileId) : "",
    proofFileIds: (item.proofFileIds || []).map(String),
    scopeLineId: item.scopeLineId || "",
    note: item.note || "",
    reviewNote: item.reviewNote || "",
    requestedBy: item.requestedBy ? String(item.requestedBy) : "",
    reapplied: Boolean(item.reapplied),
    drawId: item.drawId ? String(item.drawId) : "",
    receiptId: item.receiptId ? String(item.receiptId) : "",
    lines: (item.lines || []).map((line) => ({ description: line.description || "", category: line.category || "", amount: line.amount ?? 0, kind: line.kind || "item" })),
    createdAt: item.createdAt,
  }
}

function presentExpense(item, request) {
  return {
    id: String(item._id),
    requestId: item.requestId ? String(item.requestId) : "",
    propertyId: item.propertyId ? String(item.propertyId) : "",
    title: item.title,
    amount: item.amount,
    category: item.category,
    vendor: item.vendor || "",
    date: item.date || "",
    entity: item.entity,
    costTreatment: item.costTreatment,
    proofFileId: item.proofFileId ? String(item.proofFileId) : "",
    proofFileIds: (item.proofFileIds || []).map(String),
    scopeLineId: item.scopeLineId || "",
    reapplied: Boolean(item.reapplied || request?.reapplied),
    drawId: item.drawId ? String(item.drawId) : "",
    receiptId: item.receiptId ? String(item.receiptId) : "",
    submittedByName: item.submittedByName || "",
    lineKind: item.lineKind || "",
    createdAt: item.createdAt,
  }
}

expensesRouter.get(
  "/",
  requirePermission("expenses.read"),
  asyncHandler(async (req, res) => {
    const allowed = req.user.role === "contractor" ? await Property.find(propertyFilter(req.user)).select("_id") : null
    const propertyScope = allowed ? { propertyId: { $in: allowed.map((property) => property._id) } } : {}
    const requestScope = req.user.role === "contractor" ? { ...propertyScope, requestedBy: req.user._id } : propertyScope
    const requests = await ExpenseRequest.find(requestScope).sort({ createdAt: -1 })
    const expenseScope = req.user.role === "contractor"
      ? { ...propertyScope, requestId: { $in: requests.map((item) => item._id) } }
      : propertyScope
    const expenses = await Expense.find(expenseScope).sort({ createdAt: -1 })
    const requestsById = new Map(requests.map((request) => [String(request._id), request]))
    res.json({
      requests: await withProofUrls(requests.map(presentRequest)),
      expenses: await withProofUrls(expenses.map((expense) => presentExpense(expense, requestsById.get(String(expense.requestId || ""))))),
    })
  }),
)

// Expense tracking (staff): every item filed and waiting, with totals per property, category and buyer.
expensesRouter.get(
  "/tracking",
  requirePermission("expenses.read"),
  blockContractors,
  asyncHandler(async (req, res) => {
    const filters = readFilters(req.query)
    const data = await trackingData(req.user, filters)
    if (data.notFound) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const rows = await withProofUrls(data.rows.map((row) => ({ ...row, proofFileIds: row.fileIds })))
    res.json({ ...data, rows: rows.map(({ proofFileIds, ...row }) => row), filters })
  }),
)

expensesRouter.get(
  "/tracking/export",
  requirePermission("expenses.read"),
  blockContractors,
  asyncHandler(async (req, res) => {
    const filters = readFilters(req.query)
    const format = ["csv", "xlsx", "quickbooks"].includes(req.query.format) ? req.query.format : "xlsx"
    // QuickBooks gets only what is on the books.
    const data = await trackingData(req.user, format === "quickbooks" ? { ...filters, status: "approved" } : filters)
    if (data.notFound) {
      sendError(res, 404, "That property is not available.")
      return
    }
    if (format === "xlsx") {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      res.setHeader("Content-Disposition", `attachment; filename="${exportName(data, filters, "xlsx")}"`)
      res.send(expensesWorkbook(data))
      return
    }
    const body = format === "csv" ? expensesCsv(data) : quickbooksCsv(data, { account: req.query.account, paidFrom: req.query.paidFrom, useCategory: req.query.useCategory === "1" })
    const name = format === "csv" ? exportName(data, filters, "csv") : exportName(data, filters, "csv").replace("synergifund-expenses", "synergifund-quickbooks-journal")
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`)
    res.send(body)
  }),
)

// The receipt photos behind the costs shown, in one zip (for audits and taxes): "2026-10-21 The Home Depot $58.24.jpg".
expensesRouter.get(
  "/tracking/receipts",
  requirePermission("expenses.read"),
  blockContractors,
  asyncHandler(async (req, res) => {
    const filters = readFilters(req.query)
    const data = await trackingData(req.user, filters)
    if (data.notFound) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const totals = new Map()
    const firstRow = new Map()
    for (const row of data.rows) {
      const key = row.receiptId || row.requestId || row.id
      totals.set(key, (totals.get(key) || 0) + (toCents(row.amount) || 0))
      for (const id of row.fileIds) if (!firstRow.has(id)) firstRow.set(id, { row, key })
    }
    const ids = [...firstRow.keys()]
    if (!ids.length) {
      sendError(res, 404, "No receipt photos match these filters.")
      return
    }
    if (ids.length > RECEIPT_ZIP_MAX) {
      sendError(res, 400, `That is ${ids.length} photos. Download up to ${RECEIPT_ZIP_MAX} at a time: choose a shorter date range.`)
      return
    }
    const files = await DocumentFile.find({ _id: { $in: ids } })
    const pages = new Map()
    const names = new Map()
    for (const file of files.sort((a, b) => ids.indexOf(String(a._id)) - ids.indexOf(String(b._id)))) {
      const { row, key } = firstRow.get(String(file._id))
      const page = (pages.get(key) || 0) + 1
      pages.set(key, page)
      const extension = (String(file.name || "").match(/\.[a-z0-9]{2,5}$/i)?.[0] || ".jpg").toLowerCase()
      const many = row.fileIds.length > 1
      names.set(String(file._id), `${row.date || "No date"} ${row.vendor || row.description || "Receipt"} $${fromCents(totals.get(key)).toFixed(2)}${many ? ` (page ${page})` : ""}${extension}`)
    }
    const zipName = exportName(data, filters, "zip").replace("synergifund-expenses", "synergifund-receipts")
    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`)
    res.setHeader("X-Content-Type-Options", "nosniff")
    await writeZip(res, files, new Map(), { flat: true, names })
  }),
)

// ---- Property cost sheet: everything a house has cost, from the purchase on ----

const COST_ID = /^[a-f0-9]{24}$/i
const COST_DAY = /^\d{4}-\d{2}-\d{2}$/
const COST_FIELDS = [
  ["title", "Description"],
  ["amount", "Amount", true],
  ["date", "Date"],
  ["vendor", "Paid to"],
  ["category", "Type"],
]

// Costs added by hand (on the sheet, a draw or a paid bill) can be changed here. A receipt's items and an approved
// request's costs stay as they were filed, so they always match the receipt or request behind them.
function costLock(expense) {
  if (expense.receiptId) return "This cost is an item on a receipt, so it stays as the receipt was filed."
  if (expense.requestId) return "This cost came from an approved request, so it stays as it was approved."
  return ""
}

async function sheetFor(req, propertyId) {
  const property = COST_ID.test(String(propertyId || "")) ? await Property.findOne({ _id: propertyId, ...propertyFilter(req.user) }).select("address purchasePrice purchaseDate arv").lean() : null
  if (!property) return null
  const data = await trackingData(req.user, readFilters({ propertyId: String(property._id) }))
  if (data.notFound) return null
  const rows = data.rows.map((row) => ({ ...row, editable: row.state === "approved" && !row.receiptId && !row.requestId }))
  return { property, sheet: costSheet(property, rows) }
}

expensesRouter.get(
  "/cost-sheet",
  requirePermission("expenses.read"),
  blockContractors,
  asyncHandler(async (req, res) => {
    const found = await sheetFor(req, req.query.propertyId)
    if (!found) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const { property, sheet } = found
    // Receipt photos open from the sheet, like they do in expense tracking (one lookup for every row).
    const lists = [...sheet.groups.flatMap((group) => group.types), sheet.loanPayoffs]
    const shown = await withProofUrls(lists.flatMap((entry) => entry.rows.map((row) => ({ ...row, proofFileIds: row.fileIds || [] }))))
    let at = 0
    for (const entry of lists) entry.rows = entry.rows.map(() => { const { proofFileIds, ...row } = shown[at++]; return row })
    res.json({
      property: { id: String(property._id), address: property.address, purchasePrice: property.purchasePrice ?? null, purchaseDate: property.purchaseDate || "", arv: property.arv ?? null },
      sheet,
      canAdd: req.permissions.includes("expenses.approve"),
      canEditPurchase: req.permissions.includes("properties.write"),
    })
  }),
)

expensesRouter.get(
  "/cost-sheet/export",
  requirePermission("expenses.read"),
  blockContractors,
  asyncHandler(async (req, res) => {
    const found = await sheetFor(req, req.query.propertyId)
    if (!found) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const { property, sheet } = found
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.setHeader("Content-Disposition", `attachment; filename="${costSheetName(property, "csv")}"`)
      res.send(costSheetCsv(sheet))
      return
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition", `attachment; filename="${costSheetName(property, "xlsx")}"`)
    res.send(costSheetWorkbook(sheet, property))
  }),
)

async function findCost(req, res) {
  const expense = COST_ID.test(req.params.id) ? await Expense.findById(req.params.id) : null
  const property = expense?.propertyId ? await Property.findById(expense.propertyId) : null
  if (!expense || (expense.propertyId && (!property || !ownsProperty(req.user, property)))) {
    sendError(res, 404, "That cost was not found.")
    return null
  }
  const locked = costLock(expense)
  if (locked) {
    sendError(res, 400, locked)
    return null
  }
  return expense
}

expensesRouter.patch(
  "/costs/:id",
  requirePermission("expenses.approve"),
  asyncHandler(async (req, res) => {
    const expense = await findCost(req, res)
    if (!expense) return
    const body = req.body || {}
    const next = {}
    if ("title" in body) {
      const title = String(body.title || "").trim().slice(0, 200)
      if (!title) {
        sendError(res, 400, "Enter a description.")
        return
      }
      next.title = title
    }
    if ("amount" in body) {
      const cents = toCents(body.amount)
      if (cents == null || Number.isNaN(cents) || cents <= 0) {
        sendError(res, 400, "Enter an amount above $0.")
        return
      }
      next.amount = fromCents(cents)
    }
    if ("date" in body) {
      const date = String(body.date || "")
      if (!COST_DAY.test(date)) {
        sendError(res, 400, "Enter the date as a day, like 2026-10-24.")
        return
      }
      next.date = date
    }
    if ("vendor" in body) next.vendor = String(body.vendor || "").trim().slice(0, 120)
    if ("type" in body) {
      const kind = COST_TYPES[body.type]
      if (!kind) {
        sendError(res, 400, "Choose what kind of cost this is.")
        return
      }
      // Only a real change of type moves it: an unchanged type keeps the category it was filed with (a Contractor
      // cost is already Labor).
      if (costType(expense.category, expense.title) !== body.type) Object.assign(next, { category: kind.category, entity: kind.entity, costTreatment: kind.costTreatment })
    }
    const before = expense.toObject()
    Object.assign(expense, next)
    await expense.save()
    await refreshRehabRemaining(expense.propertyId)
    const changes = changeSummary(before, expense.toObject(), COST_FIELDS)
    await recordActivity({ user: req.user, title: "Cost updated", detail: [before.title, changes || "Saved with no changes"].join(" · "), propertyId: expense.propertyId })
    res.json({ expense: await withProofUrls(presentExpense(expense)) })
  }),
)

expensesRouter.delete(
  "/costs/:id",
  requirePermission("expenses.approve"),
  asyncHandler(async (req, res) => {
    const expense = await findCost(req, res)
    if (!expense) return
    await expense.deleteOne()
    await refreshRehabRemaining(expense.propertyId)
    await recordActivity({ user: req.user, title: "Cost deleted", detail: [expense.title, `$${Number(expense.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, expense.date || ""].filter(Boolean).join(" · "), propertyId: expense.propertyId })
    res.json({ ok: true })
  }),
)

expensesRouter.post(
  "/",
  requirePermission("expenses.submit"),
  upload.array("proof", 12),
  asyncHandler(async (req, res) => {
    const files = req.files || []
    if (!files.length) {
      sendError(res, 400, "Attach at least one photo as proof.")
      return
    }
    const amount = Number(req.body.amount)
    if (!req.body.title || !Number.isFinite(amount) || amount <= 0) {
      sendError(res, 400, "Enter a description and an amount.")
      return
    }
    if (req.user.role === "contractor" && !req.body.propertyId) {
      sendError(res, 400, "Choose the house this request is for.")
      return
    }
    let property = null
    if (req.body.propertyId) {
      property = await Property.findById(req.body.propertyId)
      if (!property || !ownsProperty(req.user, property)) {
        sendError(res, 403, "That property is not assigned to you.")
        return
      }
    }
    const scopeLineId = String(req.body.scopeLineId || "")
    if (scopeLineId && property && !(property.scopeLines || []).some((line) => String(line._id) === scopeLineId)) {
      sendError(res, 400, "That part of the house is not on this property.")
      return
    }
    if (req.body.drawId && !(property && /^[a-f0-9]{24}$/.test(String(req.body.drawId)) && (await Draw.exists({ _id: req.body.drawId, propertyId: property._id })))) {
      sendError(res, 400, "That draw is not on this property.")
      return
    }
    const proofs = []
    for (const file of files) {
      proofs.push(await saveUploadedFile(file, req.user, {
        propertyId: req.body.propertyId || undefined,
        kind: "receipt",
      }))
    }
    const request = await ExpenseRequest.create({
      propertyId: req.body.propertyId || undefined,
      title: req.body.title,
      amount,
      category: EXPENSE_CATEGORIES.includes(req.body.category) ? req.body.category : "Materials",
      vendor: req.body.vendor || "",
      date: req.body.date || teamToday(),
      entity: req.body.entity || "Construction company",
      costTreatment: req.body.costTreatment || "Include in construction margin",
      status: "Submitted",
      proofFileId: proofs[0]._id,
      proofFileIds: proofs.map((file) => file._id),
      note: req.body.note || "",
      requestedBy: req.user._id,
      drawId: req.body.drawId || undefined,
      scopeLineId,
    })
    // Admins, and finance (they approve expenses); not whoever submitted it.
    await notify({
      roles: ["admin", "finance"],
      exceptUserIds: [req.user._id],
      title: "Expense submitted",
      body: `${req.user.name} submitted ${request.title} for $${amount.toLocaleString("en-US")}.`,
      href: "/expenses",
      event: "expense.submitted",
    })
    await recordActivity({ user: req.user, title: "Expense submitted", detail: request.title, propertyId: request.propertyId })
    res.status(201).json({ request: await withProofUrls(presentRequest(request)) })
  }),
)

expensesRouter.post(
  "/post",
  requirePermission("expenses.approve"),
  upload.array("proof", 12),
  asyncHandler(async (req, res) => {
    const amount = Number(req.body.amount)
    if (!req.body.title || !Number.isFinite(amount) || amount <= 0) {
      sendError(res, 400, "Enter a description and an amount.")
      return
    }
    const property = await Property.findById(req.body.propertyId)
    if (!property || !ownsProperty(req.user, property)) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const scopeLineId = String(req.body.scopeLineId || "")
    if (scopeLineId && !(property.scopeLines || []).some((line) => String(line._id) === scopeLineId)) {
      sendError(res, 400, "That part of the house is not on this property.")
      return
    }
    const proofs = []
    for (const file of req.files || []) {
      proofs.push(await saveUploadedFile(file, req.user, { propertyId: property._id, kind: "receipt" }))
    }
    const expense = await Expense.create({
      propertyId: property._id,
      title: String(req.body.title).trim(),
      amount,
      category: EXPENSE_CATEGORIES.includes(req.body.category) ? req.body.category : "Materials",
      vendor: req.body.vendor || "",
      date: req.body.date || teamToday(),
      entity: req.body.entity || "Construction company",
      costTreatment: req.body.costTreatment || "Include in construction margin",
      proofFileId: proofs[0]?._id,
      proofFileIds: proofs.map((file) => file._id),
      drawId: req.body.drawId || undefined,
      scopeLineId,
      postedBy: req.user._id,
    })
    await refreshRehabRemaining(property._id)
    await recordActivity({ user: req.user, title: "Cost added", detail: expense.title, propertyId: property._id })
    res.status(201).json({ expense: await withProofUrls(presentExpense(expense)) })
  }),
)

expensesRouter.patch(
  "/:id",
  requirePermission("expenses.read"),
  upload.array("proof", 12),
  asyncHandler(async (req, res) => {
    const request = await ExpenseRequest.findById(req.params.id)
    if (!request) {
      sendError(res, 404, "That expense request was not found.")
      return
    }
    if (["Approved", "Rejected"].includes(request.status)) {
      sendError(res, 400, "That request is already closed.")
      return
    }
    const isOwner = String(request.requestedBy || "") === String(req.user._id)
    if (req.user.role !== "contractor" || !isOwner) {
      sendError(res, 403, "Only the contractor who submitted this request can change it.")
      return
    }
    if (request.propertyId) {
      const property = await Property.findById(request.propertyId)
      if (!property || !ownsProperty(req.user, property)) {
        sendError(res, 403, "That property is not assigned to you.")
        return
      }
    }
    if (req.body.title) request.title = String(req.body.title).trim()
    // A receipt's part is its items: the amount is what they add up to.
    const itemized = (request.lines || []).length > 0
    if (itemized && "lines" in req.body) {
      const lines = readLines(req.body.lines)
      if (lines.error) {
        sendError(res, 400, lines.error)
        return
      }
      request.lines = lines.list
      request.amount = fromCents(lines.list.reduce((total, line) => total + toCents(line.amount), 0))
    }
    if (!itemized && req.body.amount != null && req.body.amount !== "") {
      const amount = Number(req.body.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        sendError(res, 400, "Enter an amount.")
        return
      }
      request.amount = amount
    }
    if ("vendor" in req.body) request.vendor = req.body.vendor || ""
    if ("note" in req.body) request.note = req.body.note || ""
    if ("date" in req.body) request.date = req.body.date || ""
    if (!itemized && req.body.category && EXPENSE_CATEGORIES.includes(req.body.category)) request.category = req.body.category
    if ("scopeLineId" in req.body) request.scopeLineId = req.body.scopeLineId || ""
    const remove = new Set(fieldList(req.body.removeProof))
    // The original receipt stays with its expenses (for audits and taxes).
    if (request.receiptId) {
      const receipt = await Receipt.findById(request.receiptId).select("fileIds")
      for (const id of receipt?.fileIds || []) remove.delete(String(id))
    }
    request.proofFileIds = (request.proofFileIds || []).filter((id) => !remove.has(String(id)))
    if (request.proofFileId && remove.has(String(request.proofFileId))) request.proofFileId = request.proofFileIds[0]
    for (const file of req.files || []) {
      const saved = await saveUploadedFile(file, req.user, { propertyId: request.propertyId || undefined, kind: "receipt" })
      request.proofFileIds = request.proofFileIds || []
      request.proofFileIds.push(saved._id)
      if (!request.proofFileId) request.proofFileId = saved._id
    }
    if (!request.proofFileIds.length) {
      sendError(res, 400, "Keep at least one proof photo.")
      return
    }
    if (!request.proofFileId) request.proofFileId = request.proofFileIds[0]
    // Answering "Needs information" sends the request back to the approvers.
    const answered = request.status === "Needs information"
    if (answered) {
      request.status = "Submitted"
      request.reviewNote = ""
    }
    await request.save()
    if (answered) {
      await notify({
        roles: ["admin", "finance"],
        exceptUserIds: [req.user._id],
        title: "Expense updated for review",
        body: `${req.user.name} answered the questions on ${request.title}.`,
        href: "/expenses",
        event: "expense.submitted",
      })
    }
    await recordActivity({ user: req.user, title: "Expense request updated", detail: request.title, propertyId: request.propertyId })
    res.json({ request: await withProofUrls(presentRequest(request)) })
  }),
)

expensesRouter.post(
  "/:id/reapply",
  requirePermission("expenses.submit"),
  asyncHandler(async (req, res) => {
    const request = await ExpenseRequest.findById(req.params.id)
    if (!request) {
      sendError(res, 404, "That expense request was not found.")
      return
    }
    if (request.status !== "Rejected") {
      sendError(res, 400, "Only a rejected request can be sent again.")
      return
    }
    const isOwner = String(request.requestedBy || "") === String(req.user._id)
    if (req.user.role !== "contractor" || !isOwner) {
      sendError(res, 403, "Only the contractor who submitted this request can send it again.")
      return
    }
    if (request.propertyId) {
      const property = await Property.findById(request.propertyId)
      if (!property || !ownsProperty(req.user, property)) {
        sendError(res, 403, "That property is not assigned to you.")
        return
      }
    }
    request.status = "Submitted"
    request.reapplied = true
    request.reviewNote = ""
    request.reviewedBy = undefined
    await request.save()
    await notify({
      roles: ["admin", "finance"],
      exceptUserIds: [req.user._id],
      title: "Expense submitted again",
      body: `${req.user.name} sent ${request.title} again for $${Number(request.amount).toLocaleString("en-US")}.`,
      href: "/expenses",
      event: "expense.submitted",
    })
    await recordActivity({ user: req.user, title: "Expense submitted again", detail: request.title, propertyId: request.propertyId })
    res.json({ request: await withProofUrls(presentRequest(request)) })
  }),
)

expensesRouter.post(
  "/:id/decision",
  requirePermission("expenses.approve"),
  asyncHandler(async (req, res) => {
    const request = await ExpenseRequest.findById(req.params.id)
    if (!request) {
      sendError(res, 404, "That expense request was not found.")
      return
    }
    if (["Approved", "Rejected"].includes(request.status)) {
      sendError(res, 400, "That request is already closed.")
      return
    }
    const action = req.body.action
    if (!["approve", "reject", "needs_information"].includes(action)) {
      sendError(res, 400, "Choose approve, reject, or needs information.")
      return
    }
    if (action === "reject") {
      request.status = "Rejected"
      request.reviewNote = req.body.note || "Rejected"
      request.reviewedBy = req.user._id
      await request.save()
      await recordActivity({ user: req.user, title: "Expense rejected", detail: request.title, propertyId: request.propertyId })
      await notify({ userIds: [request.requestedBy], roles: ["admin"], exceptUserIds: [req.user._id], title: "Expense rejected", body: `${request.title} was rejected. ${request.reviewNote}`, href: "/expenses", event: "expense.rejected" })
      res.json({ request: await withProofUrls(presentRequest(request)) })
      return
    }
    if (action === "needs_information") {
      request.status = "Needs information"
      request.reviewNote = req.body.note || "More information is required."
      request.reviewedBy = req.user._id
      await request.save()
      await notify({ userIds: [request.requestedBy], title: "Expense needs information", body: request.reviewNote, href: "/expenses", event: "expense.needs_information" })
      res.json({ request: await withProofUrls(presentRequest(request)) })
      return
    }
    // The second approval on a large request is an admin's (that is who is asked for it), not another finance click.
    if (request.status === "Needs second approval" && req.user.role !== "admin") {
      sendError(res, 403, "An admin gives the second approval on this request.")
      return
    }
    if (request.propertyId && request.category !== "Shared rehab") {
      const [property, spent] = await Promise.all([
        Property.findById(request.propertyId),
        Expense.aggregate([{ $match: { propertyId: request.propertyId, costTreatment: { $ne: "Exclude from construction margin" } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      ])
      const nextTotal = (spent[0]?.total || 0) + (request.costTreatment === "Exclude from construction margin" ? 0 : request.amount)
      if (property?.rehabBudget != null && nextTotal > property.rehabBudget && req.body.confirmOverBudget !== true) {
        sendError(res, 409, `This would put rehab spend at $${nextTotal.toLocaleString("en-US")}, above the $${property.rehabBudget.toLocaleString("en-US")} budget. Approve again only if you intend to pass the budget.`)
        return
      }
    }
    if (request.amount >= APPROVAL_THRESHOLD && req.user.role !== "admin" && request.status !== "Needs second approval") {
      request.status = "Needs second approval"
      request.reviewNote = req.body.note || ""
      request.reviewedBy = req.user._id
      await request.save()
      await notify({ roles: ["admin"], exceptUserIds: [req.user._id], title: "Second approval needed", body: `${request.title} is above $${APPROVAL_THRESHOLD.toLocaleString("en-US")}.`, href: "/expenses", event: "expense.second_approval" })
      res.json({ request: await withProofUrls(presentRequest(request)) })
      return
    }
    const decided = { status: "Approved", reviewNote: req.body.note || "", reviewedBy: req.user._id, ...(req.body.drawId ? { drawId: req.body.drawId } : {}) }
    // Two quick clicks must not post the cost twice: only the first one moves the request out of its open status.
    const claimed = await ExpenseRequest.findOneAndUpdate({ _id: request._id, status: request.status }, { $set: decided }, { new: true })
    if (!claimed) {
      sendError(res, 400, "That request was just decided.")
      return
    }
    Object.assign(request, decided)
    const requester = request.requestedBy ? await User.findById(request.requestedBy).select("name") : null
    const shared = {
      propertyId: request.propertyId,
      requestId: request._id,
      vendor: request.vendor,
      date: request.date,
      entity: request.entity,
      costTreatment: request.costTreatment,
      proofFileId: request.proofFileId,
      proofFileIds: request.proofFileIds,
      drawId: request.drawId,
      scopeLineId: request.scopeLineId,
      reapplied: Boolean(request.reapplied),
      postedBy: req.user._id,
      submittedBy: request.requestedBy,
      submittedByName: requester?.name || "",
      receiptId: request.receiptId,
    }
    // A receipt's part posts one cost per item (and its sales tax), so each keeps its own category.
    const posted = (request.lines || []).length
      ? await Expense.insertMany(request.lines.map((line) => ({ ...shared, title: line.description, amount: line.amount, category: line.category, lineKind: line.kind || "item" })))
      : [await Expense.create({ ...shared, title: request.title, amount: request.amount, category: request.category })]
    const expense = posted[0]
    await refreshRehabRemaining(expense.propertyId)
    await notify({ userIds: [request.requestedBy], title: "Expense approved", body: `${request.title} posted to the property books.`, href: "/expenses", event: "expense.approved" })
    await recordActivity({ user: req.user, title: "Expense approved", detail: request.reapplied ? `${request.title} · reapplied` : request.title, propertyId: request.propertyId, alertExcept: [request.requestedBy] })
    res.json({ request: await withProofUrls(presentRequest(request)), expense: await withProofUrls(presentExpense(expense)), expenses: await withProofUrls(posted.map((item) => presentExpense(item))) })
  }),
)

// The items of a receipt's part, as the contractor corrected them (JSON from the form).
function readLines(value) {
  let list = value
  if (typeof list === "string") {
    try {
      list = JSON.parse(list)
    } catch {
      return { error: "The items could not be read." }
    }
  }
  if (!Array.isArray(list) || !list.length) return { error: "Keep at least one item." }
  if (list.length > RECEIPT_MAX_ITEMS) return { error: `A receipt can have up to ${RECEIPT_MAX_ITEMS} items.` }
  const lines = []
  for (const [index, line] of list.entries()) {
    const description = String(line?.description || "").replace(/\s+/g, " ").trim().slice(0, 200)
    const cents = toCents(line?.amount)
    if (!description) return { error: `Item ${index + 1} needs a description.` }
    if (cents == null || Number.isNaN(cents) || cents === 0) return { error: `Item ${index + 1} needs an amount.` }
    const kind = line?.kind === "tax" ? "tax" : "item"
    const category = kind === "tax" ? SALES_TAX : RECEIPT_CATEGORIES.includes(line?.category) ? line.category : "Other"
    lines.push({ description, category, amount: fromCents(cents), kind })
  }
  if (lines.reduce((total, line) => total + toCents(line.amount), 0) <= 0) return { error: "The items need to add up to more than $0." }
  return { list: lines }
}

function fieldList(value) {
  if (Array.isArray(value)) return value.flatMap(fieldList)
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean)
}
