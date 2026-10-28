export const ROLES = [
  { id: "admin", label: "Admin" },
  { id: "contractor", label: "Contractor" },
  { id: "finance", label: "Finance Reporter" },
  { id: "member", label: "Member" },
  { id: "developer", label: "Developer" },
  { id: "investor", label: "Investor / Auditor" },
  { id: "lender", label: "Lender" },
]

export const PERMISSIONS = {
  propertiesRead: "properties.read",
  propertiesWrite: "properties.write",
  internalPricing: "internal.pricing",
  expensesRead: "expenses.read",
  expensesSubmit: "expenses.submit",
  expensesApprove: "expenses.approve",
  drawsRead: "draws.read",
  drawsWrite: "draws.write",
  documentsRead: "documents.read",
  documentsWrite: "documents.write",
  documentsDelete: "documents.delete",
  importsRun: "imports.run",
  membersManage: "members.manage",
  superAdmin: "super.admin",
  agentAsk: "agent.ask",
  photosRead: "photos.read",
  photosWrite: "photos.write",
  activityRead: "activity.read",
  tasksEdit: "tasks.edit",
  tasksAssign: "tasks.assign",
  tasksManage: "tasks.manage",
  chatUse: "chat.use",
}

const all = Object.values(PERMISSIONS)

const readBooks = [
  PERMISSIONS.propertiesRead,
  PERMISSIONS.expensesRead,
  PERMISSIONS.drawsRead,
  PERMISSIONS.documentsRead,
  PERMISSIONS.photosRead,
  PERMISSIONS.activityRead,
  PERMISSIONS.agentAsk,
]

export const ROLE_PERMISSIONS = {
  admin: all,
  contractor: [
    PERMISSIONS.propertiesRead,
    PERMISSIONS.expensesRead,
    PERMISSIONS.expensesSubmit,
    PERMISSIONS.drawsRead,
    PERMISSIONS.documentsRead,
    PERMISSIONS.documentsWrite,
    PERMISSIONS.photosRead,
    PERMISSIONS.photosWrite,
    PERMISSIONS.agentAsk,
    PERMISSIONS.tasksEdit,
    PERMISSIONS.activityRead,
    PERMISSIONS.chatUse,
  ],
  finance: [
    ...readBooks,
    PERMISSIONS.chatUse,
    PERMISSIONS.internalPricing,
    PERMISSIONS.expensesApprove,
    PERMISSIONS.drawsWrite,
    PERMISSIONS.documentsWrite,
  ],
  member: [
    PERMISSIONS.propertiesRead,
    PERMISSIONS.expensesRead,
    PERMISSIONS.documentsRead,
    PERMISSIONS.drawsRead,
    PERMISSIONS.agentAsk,
    PERMISSIONS.tasksEdit,
    PERMISSIONS.activityRead,
    PERMISSIONS.chatUse,
  ],
  developer: [
    PERMISSIONS.propertiesRead,
    PERMISSIONS.propertiesWrite,
    PERMISSIONS.documentsRead,
    PERMISSIONS.documentsWrite,
    PERMISSIONS.importsRun,
    PERMISSIONS.agentAsk,
    PERMISSIONS.activityRead,
    PERMISSIONS.drawsRead,
    PERMISSIONS.chatUse,
  ],
  investor: [...readBooks, PERMISSIONS.chatUse],
  lender: [
    PERMISSIONS.propertiesRead,
    PERMISSIONS.drawsRead,
    PERMISSIONS.documentsRead,
    PERMISSIONS.photosRead,
    PERMISSIONS.agentAsk,
    PERMISSIONS.chatUse,
  ],
}

export const STAGES = ["Under contract", "Lender search", "Renovation", "For rent", "Rented", "For sale", "Sold", "Exit", "Complete"]

export const STRATEGIES = [
  "Fix & flip",
  "Buy & hold",
  "Rent",
  "Refinance",
  "Rent to own",
  "Wrap",
  "Seller financing",
]

export const EXPENSE_CATEGORIES = [
  "Property rehab",
  "Shared rehab",
  "Contractor",
  "Labor",
  "Materials",
  "Permits & fees",
  "Technology",
  "Acquisition",
  "Closing costs",
  "Financing",
  "Interest",
  "Loan payoff",
  "Utilities",
  "HOA",
  "Insurance",
  "Property taxes",
  "Insurance & taxes",
  "Selling costs",
  "Other",
]

export const EXPENSE_STATUSES = ["Draft", "Submitted", "Needs information", "Needs second approval", "Approved", "Rejected"]

export const PAYING_ENTITIES = ["Investment company", "Construction company"]

export const PAYMENT_CATEGORIES = ["Mortgage", "Insurance", "Property taxes", "Utilities", "HOA", "Contractor", "Materials", "Loan payoff", "Other"]

export const PAYMENT_RECURRENCES = ["One time", "Weekly", "Every 2 weeks", "Monthly", "Quarterly", "Yearly"]

export const APPROVAL_THRESHOLD = 5000

// What an item on a store receipt is, for receipts read from a photo. Sales tax is its own line on each property.
export const RECEIPT_CATEGORIES = [
  "Lumber & framing",
  "Hardware & fasteners",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Paint & drywall",
  "Flooring & tile",
  "Cabinets & counters",
  "Doors & windows",
  "Roofing & exterior",
  "Appliances",
  "Fixtures & lighting",
  "Landscaping",
  "Tools & equipment",
  "Cleaning & supplies",
  "Labor",
  "Permits & fees",
  "Rental & delivery",
  "Other",
]
export const SALES_TAX = "Sales tax"
export const RECEIPT_MAX_ITEMS = 150

// Dollars to whole cents: "1,234.5" → 123450. Blank → null; anything unreadable → NaN.
export function toCents(value) {
  if (value == null || value === "") return null
  const number = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""))
  if (!Number.isFinite(number)) return NaN
  const cents = Number((Math.abs(number) * 100).toFixed(6))
  return Math.sign(number) * Math.round(cents)
}

export function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100
}

// Splits whole cents by weights so the parts add up exactly (the leftover cents go to the largest fractions).
export function shareOut(totalCents, weights) {
  const sum = weights.reduce((total, weight) => total + Math.max(0, Number(weight) || 0), 0)
  if (!sum) return weights.map(() => 0)
  const sign = totalCents < 0 ? -1 : 1
  const total = Math.abs(totalCents)
  const raw = weights.map((weight) => (total * Math.max(0, Number(weight) || 0)) / sum)
  const parts = raw.map(Math.floor)
  let left = total - parts.reduce((sumOf, part) => sumOf + part, 0)
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) break
    parts[index] += 1
    left -= 1
  }
  return parts.map((part) => sign * part)
}

function dollars(cents) {
  return `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// How a receipt lands on the properties: every item goes to one property, or is split between several by amount or
// percentage, and the sales tax is shared in proportion to each property's items. The web page shows this before
// Submit and the server files exactly this, so both always agree. Amounts are whole cents.
// items: [{ description, category, amount, propertyId, split: { mode: "amount" | "percent", parts: [{ propertyId, value }] } }]
// propertyIds: the properties picked for the receipt; the first one gets every item that is not given another.
export function receiptPlan({ items = [], tax = 0, propertyIds = [], names = {} } = {}) {
  const errors = []
  const chosen = [...new Set((propertyIds || []).map(String).filter(Boolean))]
  const label = (id) => names[id] || "A property"
  const lines = []
  // What the items add up to, whether or not a property is picked yet (the total shown while filling it in).
  let itemsCents = 0
  if (!chosen.length) errors.push("Choose the property this receipt is for.")
  if (!items.length) errors.push("Add at least one item.")
  if (items.length > RECEIPT_MAX_ITEMS) errors.push(`A receipt can have up to ${RECEIPT_MAX_ITEMS} items.`)
  items.slice(0, RECEIPT_MAX_ITEMS).forEach((item, index) => {
    const number = index + 1
    const description = String(item?.description || "").replace(/\s+/g, " ").trim().slice(0, 200)
    const category = RECEIPT_CATEGORIES.includes(item?.category) || item?.category === SALES_TAX ? item.category : "Other"
    const cents = toCents(item?.amount)
    if (!description) errors.push(`Item ${number} needs a description.`)
    if (cents == null || Number.isNaN(cents)) {
      errors.push(`Item ${number} needs an amount.`)
      return
    }
    if (cents === 0) {
      errors.push(`Item ${number} is $0.00. Enter its amount or remove it.`)
      return
    }
    itemsCents += cents
    if (!chosen.length) return
    const parts = []
    const seen = new Set()
    for (const part of item?.split?.parts || []) {
      const id = String(part?.propertyId || "")
      if (!chosen.includes(id) || seen.has(id)) continue
      const value = item.split.mode === "percent" ? Number(String(part.value ?? "").replace(/[%\s]/g, "")) : toCents(part.value)
      if (part.value === "" || part.value == null || value === 0) continue
      if (!Number.isFinite(value) || (item.split.mode === "percent" ? value < 0 : value * Math.sign(cents) < 0)) {
        errors.push(`Item ${number}: enter each property's ${item.split.mode === "percent" ? "percentage" : "amount"} as a number.`)
        return
      }
      seen.add(id)
      parts.push({ propertyId: id, value })
    }
    const base = { description, category, itemIndex: index, kind: "item" }
    if (item?.split && parts.length > 1) {
      if (item.split.mode === "percent") {
        const sum = parts.reduce((total, part) => total + part.value, 0)
        if (Math.abs(sum - 100) > 0.01) {
          errors.push(`Item ${number}: the percentages add up to ${Math.round(sum * 100) / 100}%, not 100%.`)
          return
        }
        shareOut(cents, parts.map((part) => part.value)).forEach((share, at) => {
          if (share) lines.push({ ...base, propertyId: parts[at].propertyId, cents: share })
        })
        return
      }
      const sum = parts.reduce((total, part) => total + part.value, 0)
      if (sum !== cents) {
        errors.push(`Item ${number}: the split adds up to ${dollars(sum)}, not ${dollars(cents)}.`)
        return
      }
      for (const part of parts) lines.push({ ...base, propertyId: part.propertyId, cents: part.value })
      return
    }
    const target = parts.length === 1 ? parts[0].propertyId : chosen.includes(String(item?.propertyId || "")) ? String(item.propertyId) : chosen[0]
    lines.push({ ...base, propertyId: target, cents })
  })
  const taxCents = toCents(tax) ?? 0
  if (Number.isNaN(taxCents)) errors.push("Enter the sales tax as a number.")
  else if (taxCents < 0) errors.push("The sales tax can't be below $0.")
  const used = chosen.filter((id) => lines.some((line) => line.propertyId === id))
  const itemsOf = (id) => lines.filter((line) => line.propertyId === id).reduce((total, line) => total + line.cents, 0)
  const taxLines = []
  if (taxCents > 0 && !Number.isNaN(taxCents)) {
    const weights = used.map((id) => Math.max(0, itemsOf(id)))
    // With no item placed yet, the messages above already say what to fix.
    if (!weights.some(Boolean)) {
      if (lines.length) errors.push("The items need to add up to more than $0 to share the sales tax.")
    }
    else shareOut(taxCents, weights).forEach((share, at) => {
      if (share) taxLines.push({ propertyId: used[at], description: SALES_TAX, category: SALES_TAX, cents: share, itemIndex: -1, kind: "tax" })
    })
  }
  const all = [...lines, ...taxLines]
  const properties = used.map((id) => {
    const items = itemsOf(id)
    const taxShare = taxLines.filter((line) => line.propertyId === id).reduce((total, line) => total + line.cents, 0)
    return { propertyId: id, itemsCents: items, taxCents: taxShare, totalCents: items + taxShare, count: lines.filter((line) => line.propertyId === id).length }
  })
  for (const entry of properties) {
    if (entry.totalCents <= 0) errors.push(`${label(entry.propertyId)} comes to ${dollars(entry.totalCents)}. Each property's share needs to be more than $0.`)
  }
  return {
    errors: [...new Set(errors)],
    lines: all,
    properties,
    itemsCents,
    taxCents: Number.isNaN(taxCents) ? 0 : taxCents,
    totalCents: itemsCents + (Number.isNaN(taxCents) ? 0 : Math.max(0, taxCents)),
  }
}

// ---- Property cost sheet ----

// Everything a house has cost, from the purchase on, in the order it is spent. Each cost lands on one type, read
// from its category (older costs keep the categories they were filed with, so those map too).
export const COST_GROUPS = [
  { id: "purchase", label: "Purchase", types: ["Purchase price", "Closing costs"] },
  { id: "holding", label: "Holding costs", types: ["Insurance", "Property taxes", "Interest & loan payments", "Utilities & HOA"] },
  { id: "rehab", label: "Rehab", types: ["Labor", "Materials", "Permits & other rehab"] },
  { id: "selling", label: "Selling", types: ["Selling costs"] },
  { id: "other", label: "Other", types: ["Other costs"] },
]

// What a cost added on the sheet is saved as. Rehab costs count against the rehab budget; the rest do not.
const HOLD = { entity: "Investment company", costTreatment: "Exclude from construction margin" }
const BUILD = { entity: "Construction company", costTreatment: "Include in construction margin" }
export const COST_TYPES = {
  "Closing costs": { category: "Closing costs", ...HOLD, hint: "Title, settlement, recording, lender fees" },
  Insurance: { category: "Insurance", ...HOLD, hint: "Hazard, builder's risk, flood" },
  "Property taxes": { category: "Property taxes", ...HOLD, hint: "County or city property tax" },
  "Interest & loan payments": { category: "Interest", ...HOLD, hint: "Monthly interest or loan payment" },
  "Utilities & HOA": { category: "Utilities", ...HOLD, hint: "Power, water, gas, HOA dues" },
  Labor: { category: "Labor", ...BUILD, hint: "Contractor or crew pay" },
  Materials: { category: "Materials", ...BUILD, hint: "Lumber, fixtures, supplies" },
  "Permits & other rehab": { category: "Permits & fees", ...BUILD, hint: "Permits, inspections, dumpsters" },
  "Selling costs": { category: "Selling costs", ...HOLD, hint: "Agent commission, staging, closing" },
  "Other costs": { category: "Other", ...HOLD, hint: "Anything else" },
}

const LOAN_PAYOFF = "Loan payoff"

// The sheet type for a cost's category. A loan payoff repays borrowed money (the purchase price already counts), so it
// is listed apart and left out of the total.
export function costType(category, title = "") {
  const name = String(category || "")
  if (name === "Acquisition" || name === "Closing costs") return "Closing costs"
  if (name === "Insurance") return "Insurance"
  if (name === "Property taxes") return "Property taxes"
  if (name === "Insurance & taxes") return /\btax/i.test(title) ? "Property taxes" : "Insurance"
  if (name === "Loan payoff" || (name === "Financing" && /pay\s?off/i.test(title))) return LOAN_PAYOFF
  if (name === "Financing" || name === "Interest") return "Interest & loan payments"
  if (name === "Utilities" || name === "HOA") return "Utilities & HOA"
  if (name === "Contractor" || name === "Labor") return "Labor"
  if (name === "Permits & fees" || name === "Property rehab" || name === "Shared rehab") return "Permits & other rehab"
  if (name === "Selling costs") return "Selling costs"
  if (name === "Materials" || name === SALES_TAX || RECEIPT_CATEGORIES.includes(name)) return name === "Other" ? "Other costs" : "Materials"
  return "Other costs"
}

// The sheet for one property: the purchase price plus every cost row (approved, and waiting for approval), grouped by
// type. Totals count approved costs; waiting ones are listed with their own total. Amounts are added in whole cents.
// rows: [{ id, state: "approved" | "pending", date, description, vendor, category, amount, ... }]
export function costSheet({ purchasePrice = null, purchaseDate = "" } = {}, rows = []) {
  const types = new Map(COST_GROUPS.flatMap((group) => group.types.map((type) => [type, { type, cents: 0, pendingCents: 0, count: 0, rows: [] }])))
  const price = toCents(purchasePrice)
  const hasPrice = price != null && !Number.isNaN(price)
  if (hasPrice) {
    const entry = types.get("Purchase price")
    entry.cents = price
    entry.count = 1
    entry.rows.push({ id: "purchase-price", kind: "purchase", state: "approved", status: "Approved", date: String(purchaseDate || ""), description: "Purchase price", vendor: "", category: "Purchase price", amount: fromCents(price) })
  }
  const payoffs = { cents: 0, count: 0, rows: [] }
  for (const row of rows) {
    const cents = toCents(row.amount) || 0
    const type = costType(row.category, row.description)
    if (type === LOAN_PAYOFF) {
      if (row.state === "approved") payoffs.cents += cents
      payoffs.count += 1
      payoffs.rows.push({ ...row, type })
      continue
    }
    const entry = types.get(type)
    if (row.state === "approved") entry.cents += cents
    else entry.pendingCents += cents
    entry.count += 1
    entry.rows.push({ ...row, type })
  }
  const newest = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id).localeCompare(String(a.id))
  let total = 0
  let pending = 0
  let pendingCount = 0
  const groups = COST_GROUPS.map((group) => {
    const list = group.types.map((type) => {
      const entry = types.get(type)
      entry.rows.sort(newest)
      return { type, total: fromCents(entry.cents), pending: fromCents(entry.pendingCents), count: entry.count, rows: entry.rows, addable: Boolean(COST_TYPES[type]) }
    })
    const cents = group.types.reduce((sum, type) => sum + types.get(type).cents, 0)
    const waiting = group.types.reduce((sum, type) => sum + types.get(type).pendingCents, 0)
    total += cents
    pending += waiting
    pendingCount += list.reduce((sum, entry) => sum + entry.rows.filter((row) => row.state !== "approved").length, 0)
    return { id: group.id, label: group.label, total: fromCents(cents), pending: fromCents(waiting), count: list.reduce((sum, entry) => sum + entry.count, 0), types: list }
  })
  return {
    groups,
    total: fromCents(total),
    pending: fromCents(pending),
    pendingCount,
    purchasePrice: hasPrice ? fromCents(price) : null,
    purchaseDate: String(purchaseDate || ""),
    loanPayoffs: { total: fromCents(payoffs.cents), count: payoffs.count, rows: payoffs.rows.sort(newest) },
  }
}

export const PERMISSION_CATALOG = [
  { group: "Portfolio", id: PERMISSIONS.propertiesRead, label: "View properties", detail: "See the portfolio and open a property." },
  { group: "Portfolio", id: PERMISSIONS.propertiesWrite, label: "Edit properties", detail: "Add properties and change deal details." },
  { group: "Portfolio", id: PERMISSIONS.internalPricing, label: "See internal pricing", detail: "HouseBought price and assignment fee." },
  { group: "Money", id: PERMISSIONS.expensesRead, label: "View expenses", detail: "See posted costs and payment schedules." },
  { group: "Money", id: PERMISSIONS.expensesSubmit, label: "Submit expenses", detail: "Log a cost with proof." },
  { group: "Money", id: PERMISSIONS.expensesApprove, label: "Approve expenses", detail: "Approve, reject, and mark bills paid." },
  { group: "Money", id: PERMISSIONS.drawsRead, label: "View draws", detail: "See rehab funding and draw history." },
  { group: "Money", id: PERMISSIONS.drawsWrite, label: "Manage draws", detail: "Record funding and pull a draw." },
  { group: "Tasks", id: PERMISSIONS.tasksEdit, label: "Edit tasks", detail: "Change a task and mark it done." },
  { group: "Tasks", id: PERMISSIONS.tasksAssign, label: "Assign tasks", detail: "Choose an assignee and see every member email." },
  { group: "Tasks", id: PERMISSIONS.tasksManage, label: "Create and delete tasks", detail: "Add and remove tasks. Assignment is included." },
  { group: "Documents", id: PERMISSIONS.documentsRead, label: "View documents", detail: "Open files in the knowledge base." },
  { group: "Documents", id: PERMISSIONS.documentsWrite, label: "Upload documents", detail: "Add files and weekly photos." },
  { group: "Documents", id: PERMISSIONS.documentsDelete, label: "Remove documents", detail: "Delete a file from the library." },
  { group: "Documents", id: PERMISSIONS.importsRun, label: "Import Excel", detail: "Load workbooks into properties." },
  { group: "Documents", id: PERMISSIONS.photosRead, label: "View photos", detail: "See weekly house photos and draw reports." },
  { group: "Documents", id: PERMISSIONS.photosWrite, label: "File photos", detail: "Upload a weekly photo set." },
  { group: "People", id: PERMISSIONS.membersManage, label: "Manage members", detail: "Invite people and set what they can do." },
  { group: "People", id: PERMISSIONS.superAdmin, label: "Super admin", detail: "Change or remove an admin, and grant every permission." },
  { group: "People", id: PERMISSIONS.activityRead, label: "See activity", detail: "Read the activity log and notifications." },
  { group: "Chat", id: PERMISSIONS.chatUse, label: "Use chat", detail: "Read and send team chat, property rooms and direct messages. Turn off to hide Chat for this person." },
  { group: "Knowledge", id: PERMISSIONS.agentAsk, label: "Ask the knowledge base", detail: "Question records this person is allowed to see." },
]

const KNOWN_PERMISSIONS = new Set(Object.values(PERMISSIONS))

export function isRole(role) {
  return ROLES.some((item) => item.id === role)
}

export function knownPermissions(list = []) {
  return [...new Set(list.filter((id) => KNOWN_PERMISSIONS.has(id)))]
}

export function permissionOverrides(role, selected) {
  const base = new Set(ROLE_PERMISSIONS[role] || [])
  const chosen = new Set(knownPermissions(selected))
  return {
    extraPermissions: [...chosen].filter((id) => !base.has(id)),
    deniedPermissions: [...base].filter((id) => !chosen.has(id)),
  }
}

export const TASK_LABELS = ["EMD", "Mortgage payment", "Draw", "Verify", "Inspection", "Closing", "Insurance", "Taxes"]

export const PROPERTY_LABELS = ["Financed", "Refinanced", "Flip", "Hold", "Rent"]

export const LOAN_LABELS = ["Financed", "Refinanced", "Construction", "Bridge", "Seller financing"]
// The first five are the Quick Access documents on a property (see QUICK_ACCESS).
export const DOCUMENT_LABELS = ["Purchase Contract", "Reassignment Contract", "Closing Contract", "Settlement Statement (ALTA)", "Scope of Work (SOW)", "Closing Statement", "Title", "Insurance", "Loan", "Appraisal", "Inspection", "Permit", "Invoice", "Lease", "Tax", "Other"]

// Key documents every property may need, shown under Quick Access on its Documents. A file counts as one when it
// carries that label (older spellings too); uploading from Quick Access files it in the main folder with the label.
export const QUICK_ACCESS = [
  { id: "purchase-contract", name: "Purchase Contract", folder: "contracts", aliases: ["purchase contract"] },
  { id: "reassignment-contract", name: "Reassignment Contract", folder: "contracts", aliases: ["reassignment contract", "assignment contract"] },
  { id: "closing-contract", name: "Closing Contract", folder: "title", aliases: ["closing contract"] },
  { id: "settlement-statement", name: "Settlement Statement (ALTA)", folder: "title", aliases: ["settlement statement (alta)", "settlement statement", "alta settlement statement", "alta"] },
  { id: "scope-of-work", name: "Scope of Work (SOW)", folder: "renovation", aliases: ["scope of work (sow)", "scope of work", "sow"] },
]

// The files on a property that count as a Quick Access document.
export function quickAccessFiles(files = [], item) {
  const wanted = new Set(item.aliases)
  return files.filter((file) => (file.labels || []).some((label) => wanted.has(String(label).trim().toLowerCase())))
}
export const COMPANY_DOCUMENT_LABELS = ["Articles of organization", "Operating agreement", "EIN letter", "Annual report", "Bank statement", "Tax", "Insurance", "Other"]
// How exposed a company is, by how many properties it holds. No properties: no exposure level.
export const EXPOSURE_LEVELS = [
  { id: "low", label: "Low Exposure", min: 1, max: 2 },
  { id: "moderate", label: "Moderate Exposure", min: 3, max: 4 },
  { id: "high", label: "High Exposure", min: 5, max: 7 },
  { id: "critical", label: "Critical Exposure", min: 8, max: Infinity },
]

export function companyExposure(count) {
  const properties = Math.max(0, Math.floor(Number(count) || 0))
  return EXPOSURE_LEVELS.find((level) => properties >= level.min && properties <= level.max) || null
}

export const COMPANY_TYPES = ["LLC", "Corporation", "S corporation", "Partnership", "Limited partnership", "Trust", "Sole proprietorship", "Other"]
const STANDARD_DOCUMENT_LABELS = [...new Set([...DOCUMENT_LABELS, ...COMPANY_DOCUMENT_LABELS])]

// Optional labels on a file: trimmed, at most 8, no repeats, matching the standard spelling when one exists.
export function cleanDocumentLabels(value) {
  let list = value
  if (typeof list === "string") {
    const text = list
    try {
      list = JSON.parse(text)
    } catch {
      list = null
    }
    if (!Array.isArray(list)) list = text.split(",")
  }
  const labels = []
  for (const item of Array.isArray(list) ? list : []) {
    const text = String(item ?? "").trim().replace(/\s+/g, " ").slice(0, 40)
    if (!text) continue
    const standard = STANDARD_DOCUMENT_LABELS.find((label) => label.toLowerCase() === text.toLowerCase())
    const label = standard || text
    if (!labels.some((existing) => existing.toLowerCase() === label.toLowerCase())) labels.push(label)
    if (labels.length === 8) break
  }
  return labels
}

// Folders inside a property's and a company's Documents. Every file filed under one lives in exactly one folder.
export const PROPERTY_FOLDERS = [
  { id: "contracts", name: "Contracts" },
  { id: "lender", name: "Financing & Lender" },
  { id: "title", name: "Title & Closing" },
  { id: "insurance", name: "Insurance" },
  { id: "renovation", name: "Renovation & Rehab" },
  { id: "other", name: "Miscellaneous" },
  { id: "pictures", name: "Photos & Media" },
]
// `required`: every company needs one; an empty required folder shows as Missing.
export const COMPANY_FOLDERS = [
  { id: "articles", name: "Articles of Organization", required: true },
  { id: "operating", name: "Operating Agreement", required: true },
  { id: "ein", name: "EIN Letter", required: true },
  { id: "good-standing", name: "Certificate of Good Standing", required: true },
  { id: "other", name: "Miscellaneous" },
]

// The required company documents with no file yet, from the company's own files (each with its folder).
export function missingCompanyDocuments(files = []) {
  const filled = new Set(files.map((file) => folderOf(file)))
  return COMPANY_FOLDERS.filter((folder) => folder.required && !filled.has(folder.id))
}

export function foldersFor(place) {
  if (place === "property") return PROPERTY_FOLDERS
  if (place === "company") return COMPANY_FOLDERS
  return []
}

export function folderName(place, id) {
  return foldersFor(place).find((folder) => folder.id === id)?.name || ""
}

// What a file is, from its name: pdf, word, excel, image or video. Anything else is not accepted in Documents.
const FILE_TYPES = [
  ["pdf", /\.pdf$/i],
  ["word", /\.(docx?|rtf)$/i],
  ["excel", /\.(xlsx?|xlsm|csv)$/i],
  ["image", /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i],
  ["video", /\.(mp4|mov|m4v|webm)$/i],
]

export function documentType(name = "") {
  return FILE_TYPES.find(([, pattern]) => pattern.test(String(name).trim()))?.[0] || ""
}

// PDF, Word, Excel and images everywhere; videos only on properties.
export function allowedDocument(name, place) {
  const type = documentType(name)
  if (!type) return false
  return type !== "video" || place === "property"
}

export function documentAccept(place) {
  return `.pdf,.doc,.docx,.rtf,.xls,.xlsx,.xlsm,.csv,image/*,.heic,.heif${place === "property" ? ",video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" : ""}`
}

const PROPERTY_LABEL_FOLDERS = {
  "purchase contract": "contracts",
  "reassignment contract": "contracts",
  "assignment contract": "contracts",
  "closing contract": "title",
  "settlement statement (alta)": "title",
  "settlement statement": "title",
  "scope of work (sow)": "renovation",
  "scope of work": "renovation",
  lease: "contracts",
  loan: "lender",
  appraisal: "lender",
  title: "title",
  "closing statement": "title",
  insurance: "insurance",
  permit: "renovation",
  invoice: "renovation",
  inspection: "renovation",
}
const COMPANY_LABEL_FOLDERS = {
  "articles of organization": "articles",
  "operating agreement": "operating",
  "ein letter": "ein",
  "certificate of good standing": "good-standing",
}

// The folder a file sits in. Files saved before folders existed are placed by what they are and their labels.
export function folderOf(file = {}) {
  const place = file.propertyId ? "property" : file.companyId ? "company" : ""
  if (!place) return ""
  const folders = foldersFor(place)
  if (file.folder && folders.some((folder) => folder.id === file.folder)) return file.folder
  const labels = (file.labels || []).map((label) => String(label).toLowerCase())
  if (place === "company") {
    for (const label of labels) if (COMPANY_LABEL_FOLDERS[label]) return COMPANY_LABEL_FOLDERS[label]
    return "other"
  }
  if (file.kind === "photo") return "pictures"
  if (file.kind === "receipt") return "renovation"
  for (const label of labels) if (PROPERTY_LABEL_FOLDERS[label]) return PROPERTY_LABEL_FOLDERS[label]
  const type = documentType(file.name) || (String(file.mime || "").startsWith("image/") ? "image" : String(file.mime || "").startsWith("video/") ? "video" : "")
  if (type === "image" || type === "video") return "pictures"
  return "other"
}

// Sounds the app plays while it is open, chosen by each person in Settings › App.
export const RINGTONES = [
  { id: "marimba", name: "Marimba" },
  { id: "classic", name: "Classic phone" },
  { id: "bells", name: "Soft bells" },
  { id: "pulse", name: "Pulse" },
  { id: "beep", name: "Beep (the old one)" },
  { id: "off", name: "Silent (vibrate only)" },
]
export const CHIMES = [
  { id: "chime", name: "Chime" },
  { id: "pop", name: "Pop" },
  { id: "bell", name: "Bell" },
  { id: "marimba", name: "Marimba" },
  { id: "off", name: "Off" },
]
export const DEFAULT_SOUNDS = { ringtone: "marimba", chime: "chime" }

export function cleanSounds(value = {}) {
  return {
    ringtone: RINGTONES.some((item) => item.id === value?.ringtone) ? value.ringtone : DEFAULT_SOUNDS.ringtone,
    chime: CHIMES.some((item) => item.id === value?.chime) ? value.chime : DEFAULT_SOUNDS.chime,
  }
}

export const LOAN_STATUSES = ["Current", "Late", "In default", "Paid off"]
// How often a property's insurance is paid (Property Info). Loans used to hold insurance with "Every 6 months".
export const INSURANCE_FREQUENCIES = ["Monthly", "Quarterly", "Semi-Annually", "Yearly"]

// Insurance payments a year for each frequency, and a property's insurance for a whole year (blank when not entered).
export const INSURANCE_PER_YEAR = { Monthly: 12, Quarterly: 4, "Semi-Annually": 2, Yearly: 1 }
export function yearlyInsurance(property = {}) {
  if (property.insuranceAmount == null || property.insuranceAmount === "") return null
  return Math.round(Number(property.insuranceAmount) * (INSURANCE_PER_YEAR[property.insuranceFrequency] || 1) * 100) / 100
}

// Properties that are no longer owned: no insurance or tax reminders for them.
export const NOT_OWNED_STAGES = ["Sold", "Exit"]

// Utilities on Property Info: Water and Electric are on every property and can't be removed; others can be added.
export const DEFAULT_UTILITIES = ["Water", "Electric"]
export const UTILITY_CHOICES = ["Sewer", "Gas", "Trash", "Internet"]

// A property's utilities, Water and Electric first (always there), then the added ones in order, one per name.
export function propertyUtilities(list = []) {
  const seen = new Set()
  const clean = []
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item?.name || "").replace(/\s+/g, " ").trim().slice(0, 40)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    clean.push({ name, provider: String(item?.provider || "").trim().slice(0, 120), account: String(item?.account || "").trim().slice(0, 120) })
  }
  const fixed = DEFAULT_UTILITIES.map((name) => ({ ...(clean.find((item) => item.name.toLowerCase() === name.toLowerCase()) || { provider: "", account: "" }), name, fixed: true }))
  return [...fixed, ...clean.filter((item) => !DEFAULT_UTILITIES.some((name) => name.toLowerCase() === item.name.toLowerCase())).map((item) => ({ ...item, fixed: false }))]
}

// One status and one open balance per property, from its loans. Paid-off loans carry no balance.
export function loanSummary(loans = []) {
  if (!loans.length) return { count: 0, status: "No loan", balance: null, payment: null }
  const open = loans.filter((loan) => (loan.status || "Current") !== "Paid off")
  if (!open.length) return { count: loans.length, status: "Paid off", balance: 0, payment: 0 }
  const rank = ["Current", "Late", "In default"]
  const status = open.reduce((worst, loan) => {
    const current = rank.includes(loan.status) ? loan.status : "Current"
    return rank.indexOf(current) > rank.indexOf(worst) ? current : worst
  }, "Current")
  const known = open.filter((loan) => loan.balance != null && loan.balance !== "")
  const paying = open.filter((loan) => loan.payment != null && loan.payment !== "")
  return {
    count: loans.length,
    status,
    balance: known.length ? known.reduce((sum, loan) => sum + Number(loan.balance || 0), 0) : null,
    payment: paying.length ? paying.reduce((sum, loan) => sum + Number(loan.payment || 0), 0) : null,
  }
}

// ---- Refinance (BRRRR) ----

// The refinance rules in one place: change the numbers here and every screen follows.
// A house owned more than seasoningMonths is "seasoned" and gets the seasoned leverage; otherwise the unseasoned one.
export const REFINANCE = {
  seasoningMonths: 6,
  seasoned: { status: "Seasoned", percent: 75, kind: "Cash-Out DSCR" },
  unseasoned: { status: "Unseasoned", percent: 80, kind: "Rate-and-Term Refinance" },
  // Refinancing starts once the rehab is done and the house is rented or listed.
  readyStages: ["For rent", "Rented", "For sale"],
  stages: ["Ready to Start", "In Process", "Refinanced"],
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

// A real calendar day written YYYY-MM-DD (not 2026-13-01 or 2026-02-30).
function realDay(day) {
  const match = DAY_KEY.exec(String(day || ""))
  if (!match) return null
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
  const check = new Date(Date.UTC(year, month, date))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month && check.getUTCDate() === date ? { year, month, date } : null
}

// A day (YYYY-MM-DD) some months later; the 31st becomes the last day of a shorter month.
export function addMonths(day, months) {
  const real = realDay(String(day || "").slice(0, 10))
  if (!real) return ""
  const { year, month, date } = real
  const target = new Date(Date.UTC(year, month + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date, last))
  return target.toISOString().slice(0, 10)
}

// Leverage desired, from the purchase date: purchased more than 6 months ago is seasoned (75% cash-out DSCR),
// otherwise unseasoned (80% rate-and-term). today: YYYY-MM-DD.
export function leverageDesired(purchaseDate, today) {
  const bought = String(purchaseDate || "").slice(0, 10)
  if (!realDay(bought)) return { missing: true, text: "Enter Purchase Date" }
  const seasonedAfter = addMonths(bought, REFINANCE.seasoningMonths)
  const seasoned = String(today) > seasonedAfter
  const rule = seasoned ? REFINANCE.seasoned : REFINANCE.unseasoned
  return { missing: false, seasoned, status: rule.status, percent: rule.percent, kind: rule.kind, text: `${rule.status}: ${rule.percent}% ${rule.kind}`, seasonedAfter }
}

// Where a property is in its refinance. One stored stage drives the Financing tab, the banner and the tag on the
// Properties list. today: YYYY-MM-DD (for the leverage).
export function refinancePlan(property = {}, today = "") {
  const eligible = REFINANCE.readyStages.includes(property.stage)
  const stage = REFINANCE.stages.includes(property.refinanceStage) ? property.refinanceStage : REFINANCE.stages[0]
  return {
    eligible,
    stage,
    // The banner and tag show while a refinance is to do (ready to start or in process), not once it is refinanced.
    open: eligible && stage !== REFINANCE.stages[REFINANCE.stages.length - 1],
    label: `Refinance: ${stage}`,
    leverage: leverageDesired(property.purchaseDate, today),
  }
}

export function ensureTaskPermissions(list = []) {
  const selected = knownPermissions(list)
  if (selected.includes(PERMISSIONS.tasksManage) && !selected.includes(PERMISSIONS.tasksAssign)) selected.push(PERMISSIONS.tasksAssign)
  return selected
}

export function permissionsFor(user) {
  if (user?.role === "admin") return [...all]
  const granted = new Set(ROLE_PERMISSIONS[user?.role] || [])
  const extra = [...(user?.extraPermissions || [])]
  const denied = [...(user?.deniedPermissions || [])]
  if (extra.includes("tasks.write")) extra.push(PERMISSIONS.tasksEdit, PERMISSIONS.tasksManage, PERMISSIONS.tasksAssign)
  if (denied.includes("tasks.write")) denied.push(PERMISSIONS.tasksEdit, PERMISSIONS.tasksManage, PERMISSIONS.tasksAssign)
  for (const permission of extra) granted.add(permission)
  for (const permission of denied) granted.delete(permission)
  if (granted.has(PERMISSIONS.tasksManage)) granted.add(PERMISSIONS.tasksAssign)
  return knownPermissions([...granted])
}

export function can(user, permission) {
  return permissionsFor(user).includes(permission)
}

export function assignmentFee(property) {
  // A blank price is not $0: no fee until both prices are entered.
  if ([property?.purchasePrice, property?.houseBoughtPrice].some((value) => value == null || value === "")) return null
  const purchase = Number(property?.purchasePrice)
  const house = Number(property?.houseBoughtPrice)
  if (!Number.isFinite(purchase) || !Number.isFinite(house)) return null
  return purchase - house
}

export function initials(name = "") {
  return name
    .split(/[ .@_-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export const NAV = [
  { href: "/knowledge", label: "Agent", icon: "spark", permission: PERMISSIONS.agentAsk, badge: "NEW", zone: "primary" },
  { href: "/chat", label: "Channels", icon: "hash", permission: PERMISSIONS.chatUse, zone: "primary", countKey: "channels" },
  { href: "/messages", label: "Direct Messages", icon: "chat", permission: PERMISSIONS.chatUse, zone: "primary", countKey: "direct" },
  { href: "/calls", label: "Calls", icon: "phone", permission: PERMISSIONS.chatUse, zone: "primary" },
  { href: "/notifications", label: "Notifications", icon: "bell", permission: PERMISSIONS.activityRead, zone: "primary", countKey: "notifications" },
  { href: "/draws", label: "Draws", icon: "layers", permission: PERMISSIONS.drawsRead, zone: "primary" },
  { href: "/overview", label: "Overview", icon: "grid", permission: PERMISSIONS.propertiesRead, section: "Plan Your Day" },
  { href: "/tasks", label: "Tasks", icon: "check", permission: PERMISSIONS.propertiesRead, section: "Plan Your Day" },
  { href: "/payments", label: "Upcoming Payments", icon: "card", permission: PERMISSIONS.expensesRead, section: "Plan Your Day" },
  { href: "/calendar", label: "Calendar", icon: "calendar", permission: PERMISSIONS.expensesRead, section: "Plan Your Day" },
  { href: "/properties", label: "Properties", icon: "building", permission: PERMISSIONS.propertiesRead, section: "Projects" },
  { href: "/companies", label: "Companies", icon: "buildings", permission: PERMISSIONS.propertiesRead, section: "Projects" },
  { href: "/construction", label: "Construction Intelligence", icon: "chart", permission: PERMISSIONS.drawsRead, section: "Projects", badge: "Soon" },
  { href: "/loans", label: "Loans & Lenders", icon: "bank", permission: PERMISSIONS.propertiesRead, section: "Projects" },
  { href: "/expenses", label: "Expenses", icon: "receipt", permission: PERMISSIONS.expensesRead, section: "Records" },
  { href: "/documents", label: "Documents", icon: "file", permission: PERMISSIONS.documentsRead, section: "Records" },
  { href: "/activity", label: "Team Activity", icon: "pulse", permission: PERMISSIONS.activityRead, section: "Records" },
  { href: "/members", label: "Members", icon: "users", permission: PERMISSIONS.membersManage, section: "Team" },
  { href: "/settings", label: "Settings", icon: "settings", section: "Team" },
]

const CONTRACTOR_NAV = new Set(["/properties", "/expenses", "/tasks", "/chat", "/messages", "/calls"])

export function navFor(user) {
  const items = NAV.filter((item) => !item.permission || can(user, item.permission))
  if (user?.role === "contractor") return items.filter((item) => CONTRACTOR_NAV.has(item.href))
  return items
}

export function homeFor(user) {
  return user?.role === "contractor" ? "/properties" : "/overview"
}

export const AGENT_DEFAULTS = {
  taskModel: "moonshotai/kimi-k3",
  decisionModel: "anthropic/claude-sonnet-5.5",
}

// The AI teammate that works in property chats.
export const TEAMMATE_DEFAULTS = {
  name: "Sam Rivera",
  followUpDays: 3,
  drawEmail: "draws@synergifund.com",
}

// What the AI teammate and people record on a scope line besides its title and budget; kept when the scope is edited.
export const LINE_TRACKING_FIELDS = ["statusBy", "statusAt", "statusNote", "forecastDate", "forecastNote", "forecastBy", "forecastAt"]

export function lineTracking(line) {
  if (!line) return {}
  return Object.fromEntries(LINE_TRACKING_FIELDS.filter((key) => line[key] != null && line[key] !== "").map((key) => [key, line[key]]))
}

export const LINE_STATUSES = ["Not started", "In progress", "Complete"]

export function chatTitleFromPrompt(prompt = "") {
  const text = String(prompt).replace(/\s+/g, " ").trim()
  if (!text) return "New chat"
  const short = text.length > 60 ? `${text.slice(0, 60).replace(/\s+\S*$/, "")}…` : text
  return short.charAt(0).toUpperCase() + short.slice(1)
}

function amountOf(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const FUNDED_STATUSES = new Set(["funded", "partial", "received", "paid"])

export function isPendingDraw(draw) {
  if (!draw) return false
  if (Number(draw.fundedAmount) > 0) return false
  return !FUNDED_STATUSES.has(String(draw.status || "").trim().toLowerCase())
}

export function drawPulled(draw) {
  if (isPendingDraw(draw)) return 0
  if (draw?.fundedAmount != null) return amountOf(draw.fundedAmount)
  return draw?.status === "Funded" ? amountOf(draw.amount) : 0
}

export function drawFigures({ budget, lenderFunding, fundedPercent, draws = [], budgetEstimated = false }) {
  const pendingDraws = draws.filter(isPendingDraw)
  const drawnDraws = draws.filter((draw) => !isPendingDraw(draw))
  const drawn = drawnDraws.reduce((sum, draw) => sum + amountOf(draw.amount), 0)
  const received = drawnDraws.reduce((sum, draw) => sum + drawPulled(draw), 0)
  const pending = pendingDraws.reduce((sum, draw) => sum + amountOf(draw.amount), 0)
  const total = budget == null || budget === "" ? null : amountOf(budget)
  const lender = lenderFunding == null || lenderFunding === "" ? total : amountOf(lenderFunding)
  const share = fundedPercent != null && fundedPercent !== "" ? amountOf(fundedPercent) / 100 : drawn > 0 ? received / drawn : 1
  const available = lender == null ? null : Math.max(0, lender - received)
  return {
    budget: total,
    lenderFunding: lender,
    drawn,
    received,
    pending,
    available,
    availableAfterPending: available == null ? null : Math.max(0, available - pending * share),
    remaining: total == null ? null : Math.max(0, total - drawn - pending),
    budgetUsed: total ? drawn / total : null,
    fundsAvailable: lender ? (available ?? 0) / lender : null,
    fundedShare: share,
    budgetEstimated: Boolean(budgetEstimated && total != null),
    drawCount: drawnDraws.length,
    pendingCount: pendingDraws.length,
  }
}

function positive(value) {
  if (value == null || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function scopeKey(title) {
  return String(title || "").toLowerCase().replace(/\s+/g, " ").trim()
}

export function resolveBudget({ rehabBudget, recordBudget, scopeLines = [], draws = [] }) {
  const explicit = positive(rehabBudget) ?? positive(recordBudget)
  if (explicit != null) return { budget: explicit, estimated: false, source: "budget" }
  const committed = new Map()
  let loose = 0
  for (const draw of draws) {
    let lined = 0
    for (const line of draw.lines || []) {
      const amount = Number(line.amount) || 0
      if (!amount) continue
      committed.set(scopeKey(line.title), (committed.get(scopeKey(line.title)) || 0) + amount)
      lined += amount
    }
    loose += Math.max(0, (Number(draw.amount) || 0) - lined)
  }
  if (!scopeLines.length && !committed.size && !loose) return { budget: null, estimated: false, source: "none" }
  let total = 0
  let budgeted = 0
  let missing = 0
  for (const line of scopeLines) {
    const key = scopeKey(line.title)
    const budget = positive(line.budget)
    if (budget != null) {
      total += budget
      budgeted += 1
    } else {
      total += committed.get(key) || 0
      missing += 1
    }
    committed.delete(key)
  }
  for (const amount of committed.values()) {
    total += amount
    missing += 1
  }
  total += loose
  return {
    budget: total > 0 ? Math.round(total * 100) / 100 : null,
    estimated: missing > 0 || loose > 0 || !budgeted,
    source: budgeted ? "lines" : "drawn",
  }
}

export function drawHealth(figures) {
  if (figures.pending > 0) return "Pending draw"
  if (!figures.drawn) return "Not started"
  if (figures.budgetEstimated) return "In progress"
  if (figures.fundsAvailable != null && figures.fundsAvailable < 0.15) return "Low funds"
  return "In progress"
}

export const MIN_COMPS = 3

export function daysBetween(start, end) {
  if (!start || !end) return null
  const from = new Date(`${String(start).slice(0, 10)}T12:00:00`)
  const to = new Date(`${String(end).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  return Math.round((to - from) / 86400000)
}

function middle(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
}

// The team's ARV rule: each comp's sale price adjusted $10,000 per bedroom and $5,000 per bathroom it has more (or
// fewer) than the subject, then averaged and rounded to the nearest thousand.
export function adjustedCompPrice(comp, subject) {
  const price = Number(comp.salePrice)
  if (!(price > 0)) return null
  const beds = Number(comp.beds) > 0 && Number(subject?.beds) > 0 ? Number(comp.beds) - Number(subject.beds) : 0
  const baths = Number(comp.baths) > 0 && Number(subject?.baths) > 0 ? Number(comp.baths) - Number(subject.baths) : 0
  return price - beds * 10000 - baths * 5000
}

export function compStats(comps = [], subjectSqft = null, subjectRooms = null) {
  const used = comps.filter((comp) => comp.include !== false && Number(comp.salePrice) > 0)
  const prices = used.map((comp) => Number(comp.salePrice))
  const perSqft = used.filter((comp) => Number(comp.sqft) > 0).map((comp) => Number(comp.salePrice) / Number(comp.sqft))
  const days = used.map((comp) => daysBetween(comp.purchaseDate, comp.saleDate)).filter((value) => value != null && value >= 0)
  const sqft = Number(subjectSqft) > 0 ? Number(subjectSqft) : null
  const median = middle(prices)
  const average = prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null
  const ppsfMedian = middle(perSqft)
  const bySqft = sqft && perSqft.length >= MIN_COMPS ? ppsfMedian * sqft : null
  const round = (value) => (value == null ? null : Math.round(value / 100) * 100)
  const rooms = Number(subjectRooms?.beds) > 0 && Number(subjectRooms?.baths) > 0 ? subjectRooms : null
  const adjusted = rooms ? used.map((comp) => adjustedCompPrice(comp, rooms)).filter((value) => value != null) : []
  const teamValue = adjusted.length ? Math.round(adjusted.reduce((sum, value) => sum + value, 0) / adjusted.length / 1000) * 1000 : null
  const methods = [
    teamValue != null && { key: "team", label: `Average of ${adjusted.length} comps adjusted for bedrooms and bathrooms (team ARV rules)`, value: teamValue },
    bySqft != null && { key: "sqft", label: `Median $${Math.round(ppsfMedian).toLocaleString("en-US")}/sq ft × ${sqft.toLocaleString("en-US")} sq ft`, value: round(bySqft) },
    median != null && { key: "median", label: `Median of ${prices.length} comp sales`, value: round(median) },
    average != null && { key: "average", label: `Average of ${prices.length} comp sales`, value: round(average) },
  ].filter(Boolean)
  return {
    count: used.length,
    ready: used.length >= MIN_COMPS,
    low: prices.length ? Math.min(...prices) : null,
    high: prices.length ? Math.max(...prices) : null,
    median,
    average,
    ppsfMedian,
    averageDays: days.length ? Math.round(days.reduce((sum, value) => sum + value, 0) / days.length) : null,
    methods,
    suggested: used.length >= MIN_COMPS ? methods[0] || null : null,
  }
}

export function zillowLink(address, city = "") {
  const text = [address, city].map((part) => String(part || "").trim()).filter(Boolean).join(" ")
  if (!text) return ""
  return `https://www.zillow.com/homes/${text.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}_rb/`
}

export function mapsLink(address, city = "") {
  const text = [address, city].map((part) => String(part || "").trim()).filter(Boolean).join(", ")
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : ""
}

// The state codes a property's State can be (the 50 states, DC and Puerto Rico).
export const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]

// A city typed with the state and ZIP in it ("Jacksonville, FL 32207", "Jacksonville FL"), split into its parts.
// Null when the text is only a city. Without a comma or a ZIP the state must be in capitals, so a city whose last
// word happens to be two letters stays a city.
export function splitCity(text) {
  const match = String(text || "").trim().match(/^(.*?[A-Za-z.])(\s*,\s*|\s+)([A-Za-z]{2})\.?(?:[,\s]+(\d{5})(?:-?(\d{4}))?)?$/)
  if (!match || !US_STATES.includes(match[3].toUpperCase())) return null
  if (!match[2].includes(",") && !match[4] && match[3] !== match[3].toUpperCase()) return null
  return { city: match[1].trim(), state: match[3].toUpperCase(), zip: match[4] ? `${match[4]}${match[5] ? `-${match[5]}` : ""}` : "" }
}

// "Jacksonville, FL 32206": the line under a property's street address, from its city, state and ZIP.
export function cityLine(place = {}) {
  const typed = splitCity(place.city)
  const city = typed ? typed.city : String(place.city || "").trim()
  const state = String(place.state || "").trim().toUpperCase() || typed?.state || ""
  const zip = String(place.zip || "").trim() || typed?.zip || ""
  return [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
}

// The whole address on one line: "103 W 22nd St, Jacksonville, FL 32206".
export function fullAddress(place = {}) {
  return [String(place.address || "").trim(), cityLine(place)].filter(Boolean).join(", ")
}
