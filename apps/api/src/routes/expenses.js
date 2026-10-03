import { Router } from "express"
import { APPROVAL_THRESHOLD, EXPENSE_CATEGORIES } from "@synergifund/shared"
import { Expense, ExpenseRequest, Property } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { ownsProperty, propertyFilter } from "../services/access.js"
import { saveUploadedFile, upload } from "../services/files.js"
import { notify, recordActivity } from "../services/notify.js"
import { refreshRehabRemaining } from "./draws.js"

export const expensesRouter = Router()

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
    createdAt: item.createdAt,
  }
}

expensesRouter.get(
  "/",
  requirePermission("expenses.read"),
  asyncHandler(async (req, res) => {
    const allowed = req.user.role === "contractor" ? await Property.find(propertyFilter(req.user)).select("_id") : null
    const propertyScope = allowed ? { propertyId: { $in: allowed.map((property) => property._id) } } : {}
    const [requests, expenses] = await Promise.all([
      ExpenseRequest.find(propertyScope).sort({ createdAt: -1 }),
      Expense.find(propertyScope).sort({ createdAt: -1 }),
    ])
    const requestsById = new Map(requests.map((request) => [String(request._id), request]))
    res.json({
      requests: requests.map(presentRequest),
      expenses: expenses.map((expense) => presentExpense(expense, requestsById.get(String(expense.requestId || "")))),
    })
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
      date: req.body.date || new Date().toISOString().slice(0, 10),
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
    await notify({
      roles: ["admin", "finance"],
      title: "Expense submitted",
      body: `${req.user.name} submitted ${request.title} for $${amount.toLocaleString("en-US")}.`,
      href: "/expenses",
      event: "expense.submitted",
    })
    await recordActivity({ user: req.user, title: "Expense submitted", detail: request.title, propertyId: request.propertyId })
    res.status(201).json({ request: presentRequest(request) })
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
    if (req.body.amount != null && req.body.amount !== "") {
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
    if (req.body.category && EXPENSE_CATEGORIES.includes(req.body.category)) request.category = req.body.category
    if ("scopeLineId" in req.body) request.scopeLineId = req.body.scopeLineId || ""
    const remove = new Set(fieldList(req.body.removeProof))
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
    await request.save()
    await recordActivity({ user: req.user, title: "Expense request updated", detail: request.title, propertyId: request.propertyId })
    res.json({ request: presentRequest(request) })
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
      title: "Expense submitted again",
      body: `${req.user.name} sent ${request.title} again for $${Number(request.amount).toLocaleString("en-US")}.`,
      href: "/expenses",
      event: "expense.submitted",
    })
    await recordActivity({ user: req.user, title: "Expense submitted again", detail: request.title, propertyId: request.propertyId })
    res.json({ request: presentRequest(request) })
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
      await notify({ userIds: [request.requestedBy], roles: ["admin"], title: "Expense rejected", body: `${request.title} was rejected. ${request.reviewNote}`, href: "/expenses", event: "expense.rejected" })
      res.json({ request: presentRequest(request) })
      return
    }
    if (action === "needs_information") {
      request.status = "Needs information"
      request.reviewNote = req.body.note || "More information is required."
      request.reviewedBy = req.user._id
      await request.save()
      await notify({ userIds: [request.requestedBy], title: "Expense needs information", body: request.reviewNote, href: "/expenses", event: "expense.needs_information" })
      res.json({ request: presentRequest(request) })
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
      await notify({ roles: ["admin"], title: "Second approval needed", body: `${request.title} is above $${APPROVAL_THRESHOLD.toLocaleString("en-US")}.`, href: "/expenses", event: "expense.second_approval" })
      res.json({ request: presentRequest(request) })
      return
    }
    request.status = "Approved"
    request.reviewNote = req.body.note || ""
    request.reviewedBy = req.user._id
    if (req.body.drawId) request.drawId = req.body.drawId
    await request.save()
    const expense = await Expense.create({
      propertyId: request.propertyId,
      requestId: request._id,
      title: request.title,
      amount: request.amount,
      category: request.category,
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
    })
    await refreshRehabRemaining(expense.propertyId)
    await notify({ userIds: [request.requestedBy], title: "Expense approved", body: `${request.title} posted to the property books.`, href: "/expenses", event: "expense.approved" })
    await recordActivity({ user: req.user, title: "Expense approved", detail: request.reapplied ? `${request.title} · reapplied` : request.title, propertyId: request.propertyId })
    res.json({ request: presentRequest(request), expense: presentExpense(expense) })
  }),
)

function fieldList(value) {
  if (Array.isArray(value)) return value.flatMap(fieldList)
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean)
}
