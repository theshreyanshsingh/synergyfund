import { Router } from "express"
import { z } from "zod"
import { STAGES } from "@synergifund/shared"
import { Bill, DocumentFile, Draw, DrawBudget, Expense, ExpenseRequest, Lender, Loan, PhotoSet, Property, User } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { presentProperty } from "../lib/serialize.js"
import { propertyFilter, ownsProperty } from "../services/access.js"
import { publicFileUrl, saveUploadedFile, upload, withProofUrls } from "../services/files.js"
import { ensureLenders } from "../services/lenders.js"
import { recordActivity } from "../services/notify.js"
import { presentContractorDraw, presentDraw } from "./draws.js"

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
  customerTerms: z.string().optional(),
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
    const internal = req.user.role !== "contractor"
    if (internal) await ensureLenders()
    const [expenseDocs, requestDocs, photos, people, loans, bills] = await Promise.all([
      req.permissions.includes("expenses.read") ? Expense.find({ propertyId: property._id }).sort({ createdAt: -1 }) : [],
      req.permissions.includes("expenses.read") ? ExpenseRequest.find({ propertyId: property._id }).sort({ createdAt: -1 }) : [],
      DocumentFile.find({ propertyId: property._id, kind: "photo" }).sort({ createdAt: -1 }),
      User.find({ _id: { $in: property.assignedUserIds || [] } }).select("name email"),
      internal ? Loan.find({ propertyId: property._id }) : [],
      internal && req.permissions.includes("expenses.read") ? Bill.find({ propertyId: property._id, status: { $ne: "Paid" } }).sort({ due: 1 }) : [],
    ])
    if (!internal) {
      res.json({
        property: presentProperty(property, req.user),
        photos: photos.map(presentPhoto),
        expenses: await withProofUrls(expenseDocs.filter((item) => item.drawId).map(presentCost)),
        draws: canDraws ? { items: draws.map(presentContractorDraw) } : null,
      })
      return
    }
    res.json({
      property: presentProperty(property, req.user),
      rehabSpent,
      pendingExpenses: pending[0]?.total || 0,
      contractors: people.map((person) => ({ id: String(person._id), name: person.name, email: person.email })),
      photos: photos.map(presentPhoto),
      expenses: await withProofUrls(expenseDocs.map(presentCost)),
      requests: requestDocs.map(presentCost),
      loans: await presentPropertyLoans(loans),
      upcoming: bills.filter((bill) => bill.due).map((bill) => ({
        id: String(bill._id),
        title: bill.title,
        amount: bill.amount ?? null,
        due: bill.due || "",
        category: bill.category || "",
      })),
      draws: canDraws ? {
        received,
        undrawn: schedule ? Math.max(0, schedule - received) : null,
        items: draws.map(presentDraw),
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
      const next = scopeLineFrom(line)
      return next ? [next] : []
    })
    const property = await Property.create({
      ...parsed.data,
      labels: cleanLabelList(parseList(req.body.labels)),
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
    if ("labels" in req.body) property.labels = cleanLabelList(parseList(req.body.labels))
    if ("scopeLines" in req.body) {
      property.scopeLines = parseList(req.body.scopeLines).flatMap((line) => {
        const next = scopeLineFrom(line, true)
        return next ? [next] : []
      })
    }
    await property.save()
    await recordActivity({ user: req.user, title: "Property updated", detail: property.address, propertyId: property._id })
    res.json({ property: presentProperty(property, req.user) })
  }),
)

function presentPhoto(file) {
  return { id: String(file._id), name: file.name, url: publicFileUrl(file) }
}

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
    drawId: item.drawId ? String(item.drawId) : "",
    proofFileIds,
  }
}

async function presentPropertyLoans(loans) {
  const lenders = loans.length ? await Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } }) : []
  const byId = new Map(lenders.map((lender) => [String(lender._id), lender]))
  return loans.map((loan) => {
    const lender = byId.get(String(loan.lenderId || ""))
    return {
      id: String(loan._id),
      lenderId: loan.lenderId ? String(loan.lenderId) : "",
      lender: lender?.name || loan.lender || "Not provided",
      lenderTerms: lender?.terms || "",
      label: loan.label || "Financed",
      terms: loan.terms || "",
      loanNumber: loan.loanNumber || "",
      balance: loan.balance ?? null,
      payment: loan.payment ?? null,
      maturity: loan.maturity || "",
      termsStatus: loan.termsStatus || "",
    }
  })
}

function cleanLabelList(value) {
  const list = Array.isArray(value) ? value : []
  const labels = []
  for (const item of list) {
    const label = String(item || "").trim().replace(/\s+/g, " ").slice(0, 32)
    if (!label || labels.some((existing) => existing.toLowerCase() === label.toLowerCase())) continue
    labels.push(label)
    if (labels.length === 8) break
  }
  return labels
}

function scopeLineFrom(line, keepId = false) {
  const title = String(line?.title || "").trim()
  if (!title) return null
  const next = { title, description: String(line?.description || "").trim(), budget: numberOrNull(line.budget), status: line.status || "Not started" }
  if (keepId && (line.id || line._id)) next._id = line.id || line._id
  return next
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
