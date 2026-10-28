import { Router } from "express"
import { z } from "zod"
import { drawPulled, lineTracking, loanSummary, REFINANCE, resolveBudget, STAGES } from "@synergifund/shared"
import { Activity, Bill, CalendarEvent, Company, ConstructionProject, DocumentFile, Draw, DrawBudget, Expense, ExpenseRequest, Lender, Loan, PhotoSet, Property, ReviewItem, Task, User } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { presentProperty } from "../lib/serialize.js"
import { propertyFilter, ownsProperty } from "../services/access.js"
import { deleteStoredFile, publicFileUrl, saveUploadedFile, upload, withProofUrls } from "../services/files.js"
import { ensureLenders } from "../services/lenders.js"
import { loanFields } from "../services/loans.js"
import { removePropertyRoom } from "../services/chat.js"
import { orderProperties } from "../services/propertyOrder.js"
import { geocode } from "../services/geocode.js"
import { recheckCalls } from "../services/calls.js"
import { emitToUsers } from "../services/chatHub.js"
import { changeSummary, notifyPropertyAccess, recordActivity } from "../services/notify.js"
import { presentContractorDraw, presentDraw } from "./draws.js"
import { teamToday } from "../lib/dates.js"
import { forgetPropertyOnReceipts } from "../services/receiptCleanup.js"

export const propertiesRouter = Router()

const PROPERTY_FIELDS = [
  ["address", "Address"],
  ["city", "City"],
  ["stage", "Status"],
  ["strategy", "Goal"],
  ["nextAction", "Next step"],
  ["deadline", "Deadline"],
  ["ownerEntity", "Owner"],
  ["purchasePrice", "Purchase price", true],
  ["purchaseDate", "Purchase date"],
  ["arv", "ARV", true],
  ["arvMethod", "ARV method"],
  ["sqft", "Square feet"],
  ["beds", "Beds"],
  ["baths", "Baths"],
  ["rehabBudget", "Rehab budget", true],
  ["marketRent", "Market rent", true],
  ["actualRent", "Actual rent", true],
  ["rentStatus", "Rent status"],
  ["accessInfo", "Access info"],
  ["customerTerms", "Customer terms"],
  ["labels", "Labels"],
]

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
  arvDate: z.string().optional(),
  arvMethod: z.string().max(200).optional(),
  sqft: z.number().nonnegative().nullable().optional(),
  beds: z.number().nonnegative().nullable().optional(),
  baths: z.number().nonnegative().nullable().optional(),
  marketRent: z.number().nullable().optional(),
  actualRent: z.number().nullable().optional(),
  rentStatus: z.string().optional().default(""),
  rentMarket: z.string().optional().default(""),
  customerTerms: z.string().optional(),
  rehabBudget: z.number().nullable().optional(),
  rehabRemaining: z.number().nullable().optional(),
})

// "" or "none" takes the property out of its company; anything else must be an existing company.
async function readCompanyChoice(value) {
  const id = String(value ?? "").trim()
  if (!id || id === "none") return { companyId: null, company: null }
  if (!/^[a-f0-9]{24}$/i.test(id)) return { error: "That company is not available." }
  const company = await Company.findById(id).select("_id name")
  return company ? { companyId: company._id, company } : { error: "That company is not available." }
}

async function companyNames(ids) {
  const wanted = [...new Set(ids.filter(Boolean).map(String))]
  const companies = wanted.length ? await Company.find({ _id: { $in: wanted } }).select("name") : []
  return new Map(companies.map((company) => [String(company._id), company.name]))
}

propertiesRouter.get(
  "/",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const filter = propertyFilter(req.user)
    if (req.query.stage) filter.stage = req.query.stage
    if (req.query.important === "1") filter.health = "Needs attention"
    const query = Property.find(filter)
    if (req.query.q) {
      const expression = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      query.where({ $or: [{ address: expression }, { city: expression }, { ownerEntity: expression }] })
    }
    const items = orderProperties(await query)
    if (req.user.role === "contractor") {
      res.json({ items: items.map((item) => presentProperty(item, req.user)) })
      return
    }
    const [loans, companies] = await Promise.all([
      Loan.find({ propertyId: { $in: items.map((item) => item._id) } }).select("propertyId status balance payment"),
      companyNames(items.map((item) => item.companyId)),
    ])
    res.json({
      items: items.map((item) => {
        const summary = loanSummary(loans.filter((loan) => String(loan.propertyId) === String(item._id)))
        const companyId = item.companyId ? String(item.companyId) : ""
        return { ...presentProperty(item, req.user), company: companies.get(companyId) || "", loanStatus: summary.status, loanBalance: summary.balance }
      }),
    })
  }),
)

const COMP_TEXT = ["address", "city", "saleDate", "purchaseDate", "zillowUrl", "notes"]
const COMP_NUMBERS = ["salePrice", "purchasePrice", "beds", "baths", "sqft"]

function compFields(body) {
  const fields = {}
  for (const key of COMP_TEXT) {
    if (key in body) fields[key] = String(body[key] ?? "").trim().slice(0, key === "notes" ? 1000 : 300)
  }
  for (const key of COMP_NUMBERS) {
    if (!(key in body)) continue
    const raw = String(body[key] ?? "").replace(/[$,\s]/g, "")
    if (!raw) {
      fields[key] = undefined
      continue
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return { error: `Enter a valid number for ${key === "salePrice" ? "sale price" : key === "purchasePrice" ? "purchase price" : key}.` }
    fields[key] = value
  }
  for (const key of ["saleDate", "purchaseDate"]) {
    if (fields[key] && !/^\d{4}-\d{2}-\d{2}$/.test(fields[key])) return { error: "Dates need to be in YYYY-MM-DD form." }
  }
  if (fields.zillowUrl && !/^https:\/\/(www\.)?zillow\.com\//i.test(fields.zillowUrl)) return { error: "The Zillow link needs to start with https://www.zillow.com/." }
  if ("include" in body) fields.include = Boolean(body.include)
  return { fields }
}

async function loadForComps(req, res) {
  const property = /^[a-f0-9]{24}$/.test(String(req.params.id)) ? await Property.findById(req.params.id) : null
  if (!property || !ownsProperty(req.user, property)) {
    sendError(res, 404, "That property is not available.")
    return null
  }
  return property
}

async function placeComp(comp, property) {
  const spot = await geocode(comp.address, comp.city || property.city)
  comp.lat = spot?.lat
  comp.lng = spot?.lng
}

propertiesRouter.get(
  "/:id/location",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const property = await loadForComps(req, res)
    if (!property) return
    if (property.lat == null || property.lng == null) {
      const spot = await geocode(property.address, property.city)
      if (spot) {
        await Property.updateOne({ _id: property._id }, { $set: { lat: spot.lat, lng: spot.lng } }, { timestamps: false })
        property.lat = spot.lat
        property.lng = spot.lng
      }
    }
    const missing = (property.comps || []).filter((comp) => comp.lat == null || comp.lng == null).slice(0, 10)
    for (const comp of missing) {
      const spot = await geocode(comp.address, comp.city || property.city)
      if (!spot) continue
      await Property.updateOne({ _id: property._id, "comps._id": comp._id }, { $set: { "comps.$.lat": spot.lat, "comps.$.lng": spot.lng } }, { timestamps: false })
      comp.lat = spot.lat
      comp.lng = spot.lng
    }
    res.json({
      subject: property.lat != null ? { lat: property.lat, lng: property.lng } : null,
      comps: (property.comps || []).map((comp) => ({ id: String(comp._id), lat: comp.lat ?? null, lng: comp.lng ?? null })),
    })
  }),
)

propertiesRouter.post(
  "/:id/comps",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await loadForComps(req, res)
    if (!property) return
    const { fields, error } = compFields(req.body)
    if (error) return sendError(res, 400, error)
    if (!fields.address) return sendError(res, 400, "Enter the comp's address.")
    if ((property.comps || []).length >= 25) return sendError(res, 400, "A property can have up to 25 comps.")
    property.comps.push(fields)
    const comp = property.comps[property.comps.length - 1]
    await placeComp(comp, property)
    property.compsUpdatedAt = new Date()
    await property.save()
    await recordActivity({ user: req.user, title: "Comp added", detail: `${property.address}: ${comp.address}${comp.salePrice ? ` sold for $${comp.salePrice.toLocaleString("en-US")}` : ""}`, propertyId: property._id })
    res.status(201).json({ property: presentProperty(property, req.user) })
  }),
)

// Saves an Agent ARV analysis to the ARV tab: the comps it used (any not there yet), how each was adjusted, and the
// ARV (the average of their adjusted prices, rounded to the nearest thousand). Missing size and rooms are filled in.
propertiesRouter.post(
  "/:id/arv-analysis",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await loadForComps(req, res)
    if (!property) return
    const incoming = (Array.isArray(req.body.comps) ? req.body.comps : []).slice(0, 12)
    const key = (address) => String(address || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    const have = new Set((property.comps || []).map((comp) => key(comp.address)))
    const prices = []
    let added = 0
    for (const raw of incoming) {
      const adjusted = Number(raw?.adjustedPrice)
      if (Number.isFinite(adjusted) && adjusted > 0) prices.push(adjusted)
      if (have.has(key(raw?.address)) || (property.comps || []).length >= 25) continue
      const url = String(raw?.url || "")
      const notes = [
        "From the Agent's ARV analysis",
        (raw?.adjustments || []).length ? `adjusted ${(raw.adjustments || []).map((item) => `${item.amount < 0 ? "-" : "+"}$${Math.abs(Number(item.amount) || 0).toLocaleString("en-US")} (${item.label})`).join(", ")}, used $${Math.round(adjusted).toLocaleString("en-US")}` : "no adjustment",
        raw?.distanceMiles != null ? `${raw.distanceMiles} mi away` : "",
        raw?.note || "",
        url && !/zillow\.com/i.test(url) ? url : "",
      ].filter(Boolean).join(" · ")
      const { fields, error } = compFields({
        address: raw?.address,
        city: raw?.city || property.city || "",
        salePrice: raw?.salePrice ?? "",
        saleDate: /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.saleDate || "")) ? raw.saleDate : "",
        beds: raw?.beds ?? "",
        baths: raw?.baths ?? "",
        sqft: raw?.sqft ?? "",
        zillowUrl: /^https:\/\/(www\.)?zillow\.com\//i.test(url) ? url : "",
        notes,
        include: true,
      })
      if (error || !fields.address) continue
      property.comps.push(fields)
      await placeComp(property.comps[property.comps.length - 1], property)
      have.add(key(fields.address))
      added += 1
    }
    if (!prices.length) return sendError(res, 400, "There are no comps with a price to save.")
    const subject = req.body.subject || {}
    for (const field of ["sqft", "beds", "baths"]) {
      const value = Number(subject[field])
      if (property[field] == null && Number.isFinite(value) && value > 0) property[field] = value
    }
    property.arv = Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length / 1000) * 1000
    property.arvMethod = `Agent ARV analysis: average of ${prices.length} adjusted comps (team ARV rules)`
    property.arvDate = teamToday()
    property.compsUpdatedAt = new Date()
    property.updatedBy = req.user.name
    await property.save()
    await recordActivity({ user: req.user, title: "ARV saved from the Agent", detail: `${property.address}: $${property.arv.toLocaleString("en-US")} from ${prices.length} comps${added ? `, ${added} added to the ARV tab` : ""}`, propertyId: property._id })
    res.json({ property: presentProperty(property, req.user), added, arv: property.arv })
  }),
)

propertiesRouter.patch(
  "/:id/comps/:compId",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await loadForComps(req, res)
    if (!property) return
    const comp = property.comps.id(req.params.compId)
    if (!comp) return sendError(res, 404, "That comp is not on this property.")
    const { fields, error } = compFields(req.body)
    if (error) return sendError(res, 400, error)
    if ("address" in fields && !fields.address) return sendError(res, 400, "Enter the comp's address.")
    const moved = ("address" in fields && fields.address !== comp.address) || ("city" in fields && fields.city !== comp.city)
    comp.set(fields)
    if (moved) await placeComp(comp, property)
    property.compsUpdatedAt = new Date()
    await property.save()
    await recordActivity({ user: req.user, title: "Comp updated", detail: `${property.address}: ${comp.address}`, propertyId: property._id })
    res.json({ property: presentProperty(property, req.user) })
  }),
)

propertiesRouter.delete(
  "/:id/comps/:compId",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await loadForComps(req, res)
    if (!property) return
    const comp = property.comps.id(req.params.compId)
    if (!comp) return sendError(res, 404, "That comp is not on this property.")
    const files = await DocumentFile.find({ _id: { $in: comp.photoFileIds || [] }, kind: "comp" })
    await Promise.all(files.map((file) => deleteStoredFile(file).catch(() => {})))
    await DocumentFile.deleteMany({ _id: { $in: files.map((file) => file._id) } })
    const address = comp.address
    comp.deleteOne()
    property.compsUpdatedAt = new Date()
    await property.save()
    await recordActivity({ user: req.user, title: "Comp removed", detail: `${property.address}: ${address}`, propertyId: property._id })
    res.json({ property: presentProperty(property, req.user) })
  }),
)

propertiesRouter.post(
  "/:id/comps/:compId/photos",
  requirePermission("properties.write"),
  upload.array("photos", 12),
  asyncHandler(async (req, res) => {
    const property = await loadForComps(req, res)
    if (!property) return
    const comp = property.comps.id(req.params.compId)
    if (!comp) return sendError(res, 404, "That comp is not on this property.")
    const images = (req.files || []).filter((file) => /^image\/(jpeg|png|webp|gif|heic|avif)$/i.test(file.mimetype || ""))
    if (!images.length) return sendError(res, 400, "Choose at least one photo (JPG, PNG, WEBP or HEIC).")
    if ((comp.photoFileIds || []).length + images.length > 20) return sendError(res, 400, "A comp can have up to 20 photos.")
    for (const file of images) {
      const saved = await saveUploadedFile(file, req.user, { propertyId: property._id, kind: "comp" })
      comp.photoFileIds.push(saved._id)
    }
    property.compsUpdatedAt = new Date()
    await property.save()
    res.status(201).json({ property: presentProperty(property, req.user) })
  }),
)

propertiesRouter.delete(
  "/:id/comps/:compId/photos/:fileId",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await loadForComps(req, res)
    if (!property) return
    const comp = property.comps.id(req.params.compId)
    if (!comp) return sendError(res, 404, "That comp is not on this property.")
    const keep = (comp.photoFileIds || []).filter((id) => String(id) !== String(req.params.fileId))
    if (keep.length === (comp.photoFileIds || []).length) return sendError(res, 404, "That photo is not on this comp.")
    comp.photoFileIds = keep
    const file = await DocumentFile.findOne({ _id: req.params.fileId, kind: "comp" })
    if (file) {
      await deleteStoredFile(file).catch(() => {})
      await file.deleteOne()
    }
    property.compsUpdatedAt = new Date()
    await property.save()
    res.json({ property: presentProperty(property, req.user) })
  }),
)

propertiesRouter.put(
  "/order",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const wanted = (Array.isArray(req.body.ids) ? req.body.ids : []).map(String).filter((id) => /^[a-f0-9]{24}$/.test(id))
    if (!wanted.length) {
      sendError(res, 400, "Send the properties in their new order.")
      return
    }
    const all = orderProperties(await Property.find(propertyFilter(req.user)).select("_id address position createdAt"))
    const byId = new Map(all.map((property) => [String(property._id), property]))
    const seen = new Set()
    const ordered = []
    for (const id of wanted) {
      if (byId.has(id) && !seen.has(id)) {
        seen.add(id)
        ordered.push(byId.get(id))
      }
    }
    for (const property of all) if (!seen.has(String(property._id))) ordered.push(property)
    const changes = ordered
      .map((property, index) => ({ property, index }))
      .filter(({ property, index }) => property.position !== index)
    if (changes.length) {
      await Property.bulkWrite(changes.map(({ property, index }) => ({ updateOne: { filter: { _id: property._id }, update: { $set: { position: index } }, timestamps: false } })))
      await recordActivity({ user: req.user, title: "Properties reordered", detail: `New order starts with ${ordered.slice(0, 3).map((property) => property.address).join(", ")}` })
      const users = await User.find().select("_id")
      emitToUsers(users.map((user) => String(user._id)), "properties:reordered", { ids: ordered.map((property) => String(property._id)) })
    }
    res.json({ ids: ordered.map((property) => String(property._id)) })
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
    // Same figures as the Draws page: money pulled on funded and part-funded draws, and the property's own budget first.
    const received = draws.reduce((total, draw) => total + drawPulled(draw), 0)
    const schedule = resolveBudget({ rehabBudget: property.rehabBudget, recordBudget: budgets.find((item) => Number(item.budget) > 0)?.budget, scopeLines: property.scopeLines || [], draws }).budget || 0
    const internal = req.user.role !== "contractor"
    if (internal) await ensureLenders()
    const [expenseDocs, requestDocs, photos, people, loans, bills, company] = await Promise.all([
      req.permissions.includes("expenses.read") ? Expense.find({ propertyId: property._id }).sort({ createdAt: -1 }) : [],
      req.permissions.includes("expenses.read") ? ExpenseRequest.find({ propertyId: property._id }).sort({ createdAt: -1 }) : [],
      DocumentFile.find({ propertyId: property._id, kind: "photo" }).sort({ createdAt: -1 }),
      User.find({ _id: { $in: property.assignedUserIds || [] } }).select("name email"),
      internal ? Loan.find({ propertyId: property._id }) : [],
      internal && req.permissions.includes("expenses.read") ? Bill.find({ propertyId: property._id, status: { $ne: "Paid" } }).sort({ due: 1 }) : [],
      internal && property.companyId ? Company.findById(property.companyId).select("name entityType stateOfFormation") : null,
    ])
    if (!internal) {
      const ownRequests = new Set(requestDocs.filter((item) => String(item.requestedBy) === String(req.user._id)).map((item) => String(item._id)))
      res.json({
        property: presentProperty(property, req.user),
        photos: photos.map(presentPhoto),
        // Same rule as the Expenses page: a contractor sees only costs that came from their own requests.
        expenses: await withProofUrls(expenseDocs.filter((item) => (item.drawId || item.scopeLineId) && ownRequests.has(String(item.requestId || ""))).map(presentCost)),
        requests: await withProofUrls(requestDocs.filter((item) => String(item.requestedBy) === String(req.user._id)).map(presentCost)),
        draws: canDraws ? { items: draws.map(presentContractorDraw) } : null,
      })
      return
    }
    res.json({
      property: presentProperty(property, req.user),
      company: company ? { id: String(company._id), name: company.name, entityType: company.entityType || "", stateOfFormation: company.stateOfFormation || "" } : null,
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
        // A total kept on the draw budget record (from a draw sheet import) when the property has none of its own.
        recordBudget: Number(budgets.find((item) => Number(item.budget) > 0)?.budget) || null,
        undrawn: schedule ? Math.max(0, schedule - received) : null,
        items: draws.map(presentDraw),
      } : null,
    })
  }),
)

propertiesRouter.post(
  "/",
  requirePermission("properties.write"),
  upload.array("photos", 60),
  asyncHandler(async (req, res) => {
    const parsed = writable.safeParse({ ...req.body, purchasePrice: numberOrNull(req.body.purchasePrice), arv: numberOrNull(req.body.arv), rehabBudget: numberOrNull(req.body.rehabBudget), houseBoughtPrice: numberOrNull(req.body.houseBoughtPrice), actualRent: numberOrNull(req.body.actualRent), marketRent: numberOrNull(req.body.marketRent) })
    if (!parsed.success) {
      sendError(res, 400, "A property needs an address.")
      return
    }
    const choice = await readCompanyChoice(req.body.companyId)
    if (choice.error) {
      sendError(res, 404, choice.error)
      return
    }
    const scopeLines = parseList(req.body.scopeLines).flatMap((line) => {
      const next = scopeLineFrom(line)
      return next ? [next] : []
    })
    const property = await Property.create({
      ...parsed.data,
      companyId: choice.companyId || undefined,
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
      for (const person of people) await notifyPropertyAccess({ actor: req.user, person, properties: [property] })
    }
    const photos = []
    for (const file of req.files || []) {
      photos.push(await saveUploadedFile(file, req.user, { propertyId: property._id, kind: "photo" }))
    }
    if (photos.length) {
      await PhotoSet.create({
        propertyId: property._id,
        weekOf: teamToday(),
        fileIds: photos.map((file) => file._id),
        uploadedBy: req.user._id,
        note: "Added with the property",
      })
    }
    await recordActivity({ user: req.user, title: "Property added", detail: [property.address, choice.company ? `in ${choice.company.name}` : ""].filter(Boolean).join(" · "), propertyId: property._id })
    res.status(201).json({ property: presentProperty(property, req.user) })
  }),
)

propertiesRouter.patch(
  "/:id",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await Property.findById(req.params.id)
    if (!property || !ownsProperty(req.user, property)) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const parsed = writable.partial().safeParse(req.body)
    if (!parsed.success) {
      sendError(res, 400, "Those property details could not be saved.")
      return
    }
    if (!req.permissions.includes("internal.pricing")) delete parsed.data.houseBoughtPrice
    let companyChange = ""
    if ("companyId" in req.body && req.user.role !== "contractor") {
      const choice = await readCompanyChoice(req.body.companyId)
      if (choice.error) {
        sendError(res, 404, choice.error)
        return
      }
      const current = property.companyId ? String(property.companyId) : ""
      const next = choice.companyId ? String(choice.companyId) : ""
      if (current !== next) {
        const names = await companyNames([current])
        companyChange = `Company ${names.get(current) || "none"} → ${choice.company?.name || "none"}`
        property.companyId = choice.companyId || undefined
      }
    }
    const before = property.toObject()
    Object.assign(property, parsed.data, { updatedBy: req.user.name })
    // An ARV typed over one from comps or the Agent is no longer that analysis.
    if ("arv" in parsed.data && parsed.data.arv !== before.arv && !("arvMethod" in parsed.data)) {
      property.arvMethod = parsed.data.arv == null ? undefined : "Entered by hand"
      property.arvDate = parsed.data.arv == null ? undefined : teamToday()
    }
    // Removing the rehab budget removes it everywhere: a copy kept on the draw budget record (from a draw sheet
    // import or when lender funding was first set) would otherwise keep showing as the budget. Only when a budget
    // is really being removed (a form that just leaves the field empty does not touch the draw record).
    if ("rehabBudget" in req.body && parsed.data.rehabBudget == null && (before.rehabBudget != null || req.body.clearDrawBudget === true)) {
      await DrawBudget.updateMany({ propertyId: property._id, budget: { $ne: null } }, { $unset: { budget: 1 } })
    }
    if (("address" in parsed.data && parsed.data.address !== before.address) || ("city" in parsed.data && parsed.data.city !== before.city)) {
      property.lat = undefined
      property.lng = undefined
    }
    if ("labels" in req.body) property.labels = cleanLabelList(parseList(req.body.labels))
    if ("scopeLines" in req.body) {
      const kept = new Map((property.scopeLines || []).map((line) => [String(line._id), line]))
      property.scopeLines = parseList(req.body.scopeLines).flatMap((line) => {
        const next = scopeLineFrom(line, true)
        return next ? [{ ...lineTracking(next._id && kept.get(String(next._id))), ...next }] : []
      })
    }
    await property.save()
    const after = property.toObject()
    const changes = [
      changeSummary(before, after, PROPERTY_FIELDS),
      companyChange,
      before.houseBoughtPrice !== after.houseBoughtPrice ? "Internal pricing changed" : "",
      "scopeLines" in req.body ? `Scope of work now ${after.scopeLines.length} lines` : "",
    ].filter(Boolean).join(" · ")
    await recordActivity({ user: req.user, title: "Property updated", detail: changes || "Saved with no changes", propertyId: property._id })
    res.json({ property: presentProperty(property, req.user) })
  }),
)

// The BRRRR refinance stage (one stage per property: the Financing tab, the banner and the Properties list all read it).
// Marking it Refinanced marks the loans still open Paid off; the new loan is then added with Add loan. Moving it back
// from Refinanced puts those loans back the way they were.
propertiesRouter.patch(
  "/:id/refinance",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await Property.findById(req.params.id)
    if (!property || !ownsProperty(req.user, property)) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const stage = String(req.body?.stage || "")
    if (!REFINANCE.stages.includes(stage)) {
      sendError(res, 400, `Choose ${REFINANCE.stages.join(", ")}.`)
      return
    }
    if (!REFINANCE.readyStages.includes(property.stage)) {
      sendError(res, 400, `Not ready for refinance: the property is ${property.stage || "not set"}. Refinancing starts once it is ${REFINANCE.readyStages.join(", ").replace(/, ([^,]*)$/, " or $1")}.`)
      return
    }
    const before = REFINANCE.stages.includes(property.refinanceStage) ? property.refinanceStage : REFINANCE.stages[0]
    const name = (loan) => [loan.lender && loan.lender !== "Not provided" ? loan.lender : "Loan", loan.loanNumber ? `#${loan.loanNumber}` : ""].filter(Boolean).join(" ")
    const done = REFINANCE.stages[REFINANCE.stages.length - 1]
    let paidOff = []
    let restored = []
    if (stage === done && before !== done) {
      paidOff = await Loan.find({ propertyId: property._id, status: { $ne: "Paid off" } })
      property.refinanceClosedLoans = paidOff.map((loan) => ({ loanId: loan._id, status: loan.status || "Current" }))
      property.refinanceClosedAt = new Date()
      if (paidOff.length) await Loan.updateMany({ _id: { $in: paidOff.map((loan) => loan._id) } }, { $set: { status: "Paid off" } })
    } else if (stage !== done && before === done) {
      const closed = property.refinanceClosedLoans || []
      const still = closed.length ? await Loan.find({ _id: { $in: closed.map((entry) => entry.loanId) }, status: "Paid off" }) : []
      for (const loan of still) {
        loan.status = closed.find((entry) => String(entry.loanId) === String(loan._id))?.status || "Current"
        await loan.save()
      }
      restored = still
      property.refinanceClosedLoans = []
      property.refinanceClosedAt = undefined
    }
    property.refinanceStage = stage
    property.updatedBy = req.user.name
    await property.save()
    if (before !== stage) {
      await recordActivity({
        user: req.user,
        title: "Refinance updated",
        detail: [`Refinance ${before} → ${stage}`, paidOff.length ? `Paid off: ${paidOff.map(name).join(", ")}` : "", restored.length ? `Back as before: ${restored.map(name).join(", ")}` : ""].filter(Boolean).join(" · "),
        propertyId: property._id,
      })
    }
    res.json({ property: presentProperty(property, req.user), paidOff: paidOff.map((loan) => String(loan._id)), restored: restored.map((loan) => String(loan._id)) })
  }),
)

propertiesRouter.delete(
  "/:id",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const property = await Property.findById(req.params.id)
    if (!property || !ownsProperty(req.user, property)) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const files = await DocumentFile.find({ propertyId: property._id })
    await Promise.all(files.map((file) => deleteStoredFile(file).catch(() => {})))
    const room = await removePropertyRoom(property)
    await Promise.all(room.files.map((file) => deleteStoredFile(file).catch(() => {})))
    if (room.channelId) emitToUsers(room.userIds, "channel:remove", { id: room.channelId })
    if (room.channelId) recheckCalls(room.channelId).catch((error) => console.error("Call check failed", error))
    await Promise.all([
      Loan.deleteMany({ propertyId: property._id }),
      Draw.deleteMany({ propertyId: property._id }),
      DrawBudget.deleteMany({ propertyId: property._id }),
      Expense.deleteMany({ propertyId: property._id }),
      ExpenseRequest.deleteMany({ propertyId: property._id }),
      Task.deleteMany({ propertyId: property._id }),
      Bill.deleteMany({ propertyId: property._id }),
      ReviewItem.deleteMany({ propertyId: property._id }),
      PhotoSet.deleteMany({ propertyId: property._id }),
      DocumentFile.deleteMany({ propertyId: property._id }),
      Activity.deleteMany({ propertyId: property._id }),
      ConstructionProject.deleteMany({ propertyId: property._id }),
      CalendarEvent.updateMany({ propertyId: property._id }, { $unset: { propertyId: 1 } }),
    ])
    await forgetPropertyOnReceipts(property._id)
    await property.deleteOne()
    await recordActivity({ user: req.user, title: "Property deleted", detail: property.address })
    res.json({ ok: true })
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
    // The old "Not provided" placeholder lender counts as no lender.
    const found = byId.get(String(loan.lenderId || ""))
    const lender = found && found.name !== "Not provided" ? found : null
    return {
      id: String(loan._id),
      lenderId: lender ? String(lender._id) : "",
      lender: lender?.name || (loan.lender && loan.lender !== "Not provided" ? loan.lender : "No lender"),
      lenderTerms: lender?.terms || "",
      label: loan.label || "Financed",
      terms: loan.terms || "",
      loanNumber: loan.loanNumber || "",
      balance: loan.balance ?? null,
      payment: loan.payment ?? null,
      maturity: loan.maturity || "",
      termsStatus: loan.termsStatus || "",
      ...loanFields(loan),
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
  // "250,000" and "$400,000" are numbers too.
  const number = Number(String(value).replace(/[$,\s]/g, ""))
  return Number.isFinite(number) ? number : null
}
