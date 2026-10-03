import { Router } from "express"
import { z } from "zod"
import { STAGES } from "@synergifund/shared"
import { DocumentFile, Draw, DrawBudget, Expense, ExpenseRequest, PhotoSet, Property, User } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { presentProperty } from "../lib/serialize.js"
import { propertyFilter, ownsProperty } from "../services/access.js"
import { saveUploadedFile, upload } from "../services/files.js"
import { recordActivity } from "../services/notify.js"

export const propertiesRouter = Router()

const writable = z.object({
  address: z.string().min(3),
  city: z.string().optional().default(""),
  stage: z.string().optional(),
  strategy: z.string().optional().default(""),
  health: z.string().optional(),
  nextAction: z.string().optional().default(""),
  deadline: z.string().optional().default(""),
  ownerEntity: z.string().optional().default(""),
  accessInfo: z.string().optional().default(""),
  purchasePrice: z.number().nullable().optional(),
  houseBoughtPrice: z.number().nullable().optional(),
  purchaseDate: z.string().optional().default(""),
  dealSource: z.string().optional().default(""),
  arv: z.number().nullable().optional(),
  marketRent: z.number().nullable().optional(),
  actualRent: z.number().nullable().optional(),
  rentStatus: z.string().optional().default(""),
  rentMarket: z.string().optional().default(""),
  rehabBudget: z.number().nullable().optional(),
  rehabRemaining: z.number().nullable().optional(),
})

propertiesRouter.get(
  "/",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const filter = propertyFilter(req.user)
    if (req.query.stage) filter.stage = req.query.stage
    if (req.query.important === "1") filter.health = "Needs attention"
    const query = Property.find(filter).sort({ updatedAt: -1 })
    if (req.query.q) {
      const expression = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      query.where({ $or: [{ address: expression }, { city: expression }, { ownerEntity: expression }] })
    }
    const items = await query
    res.json({ items: items.map((item) => presentProperty(item, req.user)) })
  }),
)

propertiesRouter.get(
  "/:id",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const property = await Property.findById(req.params.id)
    if (!property || !ownsProperty(req.user, property)) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const canDraws = req.permissions.includes("draws.read")
    const [spent, pending, draws, budgets] = await Promise.all([
      Expense.aggregate([{ $match: { propertyId: property._id, costTreatment: { $ne: "Exclude from construction margin" } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      ExpenseRequest.aggregate([{ $match: { propertyId: property._id, status: { $in: ["Submitted", "Needs information", "Needs second approval"] } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      canDraws ? Draw.find({ propertyId: property._id }).sort({ createdAt: -1 }) : [],
      canDraws ? DrawBudget.find({ propertyId: property._id }) : [],
    ])
    const rehabSpent = spent[0]?.total || 0
    const received = draws.filter((draw) => draw.status === "Funded").reduce((total, draw) => total + Number(draw.fundedAmount ?? draw.amount ?? 0), 0)
    const schedule = Number(budgets.find((item) => Number(item.budget) > 0)?.budget) || Number(property.rehabBudget) || 0
    const [expenseDocs, requestDocs, photos, people] = await Promise.all([
      req.permissions.includes("expenses.read") ? Expense.find({ propertyId: property._id }).sort({ createdAt: -1 }) : [],
      req.permissions.includes("expenses.read") ? ExpenseRequest.find({ propertyId: property._id }).sort({ createdAt: -1 }) : [],
      DocumentFile.find({ propertyId: property._id, kind: "photo" }).sort({ createdAt: -1 }),
      User.find({ _id: { $in: property.assignedUserIds || [] } }).select("name email"),
    ])
    res.json({
      property: presentProperty(property, req.user),
      rehabSpent,
      pendingExpenses: pending[0]?.total || 0,
      contractors: people.map((person) => ({ id: String(person._id), name: person.name, email: person.email })),
      photos: photos.map((file) => ({ id: String(file._id), name: file.name })),
      expenses: expenseDocs.map(presentCost),
      requests: requestDocs.map(presentCost),
      draws: canDraws ? {
        received,
        undrawn: schedule ? Math.max(0, schedule - received) : null,
        items: draws.map((draw) => ({
          id: String(draw._id),
          title: draw.title,
          status: draw.status,
          amount: draw.amount ?? null,
          fundedAmount: draw.fundedAmount ?? null,
          fundedDate: draw.fundedDate || "",
        })),
      } : null,
    })
  }),
)

propertiesRouter.post(
  "/",
  requirePermission("properties.write"),
  upload.array("photos", 24),
  asyncHandler(async (req, res) => {
    const parsed = writable.safeParse({ ...req.body, purchasePrice: numberOrNull(req.body.purchasePrice), arv: numberOrNull(req.body.arv), rehabBudget: numberOrNull(req.body.rehabBudget), houseBoughtPrice: numberOrNull(req.body.houseBoughtPrice), actualRent: numberOrNull(req.body.actualRent), marketRent: numberOrNull(req.body.marketRent) })
    if (!parsed.success) {
      sendError(res, 400, "A property needs an address.")
      return
    }
    const scopeLines = parseList(req.body.scopeLines).flatMap((line) => {
      const title = String(line?.title || "").trim()
      if (!title) return []
      return [{ title, budget: numberOrNull(line.budget), status: line.status || "Not started" }]
    })
    const property = await Property.create({
      ...parsed.data,
      scopeLines,
      stage: STAGES.includes(parsed.data.stage) ? parsed.data.stage : "Under contract",
      updatedBy: req.user.name,
    })
    const contractorIds = parseList(req.body.assignedUserIds).map(String).filter(Boolean)
    if (contractorIds.length) {
      const people = await User.find({ _id: { $in: contractorIds }, role: "contractor" })
      property.assignedUserIds = people.map((person) => person._id)
      await property.save()
      for (const person of people) {
        const current = new Set((person.propertyIds || []).map(String))
        current.add(String(property._id))
        person.propertyIds = [...current]
        await person.save()
      }
    }
    const photos = []
    for (const file of req.files || []) {
      photos.push(await saveUploadedFile(file, req.user, { propertyId: property._id, kind: "photo" }))
    }
    if (photos.length) {
      await PhotoSet.create({
        propertyId: property._id,
        weekOf: new Date().toISOString().slice(0, 10),
        fileIds: photos.map((file) => file._id),
        uploadedBy: req.user._id,
        note: "Added with the property",
      })
    }
    await recordActivity({ user: req.user, title: "Property added", detail: property.address, propertyId: property._id })
    res.status(201).json({ property: presentProperty(property, req.user) })
  }),
)

propertiesRouter.patch(
  "/:id",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await Property.findById(req.params.id)
    if (!property) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const parsed = writable.partial().safeParse(req.body)
    if (!parsed.success) {
      sendError(res, 400, "Those property details could not be saved.")
      return
    }
    if (!req.permissions.includes("internal.pricing")) delete parsed.data.houseBoughtPrice
    Object.assign(property, parsed.data, { updatedBy: req.user.name })
    await property.save()
    await recordActivity({ user: req.user, title: "Property updated", detail: property.address, propertyId: property._id })
    res.json({ property: presentProperty(property, req.user) })
  }),
)

function presentCost(item) {
  const proofFileIds = (item.proofFileIds || []).map(String)
  if (item.proofFileId && !proofFileIds.includes(String(item.proofFileId))) proofFileIds.unshift(String(item.proofFileId))
  return {
    id: String(item._id),
    title: item.title,
    amount: item.amount,
    status: item.status || "Approved",
    scopeLineId: item.scopeLineId || "",
    category: item.category || "",
    costTreatment: item.costTreatment || "",
    vendor: item.vendor || "",
    date: item.date || "",
    proofFileIds,
  }
}

function parseList(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== "string" || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function numberOrNull(value) {
  if (value === "" || value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
