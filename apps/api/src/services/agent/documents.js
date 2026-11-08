import mammoth from "mammoth"
import xlsx from "../../lib/xlsx.js"
import { getDocumentProxy } from "unpdf"
import { AGENT_DEFAULTS, DOCUMENT_TYPES, QUICK_ACCESS, documentType, documentTypeName, folderName, folderOf, labeledDocumentType, quickAccessFiles } from "@synergifund/shared"
import { AgentSetting, Company, DocumentFile, Property } from "../../models/index.js"
import { readStoredFile } from "../files.js"
import { devServer } from "../../lib/runtime.js"
import { budgetState, chat, createMeter, createUsageTracker, modelKey } from "./llm.js"

// The Agent reads every document in the library once, so it can tell what each one is (a Purchase Contract, an ALTA
// settlement statement, a builder's risk policy…) and find exactly the one someone asks for, and opens a document to
// answer from inside it. Reading: the text of a PDF, Word or Excel file is taken out here; a scanned PDF or a picture
// of a document is read by the decision model; then the task model writes a short note (kind, title, summary, parties,
// dates, amounts, other names for it), kept on the document and encrypted like the file. A label a person put on a
// file (Purchase Contract, Closing Contract…) always says what it is; the note only fills in for unlabeled files.

// Documents in the library (not chat, task, comp or Agent attachments, which open from where they were sent).
export const HIDDEN_KINDS = ["chat", "comp", "agent", "task", "receipt-scan"]
// What the reader reads: files in Documents and imported draw workbooks (receipts and photos are found by name).
export const READ_KINDS = ["file", "import"]

const NOTE_VERSION = 1
const PDF_PAGES = 60
const DESCRIBE_CHARS = 14000
// A scan has (next to) no text; a short letter still has a few lines of it.
const MIN_LETTERS = 30
const MAX_TEXT_BYTES = 60 * 1024 * 1024
const MAX_SCAN_BYTES = 15 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const READ_LIMIT = 24000
const MAX_TRIES = 3
const RETRY_AFTER_MS = 60 * 60 * 1000
const STALE_READING_MS = 15 * 60 * 1000
const PICK_CANDIDATES = 40

// For the reader: what each kind is, beyond its name.
const TYPE_HINTS = {
  purchase_contract: "a contract to buy or sell the house (purchase and sale agreement, as-is contract, with any addenda)",
  reassignment_contract: "assigns a purchase contract to another buyer",
  settlement_statement: "an ALTA settlement statement",
  closing_statement: "a closing statement that is not ALTA: a HUD-1, a closing disclosure, a buyer's or seller's final statement",
  scope_of_work: "the work to be done on a house and what it costs: a scope of work, rehab budget or contractor bid",
  title: "a title commitment, title policy or title search",
  insurance: "an insurance policy, binder, declarations page or certificate (builder's risk, hazard, flood, liability)",
  loan: "anything from a lender: term sheet, approval, loan agreement, promissory note, mortgage or deed of trust, guaranty, loan statement, payoff letter",
  draw: "a request for, approval of or inspection for a construction draw",
  contractor_agreement: "an agreement with a contractor to do the work",
  invoice: "an invoice, bill or receipt for work or materials",
  permit: "a building permit, certificate of occupancy or final inspection",
  tax: "a property tax bill or notice, a tax return or a tax form (W-9, 1099)",
  articles: "articles of organization or incorporation for a company",
  ein: "the IRS letter giving a company its EIN",
  good_standing: "a state certificate of good standing or status",
  spreadsheet: "a spreadsheet of numbers: a deal analysis, pro forma or tracker",
  photo: "a photo (of a house, a room, damage or work), not a document",
}
const TYPE_IDS = new Set(DOCUMENT_TYPES.map((type) => type.id))
// The kinds the reader may choose (Closing Contract is only ever set by a label).
const READ_TYPES = DOCUMENT_TYPES.filter((type) => !type.labelOnly)

const STOP_WORDS = new Set("a an and any are as at be can could did do does document documents doc docs file files for from get give have i in is it latest me my need newest of on or our please pull put send share show that the their this to up want we what where which with you your copy copies pdf version".split(" "))

export function normalize(text) {
  return ` ${String(text || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `
}

function words(text) {
  return normalize(text).trim().split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word))
}

// What a person set (a label or a company folder) or else what the Agent read.
export function effectiveType(file) {
  return labeledDocumentType(file) || (TYPE_IDS.has(file.docType) ? file.docType : "")
}

function readable(text) {
  return (String(text || "").match(/[a-z]/gi) || []).length >= MIN_LETTERS
}

export function noteOf(file) {
  if (!file?.insight) return {}
  try {
    const note = JSON.parse(file.insight)
    return note && typeof note === "object" ? note : {}
  } catch {
    return {}
  }
}

/* ---------- reading the text ---------- */

function clean(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/[ \t\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

async function pdfPages(buffer, limit) {
  // verbosity 0: only errors (a damaged PDF is noted as failed; pdf.js need not warn in the log too).
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 })
  try {
    const pages = []
    for (let number = 1; number <= Math.min(pdf.numPages, limit); number += 1) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const text = content.items.map((item) => `${item.str || ""}${item.hasEOL ? "\n" : " "}`).join("")
      pages.push({ page: number, text: clean(text) })
    }
    return { pages, totalPages: pdf.numPages }
  } finally {
    await pdf.destroy?.()
  }
}

// The text in a file, page by page for a PDF. Empty for pictures, videos, old .doc files and scanned PDFs.
export async function documentText(file, { pages = PDF_PAGES } = {}) {
  const type = documentType(file.name) || (String(file.mime || "").startsWith("image/") ? "image" : "")
  const lower = String(file.name || "").toLowerCase()
  const empty = { type, pages: [], totalPages: 0, text: "" }
  if (type === "image" || type === "video" || !type) return empty
  if ((file.size || 0) > MAX_TEXT_BYTES) return empty
  const buffer = Buffer.from(await readStoredFile(file))
  if (type === "pdf") {
    const read = await pdfPages(buffer, pages)
    return { type, ...read, text: read.pages.map((page) => page.text).filter(Boolean).join("\n\n") }
  }
  if (type === "word") {
    if (!lower.endsWith(".docx")) return empty
    return { type, pages: [], totalPages: 0, text: clean((await mammoth.extractRawText({ buffer })).value) }
  }
  if (type === "excel") {
    const book = xlsx.read(buffer, { type: "buffer", cellDates: true })
    const sheets = book.SheetNames.map((name) => {
      const rows = xlsx.utils.sheet_to_csv(book.Sheets[name], { blankrows: false }).split("\n").filter((line) => line.replace(/,/g, "").trim())
      return rows.length ? `Sheet "${name}":\n${rows.join("\n")}` : ""
    }).filter(Boolean)
    return { type, pages: [], totalPages: 0, text: clean(sheets.join("\n\n")) }
  }
  return empty
}

function visibleImage(file) {
  const mime = String(file.mime || "").toLowerCase()
  if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) return mime
  const extension = /\.(jpe?g|png|webp|gif)$/i.exec(String(file.name || ""))?.[1]?.toLowerCase()
  return extension ? `image/${extension === "jpg" ? "jpeg" : extension}` : ""
}

// The file itself for a model that reads pictures and PDFs (a scan, or a photo of a document). Null when too large.
async function filePart(file, type) {
  const limit = type === "pdf" ? MAX_SCAN_BYTES : MAX_IMAGE_BYTES
  if ((file.size || 0) > limit) return null
  // Only pictures the models can see (an iPhone's HEIC, say, is not one): the rest go by their name.
  const mime = type === "pdf" ? "application/pdf" : visibleImage(file)
  if (!mime) return null
  const data = Buffer.from(await readStoredFile(file)).toString("base64")
  if (type === "pdf") return { type: "file", file: { filename: String(file.name || "file.pdf").replace(/[^\w.\- ]+/g, "") || "file.pdf", file_data: `data:application/pdf;base64,${data}` } }
  return { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } }
}

/* ---------- the note ---------- */

function describePrompt() {
  const kinds = READ_TYPES.map((type) => `- ${type.id}: ${type.name}${TYPE_HINTS[type.id] ? ` (${TYPE_HINTS[type.id]})` : ""}`).join("\n")
  return `You read documents for SynergiFund, a private real estate investment company that buys, renovates, rents, refinances and sells houses. Read the document and reply with only a JSON object, no other text:
{"type": "", "title": "", "summary": "", "parties": [], "dates": [], "amounts": [], "property": "", "words": []}

- type: what kind of document it is, one id from this list (other only when none fits):
${kinds}
- title: what it is in a few words, with the property or company and its date when the document shows them, for example "Purchase contract for 88 Demo Rd, signed Oct 2, 2026".
- summary: one or two plain sentences: what it is, between whom, and its key terms or figures.
- parties: the people and companies in it with their role, for example "Seller: Jane Roe" or "Lender: Kiavi". Up to 8.
- dates: the dates that matter (signed, effective, closing, expiration, due) as {"label": "", "date": "YYYY-MM-DD"}. Up to 6.
- amounts: the dollar figures that matter (price, loan amount, premium, total, deposit) as {"label": "", "amount": 0}. Up to 8.
- property: the street address it is about, or "" if none.
- words: up to 12 other words or short phrases people might use when asking for it (other names for this kind of document, the lender, insurer, vendor or street).
- Never copy account, routing, card or loan numbers, Social Security numbers, EINs, license numbers or passwords: write "on file" instead.
- If the text is cut off, describe what is there. Only use what the document shows; never guess a figure or a date.`
}

function header(file, place) {
  return [
    `File name: ${file.name}`,
    place ? `Filed under: ${place}` : "",
    folderOf(file) ? `Folder: ${folderName(file.propertyId ? "property" : "company", folderOf(file))}` : "",
    (file.labels || []).length ? `Labels: ${file.labels.join(", ")}` : "",
  ].filter(Boolean).join("\n")
}

// The first JSON object in a model's reply ({…}, even inside a code fence or after a sentence).
export function jsonOf(text) {
  const raw = String(text || "")
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(raw.slice(start, end + 1))
    return value && typeof value === "object" ? value : null
  } catch {
    return null
  }
}

// Long runs of digits (account, routing, card or Social Security numbers: nine digits or more, perhaps with spaces or
// dashes between them) never reach the note, even if a model copied one. Dates, ZIP+4 codes, street numbers ("12345
// 103rd St") and dollar amounts with commas stay. Also used for the house summaries (summaries.js).
export function scrub(text, limit) {
  const kept = (match) => /^\d{4}-\d{2}-\d{2}(?: \d{4}-\d{2}-\d{2})*$/.test(match) || /^\d{5}-\d{4}$/.test(match)
  return String(text || "").replace(/\d(?:[ -]?\d){8,}/g, (match) => (kept(match) ? match : "on file")).replace(/\s+/g, " ").trim().slice(0, limit)
}

// A list item a model wrote, as words: a string, or an object's words joined ("Lender: Kiavi" from {"role": "Lender",
// "name": "Kiavi"}). "" for anything else.
export function itemText(item) {
  if (typeof item === "string" || typeof item === "number") return String(item)
  if (item && typeof item === "object" && !Array.isArray(item)) return Object.values(item).filter((value) => typeof value === "string" && value.trim()).join(": ")
  return ""
}

function strings(list, limit, length) {
  return (Array.isArray(list) ? list : []).map((item) => scrub(itemText(item), length)).filter(Boolean).slice(0, limit)
}

export function cleanNote(raw) {
  const value = raw || {}
  const type = TYPE_IDS.has(value.type) && !DOCUMENT_TYPES.find((item) => item.id === value.type)?.labelOnly ? value.type : "other"
  return {
    type,
    title: scrub(value.title, 160),
    summary: scrub(value.summary, 500),
    parties: strings(value.parties, 8, 120),
    dates: (Array.isArray(value.dates) ? value.dates : []).filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ""))).slice(0, 6).map((item) => ({ label: scrub(item.label, 60), date: String(item.date) })),
    amounts: (Array.isArray(value.amounts) ? value.amounts : []).map((item) => ({ label: scrub(item?.label, 60), amount: Number(item?.amount) })).filter((item) => Number.isFinite(item.amount) && item.label).slice(0, 8),
    property: scrub(value.property, 120),
    words: strings(value.words, 12, 60),
  }
}

async function models() {
  const stored = await AgentSetting.findOne({ key: "org" }).select("taskModel decisionModel").lean()
  return { taskModel: stored?.taskModel || AGENT_DEFAULTS.taskModel, decisionModel: stored?.decisionModel || AGENT_DEFAULTS.decisionModel }
}

// A note on one document: from its text (the task model, else the decision model), or from the file itself (a scan
// or a picture: the decision model), or from its name alone when nothing in it can be read.
// `meter`: counted as the background reader's (no one's) unless a person's question reads it.
export async function describeDocument(file, { place = "", settings, tracker = createUsageTracker(), meter = createMeter("documents") } = {}) {
  const chosen = settings || (await models())
  const read = await documentText(file)
  let content
  let from = "text"
  let order = [chosen.taskModel, chosen.decisionModel]
  if (readable(read.text)) {
    const text = read.text.length > DESCRIBE_CHARS ? `${read.text.slice(0, DESCRIBE_CHARS)}\n… (the rest of the document is not shown)` : read.text
    content = `${header(file, place)}${read.totalPages ? `\nPages: ${read.totalPages}` : ""}\n\nText:\n${text}`
  } else {
    const part = read.type === "pdf" || read.type === "image" ? await filePart(file, read.type) : null
    if (part) {
      from = read.type === "pdf" ? "scan" : "image"
      order = [chosen.decisionModel, AGENT_DEFAULTS.decisionModel]
      content = [{ type: "text", text: `${header(file, place)}\n\nThe document is attached.` }, part]
    } else {
      from = "name"
      content = `${header(file, place)}\n\nNothing in this file can be read (${read.type || "unknown type"}). Go by its name, folder and labels only, and keep the summary to what the name says.`
    }
  }
  let lastError = null
  for (const model of [...new Set(order.filter(Boolean))]) {
    try {
      const response = await chat({ model, tracker, meter, temperature: 0, maxTokens: 900, timeoutMs: 120000, messages: [{ role: "system", content: describePrompt() }, { role: "user", content }] })
      const raw = jsonOf(response.content)
      if (!raw) throw new Error("The model did not reply with a note.")
      return { ...cleanNote(raw), from, pages: read.totalPages || 0, v: NOTE_VERSION }
    } catch (error) {
      lastError = error
      // The budget is used up: the next model would be stopped too.
      if (error.budgetReached) break
    }
  }
  throw lastError || new Error("The document could not be read.")
}

/* ---------- the reader ---------- */

let running = false
let timer = null
// When this server's reader started: the first reader ever reads what's added from then on, including what's added
// before its first check.
let startedAt = null

function readerMs(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function schedule(ms) {
  clearTimeout(timer)
  timer = setTimeout(tick, ms)
  timer.unref?.()
}

// Off with DOCUMENT_READER=off (tests), and under `npm run dev` (lib/runtime.js) unless DOCUMENT_READER=on: the server
// reads them.
function readerOff() {
  if (process.env.DOCUMENT_READER === "off") return true
  return devServer() && process.env.DOCUMENT_READER !== "on"
}

// Reads documents in the background, one at a time: new ones as they are added, older ones once an admin turns that on.
// Nothing runs without a model key.
export function startDocumentReader() {
  if (readerOff()) return
  startedAt ||= new Date()
  schedule(readerMs("DOCUMENT_READER_START_MS", 20000))
}

// After an upload: read it soon rather than at the next check.
export function nudgeDocumentReader() {
  if (readerOff() || running) return
  schedule(readerMs("DOCUMENT_READER_NUDGE_MS", 3000))
}

async function tick() {
  if (running) return
  running = true
  let found = false
  try {
    // While this month's AI budget is used up it reads nothing, so nothing waits as failed.
    if (modelKey() && !(await budgetState()).reached) found = await readNext()
  } catch (error) {
    console.error("Document reader:", error.message)
  } finally {
    running = false
    schedule(found ? readerMs("DOCUMENT_READER_GAP_MS", 1500) : readerMs("DOCUMENT_READER_IDLE_MS", 30000))
  }
}

// From when new documents are read: the first time the reader runs. Documents added before then wait for docsReadAll.
// `save`: only the reader sets it (Settings only looks, so a local API pointed at the live database writes nothing).
async function readingFrom({ save = true } = {}) {
  const setting = await AgentSetting.findOne({ key: "org" }).select("docsReadFrom docsReadAll").lean()
  if (setting?.docsReadFrom) return { from: setting.docsReadFrom, all: Boolean(setting.docsReadAll) }
  if (!save) return { from: new Date(), all: Boolean(setting?.docsReadAll) }
  const from = startedAt || new Date()
  try {
    await AgentSetting.updateOne({ key: "org", docsReadFrom: { $in: [null] } }, { $set: { docsReadFrom: from } }, { upsert: true })
  } catch (error) {
    // Another server set it at the same moment (the upsert met its record): theirs stands.
    if (error.code !== 11000) throw error
  }
  const saved = await AgentSetting.findOne({ key: "org" }).select("docsReadFrom docsReadAll").lean()
  return { from: saved?.docsReadFrom || from, all: Boolean(saved?.docsReadAll) }
}

function waitingFilter({ from, all }) {
  const retry = { insightState: "failed", insightTries: { $lt: MAX_TRIES }, insightAt: { $lt: new Date(Date.now() - RETRY_AFTER_MS) } }
  return { kind: { $in: READ_KINDS }, ...(all ? {} : { createdAt: { $gte: from } }), $or: [{ insightState: { $in: ["", null] } }, retry] }
}

// Claims the newest document waiting to be read and reads it. True when there was one.
export async function readNext() {
  const window = await readingFrom()
  // A read cut off by a restart is tried again.
  await DocumentFile.updateMany({ insightState: "reading", insightAt: { $lt: new Date(Date.now() - STALE_READING_MS) } }, { $set: { insightState: "" } }, { timestamps: false })
  const file = await DocumentFile.findOneAndUpdate(waitingFilter(window), { $set: { insightState: "reading", insightAt: new Date() } }, { sort: { createdAt: -1 }, new: true, timestamps: false })
  if (!file) return false
  await readOne(file)
  return true
}

export async function readOne(file) {
  const type = documentType(file.name) || (String(file.mime || "").startsWith("image/") ? "image" : "")
  try {
    if (type === "video") {
      file.set({ insightState: "skipped", insightAt: new Date(), insightError: "" })
    } else if (type === "image" && folderOf(file) === "pictures") {
      // A photo in Photos and media is a picture of the house, not a document: no model reads it.
      file.set({ docType: "photo", insightState: "skipped", insightAt: new Date(), insightError: "" })
    } else {
      const place = file.propertyId
        ? (await Property.findById(file.propertyId).select("address").lean())?.address || ""
        : file.companyId ? (await Company.findById(file.companyId).select("name").lean())?.name || "" : ""
      const note = await describeDocument(file, { place })
      file.set({ docType: note.type, insight: JSON.stringify(note), insightState: "read", insightAt: new Date(), insightError: "" })
    }
  } catch (error) {
    // Stopped by the budget, not by the file: it waits to be read when there is budget again, with no try counted.
    if (error.budgetReached) file.set({ insightState: "", insightError: "" })
    else file.set({ insightState: "failed", insightAt: new Date(), insightError: String(error.message || error).slice(0, 300), insightTries: (file.insightTries || 0) + 1 })
  }
  try {
    // Not a change anyone made to the file: its Modified date stays.
    await file.save({ timestamps: false })
  } catch (error) {
    // Deleted while it was being read.
    if (error.name !== "DocumentNotFoundError") throw error
  }
  return file
}

// How far the reading has got, for Settings.
export async function documentReading() {
  const window = await readingFrom({ save: false })
  const base = { kind: { $in: READ_KINDS } }
  // Not tried yet (a failed one is counted as failed, not as waiting or older).
  const notTried = { insightState: { $in: ["", null, "reading"] } }
  const [total, read, failed, older] = await Promise.all([
    DocumentFile.countDocuments(base),
    DocumentFile.countDocuments({ ...base, insightState: { $in: ["read", "skipped"] } }),
    // Failed ones count as failed while they wait to be tried again (an hour later, up to three times).
    DocumentFile.countDocuments({ ...base, insightState: "failed" }),
    window.all ? 0 : DocumentFile.countDocuments({ ...base, ...notTried, createdAt: { $lt: window.from } }),
  ])
  return { connected: Boolean(modelKey()), readAll: window.all, readFrom: window.from, total, read, failed, older, waiting: Math.max(0, total - read - failed - older) }
}

/* ---------- filing it ---------- */

// Where each kind of document belongs on a property.
const KIND_FOLDERS = {
  purchase_contract: "contracts", reassignment_contract: "contracts",
  settlement_statement: "title", closing_statement: "title", title: "title", deed: "title", survey: "title",
  insurance: "insurance",
  loan: "lender", draw: "lender",
  scope_of_work: "renovation", contractor_agreement: "renovation", invoice: "renovation", lien_waiver: "renovation", permit: "renovation",
}

// Which Quick Access documents the properties already hold: "propertyId:slot" for each one with a file.
export async function filledSlots(propertyIds) {
  if (!propertyIds.length) return new Set()
  const labeled = await DocumentFile.find({ propertyId: { $in: propertyIds }, kind: { $nin: HIDDEN_KINDS }, "labels.0": { $exists: true } }).select("propertyId labels").lean()
  const held = new Set()
  for (const file of labeled) for (const item of QUICK_ACCESS) if (quickAccessFiles([file], item).length) held.add(`${file.propertyId}:${item.id}`)
  return held
}

// What the Agent would do with a file it has read, for one tap in Documents: the Quick Access label of what it is (when
// that slot is empty, so it never takes the slot from another file), and the folder its kind belongs in (when it sits
// in Miscellaneous). Null when it is filed right, the person dismissed it, or it hasn't been read.
export function documentSuggestion(file, held = new Set()) {
  if (!file?.propertyId || file.suggestionDismissed || file.insightState !== "read") return null
  const type = TYPE_IDS.has(file.docType) ? file.docType : ""
  const kind = DOCUMENT_TYPES.find((item) => item.id === type)
  if (!kind || type === "other" || type === "photo") return null
  const suggestion = {}
  const slot = QUICK_ACCESS.find((item) => item.name === kind.label)
  if (slot && !labeledDocumentType(file) && !held.has(`${file.propertyId}:${slot.id}`)) {
    suggestion.label = slot.name
    if (slot.folder !== folderOf(file)) suggestion.folder = slot.folder
  } else if (KIND_FOLDERS[type] && folderOf(file) === "other") {
    suggestion.folder = KIND_FOLDERS[type]
  }
  if (!suggestion.label && !suggestion.folder) return null
  return { kind: kind.name, ...suggestion, ...(suggestion.folder ? { folderName: folderName("property", suggestion.folder) } : {}) }
}

/* ---------- finding the one asked for ---------- */

// The kinds a request names, strongest first: "the closing contract" → Closing Contract (2 words), then Purchase
// Contract ("contract", 1) and Closing Statement ("closing", 1).
export function typesFor(request) {
  const text = normalize(request)
  const found = new Map()
  // "Other" is the catch-all, never something asked for ("12 Other Ave" is a street).
  for (const type of DOCUMENT_TYPES.filter((item) => item.id !== "other")) {
    for (const phrase of [...type.words, type.name, type.label].filter(Boolean)) {
      const wanted = normalize(phrase)
      if (wanted.trim() && text.includes(wanted)) found.set(type.id, Math.max(found.get(type.id) || 0, wanted.trim().split(" ").length))
    }
  }
  return [...found.entries()].sort((left, right) => right[1] - left[1]).map(([id, strength]) => ({ id, strength }))
}

// A label on the file that is the name the request uses ("closing contract" → a file labeled Closing Contract).
export function labelNamed(file, request) {
  const wanted = normalize(request)
  return (file.labels || []).some((label) => normalize(label).trim() && wanted.includes(normalize(label)))
}

// The labels that name one particular document of a deal: the Quick Access ones (Purchase Contract, Settlement Statement
// (ALTA)…), Closing Contract and Closing Statement. A file with the one the request names is the very document. Broad
// labels (Insurance, Title…) are not that sure: an unlabeled policy is insurance too.
const EXACT_LABELS = [...QUICK_ACCESS.map((item) => item.aliases), ["closing contract"], ["closing statement"]]

function slotNamed(file, request) {
  const wanted = normalize(request)
  const labels = (file.labels || []).map((label) => String(label).trim().toLowerCase())
  return EXACT_LABELS.some((aliases) => aliases.some((alias) => labels.includes(alias)) && aliases.some((alias) => wanted.includes(normalize(alias))))
}

// How well a file fits a request, by its kind, label, name and what the Agent read in it.
export function fitScore(file, request, { kinds = typesFor(request), skip = [] } = {}) {
  const type = effectiveType(file)
  const note = noteOf(file)
  let score = 0
  const kind = kinds.find((item) => item.id === type)
  if (kind) score += 3 + kind.strength * 2
  if (labelNamed(file, request)) score += 6
  const name = normalize(`${file.name} ${(file.labels || []).join(" ")} ${note.title || ""}`)
  const body = normalize([note.summary, ...(note.words || []), ...(note.parties || []), documentTypeName(type)].join(" "))
  for (const word of words(request)) {
    if (skip.includes(word)) continue
    if (name.includes(` ${word} `)) score += 1.5
    else if (body.includes(` ${word} `)) score += 1
  }
  return score
}

export function placeName(file, names) {
  return names.properties.get(String(file.propertyId || "")) || names.companies.get(String(file.companyId || "")) || "Not filed"
}

function line(file, index, names) {
  const note = noteOf(file)
  const type = effectiveType(file)
  return `[${index + 1}] ${file.name} · ${documentTypeName(type) || "not read yet"} · ${placeName(file, names)}${folderOf(file) ? ` / ${folderName(file.propertyId ? "property" : "company", folderOf(file))}` : ""} · added ${file.createdAt?.toISOString?.().slice(0, 10) || ""}${(file.labels || []).length ? ` · labels: ${file.labels.join(", ")}` : ""}${note.title ? ` · ${note.title}` : ""}${note.summary ? ` · ${note.summary.slice(0, 220)}` : ""}`
}

const PICK_PROMPT = `You pick documents for SynergiFund's agent. Someone asked for documents; below are the files in their library that might fit, one per line with its number, name, kind, where it is filed, when it was added, its labels and what it says. Decide which files ARE what they asked for. Reply with only a JSON object: {"match": [], "closest": []}
- match: the numbers of the files that are exactly the document or documents asked for, best first. Include every file that is that document (several copies or versions, or one per property when they asked about several), and nothing else.
- A file whose label is the name they used is that document. For Purchase Contract, Reassignment Contract, Closing Contract, Settlement Statement (ALTA) and Scope of Work (SOW), a file with that label is the match and nothing else is, even a file that reads the same. Otherwise the kind and what it says tell you; a file name alone can mislead.
- Never include a file only because it is on the same property or in the same folder.
- closest: only when nothing matches, and only files that could be the very document asked for under another name or kind (for example the Purchase Contract when they asked for the Closing Contract and none is filed). Never a different document that only mentions it or goes with it (a title commitment is not a survey). Usually [].`

// The files that are what was asked for. The model decides among the likeliest candidates; without a model (or when it
// fails) the kind and label decide alone.
// `places`: the property or company the search was narrowed to; their address or name says where, not which document.
export async function pickDocuments({ request, files, names, places = [], settings, tracker, meter = null }) {
  const kinds = typesFor(request)
  const skip = [...new Set(places.flatMap((place) => words(place)))].filter((word) => !kinds.some((kind) => normalize(DOCUMENT_TYPES.find((type) => type.id === kind.id)?.words.join(" ")).includes(` ${word} `)))
  const scored = files.map((file) => ({ file, score: fitScore(file, request, { kinds, skip }) })).filter((item) => item.score > 0)
  scored.sort((left, right) => right.score - left.score || (right.file.createdAt || 0) - (left.file.createdAt || 0))
  const candidates = scored.slice(0, PICK_CANDIDATES).map((item) => item.file)
  if (!candidates.length) return { match: [], closest: [], candidates: 0, how: "none" }
  const labeled = scored.filter((item) => slotNamed(item.file, request)).map((item) => item.file)
  if (modelKey()) {
    try {
      const response = await chat({
        model: settings?.taskModel || AGENT_DEFAULTS.taskModel,
        tracker,
        meter,
        temperature: 0,
        maxTokens: 300,
        timeoutMs: 60000,
        messages: [{ role: "system", content: PICK_PROMPT }, { role: "user", content: `They asked for: ${request}\n\nFiles:\n${candidates.map((file, index) => line(file, index, names)).join("\n")}` }],
      })
      const picked = jsonOf(response.content)
      if (picked) {
        const take = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((number) => Number.isInteger(number) && number >= 1 && number <= candidates.length))].map((number) => candidates[number - 1])
        let match = take(picked.match)
        // A Quick Access label a person set says which file it is: with files labeled the name asked for, only those are it.
        if (labeled.length) match = match.filter((file) => labeled.includes(file)).length ? match.filter((file) => labeled.includes(file)) : labeled
        const closest = match.length ? [] : take(picked.closest).slice(0, 3)
        return { match, closest, candidates: candidates.length, how: "model" }
      }
    } catch (error) {
      console.error("Agent: picking documents failed, falling back to kinds and labels:", error.message)
    }
  }
  // By kind and label only: the files with the Quick Access label the request names, else the files of the kind it
  // names most strongly (or labeled with its name).
  const best = kinds[0]
  const match = labeled.length ? labeled : scored.filter((item) => (best && effectiveType(item.file) === best.id) || labelNamed(item.file, request)).map((item) => item.file)
  const closest = match.length ? [] : scored.filter((item) => item.score >= 2).slice(0, 3).map((item) => item.file)
  return { match, closest, candidates: candidates.length, how: "kinds" }
}

/* ---------- opening one ---------- */

const SCAN_READ_PROMPT = `Someone asked SynergiFund's agent about this document. Copy out what it says, page by page ("[Page 1]", "[Page 2]"…), as plain text: every name, address, date, dollar amount, percentage and term that matters, and the clauses the question is about in full. Leave out repeated boilerplate. Never copy account, routing, card or loan numbers, Social Security numbers or passwords: write "on file". Do not answer the question.`

// What a document says, for answering from it: its pages' text (the pages that fit the question first when it is
// long), or, for a scan or a picture, what the decision model reads in it.
export async function documentContents(file, { question = "", settings, tracker, meter = null } = {}) {
  const read = await documentText(file, { pages: 200 })
  if (readable(read.text)) {
    const pages = read.pages.length ? read.pages : [{ page: 0, text: read.text }]
    const total = pages.reduce((sum, page) => sum + page.text.length, 0)
    let chosen = pages
    let left = []
    if (total > READ_LIMIT) {
      const wanted = words(question)
      const ranked = pages.map((page, index) => ({ page, index, hits: wanted.reduce((sum, word) => sum + (normalize(page.text).split(` ${word} `).length - 1), 0) }))
      // The first page (it says what the document is), then the pages that mention the question's words most.
      const order = [ranked[0], ...ranked.slice(1).sort((left, right) => right.hits - left.hits || left.index - right.index)]
      const keep = new Set()
      let size = 0
      for (const item of order) {
        if (size + item.page.text.length > READ_LIMIT && keep.size) continue
        keep.add(item.index)
        size += item.page.text.length
      }
      chosen = pages.filter((page, index) => keep.has(index))
      left = pages.filter((page, index) => !keep.has(index)).map((page) => page.page)
    }
    const text = chosen.map((page) => (page.page ? `[Page ${page.page}]\n${page.text}` : page.text)).join("\n\n").slice(0, READ_LIMIT + 2000)
    return {
      from: "text",
      pages: read.totalPages || 0,
      text,
      ...(left.length ? { pagesLeftOut: left.length > 12 ? `${left.length} pages` : left.join(", "), note: "Long document: these are the first page and the pages that best fit the question. Ask with other words to read other pages." } : {}),
      ...(read.totalPages > 200 ? { note: "Only the first 200 pages were read." } : {}),
    }
  }
  const part = read.type === "pdf" || read.type === "image" ? await filePart(file, read.type) : null
  if (!part) return { from: "none", pages: read.totalPages || 0, text: "", note: read.type === "word" ? "This is an old Word file (.doc) the agent cannot open. Saved as .docx or PDF it could." : "Nothing in this file can be read (it is too large, or not a document)." }
  const chosen = settings || (await models())
  let lastError = null
  for (const model of [...new Set([chosen.decisionModel, AGENT_DEFAULTS.decisionModel].filter(Boolean))]) {
    try {
      const response = await chat({ model, tracker, meter, temperature: 0, maxTokens: 6000, timeoutMs: 150000, messages: [{ role: "system", content: SCAN_READ_PROMPT }, { role: "user", content: [{ type: "text", text: `The question: ${question || "(what the document says)"}\nThe document: ${file.name}` }, part] }] })
      if (response.content.trim()) return { from: read.type === "pdf" ? "scan" : "image", pages: read.totalPages || 0, text: response.content.trim().slice(0, READ_LIMIT) }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error("The document could not be read.")
}
