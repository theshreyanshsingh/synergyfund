import { AGENT_DEFAULTS, RECEIPT_CATEGORIES, RECEIPT_MAX_ITEMS, fromCents, toCents } from "@synergifund/shared"
import { AgentSetting, DocumentFile, Receipt } from "../models/index.js"
import { chat, modelKey } from "./agent/llm.js"
import { readStoredFile } from "./files.js"
import { teamToday } from "../lib/dates.js"

// Reads a photographed or uploaded receipt into its store, date, items (each with a category), tax and total, with the
// workspace's decision model (the default one if that model cannot read pictures). The buyer checks and corrects
// everything before it is filed, so this only fills the form in.

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
// What the AI models take per picture; the app's camera makes photos well under this.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PDF_BYTES = 15 * 1024 * 1024
// A reading that never finished (the server restarted mid-way) counts as failed after this long.
export const READ_STALE_MS = 4 * 60 * 1000

const SYSTEM = `You read photos and scans of store receipts and invoices for a real estate renovation company. Contractors buy materials for houses being renovated; your reading fills in a form they check before filing it.

Answer with JSON only, in this shape:
{"readable": true, "vendor": "", "date": "", "items": [{"description": "", "quantity": null, "amount": 0, "category": ""}], "tax": 0, "total": null, "note": ""}

- vendor: the store or company name as printed (for example "The Home Depot", "Lowe's", "Ferguson").
- date: the purchase date as YYYY-MM-DD, or "" if it cannot be read.
- items: one entry per purchased line, in the order printed.
  - amount: what the line cost in total (quantity times unit price), after any discount printed for that line. A discount on the whole receipt is its own item with a negative amount. A returned item has a negative amount.
  - Fees that are part of the purchase (delivery, bag fee, environmental or recycling fee, core charge, rental) are items.
  - Leave out the subtotal, every tax line, the total, payment lines (card, cash, change, balance due, tender), loyalty points, savings summaries and lines of $0.00.
  - description: what the item is in plain words, at most 60 characters. Expand obvious store abbreviations ("2X4X8 PT" becomes "2x4x8 pressure-treated lumber"). No SKU or item numbers.
  - quantity: the number bought when printed, otherwise null.
  - category: exactly one of: ${RECEIPT_CATEGORIES.join(", ")}. Use "Other" when none fits.
- tax: all sales taxes on the receipt added together; 0 when there is none.
- total: the total charged as printed, or null if it cannot be read.
- note: one short sentence about anything hard to read or worth checking, or "".
- Several pictures are pages or parts of the same receipt: never count a line twice because it shows on two pictures.
- If the picture is not a receipt or invoice, or cannot be read, answer {"readable": false, "items": [], "note": "why"}.
- Numbers are plain numbers: no $ signs or commas.`

export function receiptReadingAvailable() {
  return Boolean(modelKey())
}

async function readingModel() {
  const stored = await AgentSetting.findOne({ key: "org" }).catch(() => null)
  return stored?.decisionModel || AGENT_DEFAULTS.decisionModel
}

function readJson(content) {
  const text = String(content || "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function money(cents) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function shiftDay(day, days) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// The model's answer, made safe and checked: only known categories, amounts in cents, a real date.
export function cleanReading(answer, today = teamToday()) {
  const warnings = []
  if (!answer || typeof answer !== "object") return { ok: false, error: "The AI's answer could not be read. Type the items in, or try reading it again." }
  if (answer.readable === false) {
    const why = String(answer.note || "").trim().slice(0, 200)
    return { ok: false, error: `This doesn't look like a receipt the AI can read${why ? ` (${why.replace(/\.$/, "")})` : ""}. Retake the photo in good light, or type the items in.` }
  }
  const vendor = String(answer.vendor || "").replace(/\s+/g, " ").trim().slice(0, 80)
  let date = String(answer.date || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) date = ""
  if (date && date > shiftDay(today, 1)) {
    warnings.push(`The date read was ${date}, which is in the future. Check it.`)
    date = ""
  }
  const items = []
  for (const raw of Array.isArray(answer.items) ? answer.items.slice(0, RECEIPT_MAX_ITEMS) : []) {
    const cents = toCents(raw?.amount)
    if (cents == null || Number.isNaN(cents) || cents === 0) continue
    const description = String(raw?.description || "").replace(/\s+/g, " ").trim().slice(0, 120) || "Item"
    const quantity = Number(raw?.quantity)
    items.push({
      description,
      category: RECEIPT_CATEGORIES.includes(raw?.category) ? raw.category : "Other",
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * 1000) / 1000 : null,
      amount: fromCents(cents),
    })
  }
  if (!items.length) return { ok: false, error: "The AI found no items on this receipt. Type them in, or retake the photo." }
  const taxCents = toCents(answer.tax)
  const tax = taxCents != null && !Number.isNaN(taxCents) && taxCents > 0 ? taxCents : 0
  const totalCents = toCents(answer.total)
  const total = totalCents != null && !Number.isNaN(totalCents) && totalCents > 0 ? totalCents : null
  const itemsCents = items.reduce((sum, item) => sum + toCents(item.amount), 0)
  if (total != null && Math.abs(itemsCents + tax - total) > 1) warnings.push(`The items and tax add up to ${money(itemsCents + tax)}, but the receipt's total is ${money(total)}. Check the amounts.`)
  if (!vendor) warnings.push("The store's name could not be read. Enter it.")
  if (!date) warnings.push("The date could not be read. Check it.")
  const note = String(answer.note || "").replace(/\s+/g, " ").trim().slice(0, 200)
  if (note) warnings.push(note)
  return { ok: true, vendor, date, items, tax: fromCents(tax), total: total == null ? null : fromCents(total), warnings }
}

async function pictureParts(fileIds) {
  const files = await DocumentFile.find({ _id: { $in: fileIds } })
  const order = new Map(fileIds.map((id, index) => [String(id), index]))
  files.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0))
  const parts = []
  const skipped = []
  for (const file of files) {
    const mime = String(file.mime || "").toLowerCase()
    const pdf = mime === "application/pdf" || /\.pdf$/i.test(file.name || "")
    if (!pdf && !IMAGE_TYPES.has(mime)) {
      skipped.push(`${file.name || "A file"} is not a JPEG, PNG or PDF, so the AI could not read it.`)
      continue
    }
    if ((file.size || 0) > (pdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
      skipped.push(`${file.name || "A file"} is too large for the AI to read.`)
      continue
    }
    const data = Buffer.from(await readStoredFile(file)).toString("base64")
    parts.push(pdf
      ? { type: "file", file: { filename: (file.name || "receipt.pdf").replace(/[^\w.\- ]+/g, "") || "receipt.pdf", file_data: `data:application/pdf;base64,${data}` } }
      : { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } })
  }
  return { parts, skipped }
}

// Reads the receipt's pictures. Returns { ok, ... } like cleanReading, plus the model used.
export async function readReceiptFiles(fileIds) {
  if (!receiptReadingAvailable()) return { ok: false, error: "Receipt reading needs an AI model. An admin can add OPENROUTER_API_KEY to the server settings. Type the items in for now." }
  const { parts, skipped } = await pictureParts(fileIds)
  if (!parts.length) return { ok: false, error: skipped[0] || "There is no picture to read. Type the items in." }
  const today = teamToday()
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: [{ type: "text", text: `Read this receipt (${parts.length} ${parts.length === 1 ? "picture" : "pictures"}). Today is ${today}.` }, ...parts] },
  ]
  const preferred = await readingModel()
  const models = [...new Set([preferred, AGENT_DEFAULTS.decisionModel])]
  let lastError = null
  for (const model of models) {
    try {
      const answer = await chat({ model, messages, temperature: 0, maxTokens: 8000, timeoutMs: 90000 })
      const result = cleanReading(readJson(answer.content), today)
      if (skipped.length && result.ok) result.warnings.push(...skipped)
      return { ...result, model }
    } catch (error) {
      lastError = error
      console.error(`Receipt reading with ${model} failed`, error.message)
    }
  }
  return { ok: false, error: `The receipt could not be read (${lastError?.message || "no answer"}). Try again, or type the items in.` }
}

// Reads a draft receipt in the background and fills it in, unless the buyer started typing it in meanwhile.
export function readReceiptInBackground(receiptId) {
  ;(async () => {
    const receipt = await Receipt.findById(receiptId)
    if (!receipt) return
    let result
    try {
      result = await readReceiptFiles(receipt.fileIds || [])
    } catch (error) {
      result = { ok: false, error: `The receipt could not be read (${error.message}). Type the items in.` }
    }
    const update = result.ok
      ? {
        vendor: result.vendor,
        date: result.date,
        tax: result.tax,
        printedTotal: result.total,
        items: result.items.map((item) => ({ ...item, propertyId: "", split: undefined })),
        read: { status: "done", model: result.model, error: "", at: new Date(), warnings: result.warnings },
      }
      : { read: { status: "failed", model: result.model || "", error: result.error, at: new Date(), warnings: [] } }
    // Only a draft still waiting for this reading takes it (not one typed in by hand meanwhile, or already filed).
    await Receipt.updateOne({ _id: receiptId, status: "Draft", "read.status": "reading" }, { $set: update })
  })().catch((error) => console.error("Receipt reading failed", error))
}
