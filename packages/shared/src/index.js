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
  "Materials",
  "Technology",
  "Acquisition",
  "Financing",
  "Utilities",
  "Insurance & taxes",
  "Selling costs",
  "Other",
]

export const EXPENSE_STATUSES = ["Draft", "Submitted", "Needs information", "Needs second approval", "Approved", "Rejected"]

export const PAYING_ENTITIES = ["Investment company", "Construction company"]

export const PAYMENT_CATEGORIES = ["Mortgage", "Insurance", "Property taxes", "Utilities", "HOA", "Contractor", "Materials", "Loan payoff", "Other"]

export const PAYMENT_RECURRENCES = ["One time", "Weekly", "Every 2 weeks", "Monthly", "Quarterly", "Yearly"]

export const APPROVAL_THRESHOLD = 5000

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
export const INSURANCE_FREQUENCIES = ["Monthly", "Quarterly", "Every 6 months", "Yearly"]

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
