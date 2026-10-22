import { Router } from "express"
import { PAYING_ENTITIES, RECEIPT_CATEGORIES, RECEIPT_MAX_ITEMS, SALES_TAX, documentType, fromCents, receiptPlan } from "@synergifund/shared"
import { DocumentFile, Expense, ExpenseRequest, Property, Receipt, User } from "../models/index.js"
import { asyncHandler, requireAnyPermission, sendError } from "../lib/http.js"
import { propertyFilter } from "../services/access.js"
import { deleteStoredFile, saveUploadedFile, upload, withProofUrls } from "../services/files.js"
import { notify, recordActivity } from "../services/notify.js"
import { READ_STALE_MS, readReceiptInBackground, receiptReadingAvailable } from "../services/receiptReader.js"
import { refreshRehabRemaining } from "./draws.js"

// Receipts: a contractor (or someone in the office) photographs or uploads a receipt, the AI reads it, they check the
// items and choose the property (or split it between several), and Submit files each property's part. Contractors'
// parts wait for approval like any expense request; someone who approves expenses posts them straight to the books.

export const receiptsRouter = Router()

const MAX_FILES = 6
const ID = /^[a-f0-9]{24}$/i
const ACCEPTED = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/i

receiptsRouter.use(requireAnyPermission("expenses.submit", "expenses.approve"))

const posts = (req) => req.permissions.includes("expenses.approve")

function receiveReceipt(req, res, next) {
  upload.array("files", MAX_FILES)(req, res, (error) => {
    if (!error) return next()
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Each photo or PDF can be up to 20 MB."
      : error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "LIMIT_FILE_COUNT"
        ? `Add up to ${MAX_FILES} photos or PDFs per receipt.`
        : "The upload could not be read."
    sendError(res, 400, message)
  })
}

function readState(source) {
  const read = source.read || {}
  if (read.status === "reading" && read.at && Date.now() - new Date(read.at).getTime() > READ_STALE_MS) {
    return { status: "failed", error: "Reading the receipt took too long. Try again, or type the items in.", warnings: [], model: read.model || "" }
  }
  return { status: read.status || "skipped", error: read.error || "", warnings: read.warnings || [], model: read.model || "" }
}

async function presentReceipt(receipt) {
  const source = receipt.toObject ? receipt.toObject() : receipt
  const view = {
    id: String(source._id),
    status: source.status,
    vendor: source.vendor || "",
    date: source.date || "",
    tax: source.tax ?? null,
    printedTotal: source.printedTotal ?? null,
    entity: source.entity || "Construction company",
    note: source.note || "",
    items: (source.items || []).map((item) => ({
      description: item.description || "",
      category: item.category || "Other",
      quantity: item.quantity ?? null,
      amount: item.amount ?? null,
      propertyId: item.propertyId || "",
      split: item.split?.mode ? { mode: item.split.mode, parts: (item.split.parts || []).map((part) => ({ propertyId: part.propertyId || "", value: part.value ?? "" })) } : null,
    })),
    propertyIds: (source.propertyIds || []).map(String),
    fileIds: (source.fileIds || []).map(String),
    read: readState(source),
    boughtBy: source.boughtBy ? String(source.boughtBy) : "",
    boughtByName: source.boughtByName || "",
    createdBy: String(source.createdBy),
    submittedAt: source.submittedAt || null,
    totalCents: source.totalCents ?? null,
    requestIds: (source.requestIds || []).map(String),
    expenseIds: (source.expenseIds || []).map(String),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
  const withUrls = await withProofUrls({ proofFileIds: view.fileIds })
  return { ...view, fileUrls: withUrls.proofUrls }
}

// A receipt this person may open: their own; or, for staff who see expenses, any filed one.
async function visibleReceipt(req, id) {
  if (!ID.test(String(id || ""))) return null
  const receipt = await Receipt.findById(id)
  if (!receipt) return null
  if (String(receipt.createdBy) === String(req.user._id)) return receipt
  if (req.user.role !== "contractor" && req.permissions.includes("expenses.read") && receipt.status === "Submitted") return receipt
  return null
}

async function ownDraft(req, res) {
  const receipt = ID.test(String(req.params.id || "")) ? await Receipt.findById(req.params.id) : null
  if (!receipt || String(receipt.createdBy) !== String(req.user._id)) {
    sendError(res, 404, "That receipt is not available.")
    return null
  }
  if (receipt.status !== "Draft") {
    sendError(res, 400, "That receipt is already filed.")
    return null
  }
  return receipt
}

function text(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function validDate(value) {
  const day = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ""
  const date = new Date(`${day}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : ""
}

function numberOrNull(value) {
  if (value === "" || value == null) return null
  const number = Number(String(value).replace(/[$,\s]/g, ""))
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null
}

function cleanItems(list) {
  return (Array.isArray(list) ? list : []).slice(0, RECEIPT_MAX_ITEMS).map((item) => {
    const mode = item?.split?.mode === "percent" ? "percent" : item?.split?.mode === "amount" ? "amount" : ""
    const parts = mode ? (Array.isArray(item.split.parts) ? item.split.parts : []).slice(0, 20).filter((part) => ID.test(String(part?.propertyId || ""))).map((part) => ({ propertyId: String(part.propertyId), value: text(part.value, 20) })) : []
    const quantity = Number(item?.quantity)
    return {
      description: text(item?.description, 200),
      category: RECEIPT_CATEGORIES.includes(item?.category) || item?.category === SALES_TAX ? item.category : "Other",
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      amount: numberOrNull(item?.amount),
      propertyId: ID.test(String(item?.propertyId || "")) ? String(item.propertyId) : "",
      split: mode ? { mode, parts } : undefined,
    }
  })
}

// Properties this person can file on, from the ids asked for (in that order).
async function allowedProperties(req, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((id) => ID.test(id)))].slice(0, 50)
  if (!wanted.length) return { wanted, found: [] }
  const found = await Property.find({ _id: { $in: wanted }, ...propertyFilter(req.user) }).select("address city")
  const byId = new Map(found.map((property) => [String(property._id), property]))
  return { wanted, found: wanted.map((id) => byId.get(id)).filter(Boolean) }
}

// Takes what the form sends (all of it, every time) into the draft.
async function applyDraft(req, receipt, body) {
  if ("vendor" in body) receipt.vendor = text(body.vendor, 80)
  if ("date" in body) receipt.date = validDate(body.date)
  if ("tax" in body) receipt.tax = numberOrNull(body.tax) ?? undefined
  if ("entity" in body && PAYING_ENTITIES.includes(body.entity)) receipt.entity = body.entity
  if ("note" in body) receipt.note = text(body.note, 500)
  if ("items" in body) receipt.items = cleanItems(body.items)
  if ("propertyIds" in body) {
    const { found } = await allowedProperties(req, body.propertyIds)
    receipt.propertyIds = found.map((property) => property._id)
  }
  // Someone filing for a contractor says who bought it; a contractor always files their own.
  if ("boughtBy" in body && posts(req)) {
    const id = String(body.boughtBy || "")
    const buyer = ID.test(id) ? await User.findOne({ _id: id, bot: { $ne: true } }).select("name") : null
    receipt.boughtBy = buyer ? buyer._id : req.user._id
    receipt.boughtByName = buyer ? buyer.name : req.user.name
  }
  if (body.stopReading === true && receipt.read?.status === "reading") {
    receipt.set("read.status", "manual")
    receipt.set("read.error", "")
  }
}

receiptsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const drafts = await Receipt.find({ createdBy: req.user._id, status: "Draft" }).sort({ updatedAt: -1 }).limit(50)
    const buyers = posts(req) ? await User.find({ bot: { $ne: true } }).select("name role").sort({ name: 1 }) : []
    res.json({
      drafts: await Promise.all(drafts.map(presentReceipt)),
      buyers: buyers.map((person) => ({ id: String(person._id), name: person.name, role: person.role })),
      posts: posts(req),
      readingAvailable: receiptReadingAvailable(),
    })
  }),
)

receiptsRouter.post(
  "/",
  receiveReceipt,
  asyncHandler(async (req, res) => {
    const files = req.files || []
    if (!files.length) return sendError(res, 400, "Take a photo of the receipt, or choose a photo or PDF.")
    const wrong = files.find((file) => !ACCEPTED.test(String(file.mimetype || "")) && !["pdf", "image"].includes(documentType(file.originalname)))
    if (wrong) return sendError(res, 400, `${wrong.originalname || "That file"} is not a photo or PDF.`)
    const saved = []
    try {
      for (const file of files) saved.push(await saveUploadedFile(file, req.user, { kind: "receipt-scan" }))
    } catch (error) {
      await Promise.all(saved.map(async (file) => {
        await deleteStoredFile(file).catch(() => {})
        await file.deleteOne().catch(() => {})
      }))
      throw error
    }
    const reading = receiptReadingAvailable() && req.body.read !== "0"
    const receipt = await Receipt.create({
      createdBy: req.user._id,
      boughtBy: req.user._id,
      boughtByName: req.user.name,
      fileIds: saved.map((file) => file._id),
      entity: "Construction company",
      read: reading ? { status: "reading", at: new Date(), warnings: [] } : { status: receiptReadingAvailable() ? "manual" : "unavailable", at: new Date(), warnings: [], error: receiptReadingAvailable() ? "" : "Receipt reading needs an AI model, so type the items in. An admin can add OPENROUTER_API_KEY to the server settings." },
    })
    if (reading) readReceiptInBackground(receipt._id)
    res.status(201).json({ receipt: await presentReceipt(receipt) })
  }),
)

receiptsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const receipt = await visibleReceipt(req, req.params.id)
    if (!receipt) return sendError(res, 404, "That receipt is not available.")
    const view = await presentReceipt(receipt)
    // A reading that never came back (the server restarted) is marked failed for good.
    if (receipt.read?.status === "reading" && view.read.status === "failed") {
      await Receipt.updateOne({ _id: receipt._id, "read.status": "reading" }, { $set: { "read.status": "failed", "read.error": view.read.error } })
    }
    res.json({ receipt: view })
  }),
)

receiptsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const receipt = await ownDraft(req, res)
    if (!receipt) return
    await applyDraft(req, receipt, req.body || {})
    await receipt.save()
    res.json({ receipt: await presentReceipt(receipt) })
  }),
)

receiptsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const receipt = await ownDraft(req, res)
    if (!receipt) return
    if (!receiptReadingAvailable()) return sendError(res, 400, "Receipt reading needs an AI model. An admin can add OPENROUTER_API_KEY to the server settings.")
    receipt.read = { status: "reading", at: new Date(), warnings: [], error: "", model: "" }
    await receipt.save()
    readReceiptInBackground(receipt._id)
    res.json({ receipt: await presentReceipt(receipt) })
  }),
)

receiptsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const receipt = await ownDraft(req, res)
    if (!receipt) return
    const files = await DocumentFile.find({ _id: { $in: receipt.fileIds || [] }, kind: "receipt-scan" })
    for (const file of files) await deleteStoredFile(file).catch((error) => console.error("Receipt file removal failed", error))
    await DocumentFile.deleteMany({ _id: { $in: files.map((file) => file._id) } })
    await receipt.deleteOne()
    res.json({ ok: true })
  }),
)

function money(cents) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dayLabel(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

receiptsRouter.post(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const receipt = await ownDraft(req, res)
    if (!receipt) return
    await applyDraft(req, receipt, req.body || {})
    if (receipt.read?.status === "reading") receipt.set("read.status", "manual")
    // What was typed is kept even if something below still needs fixing.
    await receipt.save()
    if (!receipt.vendor) return sendError(res, 400, "Enter the store or vendor.")
    if (!receipt.date) return sendError(res, 400, "Enter the date on the receipt.")
    // Every property asked for must be one this person may file on.
    const asked = Array.isArray(req.body?.propertyIds) ? req.body.propertyIds : (receipt.propertyIds || []).map(String)
    const { wanted, found } = await allowedProperties(req, asked)
    if (found.length !== wanted.length) return sendError(res, 403, req.user.role === "contractor" ? "One of those properties is not assigned to you." : "One of those properties is no longer available.")
    const names = Object.fromEntries(found.map((property) => [String(property._id), property.address]))
    const items = receipt.items.map((item) => ({ ...(item.toObject?.() ?? item), split: item.split?.mode ? { mode: item.split.mode, parts: (item.split.parts || []).map((part) => ({ propertyId: part.propertyId, value: part.value })) } : null }))
    const plan = receiptPlan({ items, tax: receipt.tax ?? 0, propertyIds: wanted, names })
    if (plan.errors.length) return sendError(res, 400, plan.errors.join(" "))
    const boughtBy = receipt.boughtBy || req.user._id
    const boughtByName = receipt.boughtByName || req.user.name
    // The same store, day and total filed by the same buyer is most likely the same receipt photographed twice.
    if (req.body?.confirmDuplicate !== true) {
      const vendorPattern = new RegExp(`^${receipt.vendor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
      const twin = await Receipt.findOne({ _id: { $ne: receipt._id }, status: "Submitted", boughtBy, vendor: vendorPattern, date: receipt.date, totalCents: plan.totalCents })
      if (twin) return sendError(res, 409, `A ${money(plan.totalCents)} receipt from ${receipt.vendor} on ${dayLabel(receipt.date)} was already filed${twin.submittedAt ? ` on ${new Date(twin.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}. Submit this one only if it is a different purchase.`)
    }
    // Two quick taps on Submit file it once.
    const claimed = await Receipt.findOneAndUpdate({ _id: receipt._id, status: "Draft" }, { $set: { status: "Submitting" } })
    if (!claimed) return sendError(res, 409, "That receipt is already being filed.")
    const fileIds = receipt.fileIds || []
    const groups = plan.properties.map((entry) => ({ ...entry, property: found.find((property) => String(property._id) === entry.propertyId), lines: plan.lines.filter((line) => line.propertyId === entry.propertyId) }))
    const created = { requests: [], expenses: [] }
    try {
      if (posts(req)) {
        const docs = groups.flatMap((group) => group.lines.map((line) => ({
          propertyId: group.property._id,
          title: line.description,
          amount: fromCents(line.cents),
          category: line.category,
          vendor: receipt.vendor,
          date: receipt.date,
          entity: receipt.entity || "Construction company",
          costTreatment: "Include in construction margin",
          proofFileId: fileIds[0],
          proofFileIds: fileIds,
          postedBy: req.user._id,
          submittedBy: boughtBy,
          submittedByName: boughtByName,
          receiptId: receipt._id,
          lineKind: line.kind,
        })))
        created.expenses = await Expense.insertMany(docs)
      } else {
        for (const group of groups) {
          const itemLines = group.lines.filter((line) => line.kind === "item")
          const byCategory = new Map()
          for (const line of itemLines) byCategory.set(line.category, (byCategory.get(line.category) || 0) + line.cents)
          const category = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Materials"
          created.requests.push(await ExpenseRequest.create({
            propertyId: group.property._id,
            title: itemLines.length === 1 ? `${itemLines[0].description} (${receipt.vendor})` : `${receipt.vendor} receipt · ${itemLines.length} items`,
            amount: fromCents(group.totalCents),
            category,
            vendor: receipt.vendor,
            date: receipt.date,
            entity: receipt.entity || "Construction company",
            costTreatment: "Include in construction margin",
            status: "Submitted",
            proofFileId: fileIds[0],
            proofFileIds: fileIds,
            note: receipt.note || "",
            requestedBy: req.user._id,
            receiptId: receipt._id,
            lines: group.lines.map((line) => ({ description: line.description, category: line.category, amount: fromCents(line.cents), kind: line.kind })),
          }))
        }
      }
      receipt.status = "Submitted"
      receipt.submittedAt = new Date()
      receipt.totalCents = plan.totalCents
      receipt.propertyIds = groups.map((group) => group.property._id)
      receipt.requestIds = created.requests.map((request) => request._id)
      receipt.expenseIds = created.expenses.map((expense) => expense._id)
      receipt.boughtBy = boughtBy
      receipt.boughtByName = boughtByName
      await receipt.save()
    } catch (error) {
      await Promise.all([
        created.expenses.length ? Expense.deleteMany({ _id: { $in: created.expenses.map((item) => item._id) } }) : null,
        created.requests.length ? ExpenseRequest.deleteMany({ _id: { $in: created.requests.map((item) => item._id) } }) : null,
      ]).catch(() => {})
      await Receipt.updateOne({ _id: receipt._id }, { $set: { status: "Draft" } }).catch(() => {})
      throw error
    }
    const spread = groups.length > 1 ? ` across ${groups.length} properties` : ` for ${groups[0].property.address}`
    if (posts(req)) {
      for (const group of groups) {
        await refreshRehabRemaining(group.property._id)
        await recordActivity({ user: req.user, title: "Cost added", detail: `${receipt.vendor} receipt · ${money(group.totalCents)} (${plural(group.count, "item")})${String(boughtBy) !== String(req.user._id) ? ` · bought by ${boughtByName}` : ""}`, propertyId: group.property._id })
      }
    } else {
      await notify({
        roles: ["admin", "finance"],
        exceptUserIds: [req.user._id],
        title: "Expense submitted",
        body: `${req.user.name} submitted a receipt from ${receipt.vendor} for ${money(plan.totalCents)}${spread}.`,
        href: "/expenses",
        event: "expense.submitted",
      })
      for (const group of groups) {
        await recordActivity({ user: req.user, title: "Expense submitted", detail: `${receipt.vendor} receipt · ${money(group.totalCents)} (${plural(group.count, "item")})`, propertyId: group.property._id })
      }
    }
    res.json({
      receipt: await presentReceipt(receipt),
      filed: groups.map((group) => ({ propertyId: String(group.property._id), address: group.property.address, totalCents: group.totalCents, items: group.count })),
      posted: posts(req),
    })
  }),
)

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}
