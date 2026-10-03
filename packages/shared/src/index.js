export const ROLES = [
  { id: "admin", label: "Admin" },
  { id: "contractor", label: "Contractor" },
  { id: "finance", label: "Finance reporter" },
  { id: "member", label: "Member" },
  { id: "developer", label: "Developer" },
  { id: "investor", label: "Investor / auditor" },
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
  agentAsk: "agent.ask",
  photosRead: "photos.read",
  photosWrite: "photos.write",
  activityRead: "activity.read",
  tasksWrite: "tasks.write",
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
    PERMISSIONS.tasksWrite,
    PERMISSIONS.activityRead,
  ],
  finance: [
    ...readBooks,
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
    PERMISSIONS.tasksWrite,
    PERMISSIONS.activityRead,
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
  ],
  investor: readBooks,
  lender: [
    PERMISSIONS.propertiesRead,
    PERMISSIONS.drawsRead,
    PERMISSIONS.documentsRead,
    PERMISSIONS.photosRead,
    PERMISSIONS.agentAsk,
  ],
}

export const STAGES = ["Under contract", "Lender search", "Renovation", "Exit", "Complete"]

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
  { group: "Money", id: PERMISSIONS.tasksWrite, label: "Edit the to-do list", detail: "Add tasks and mark them done." },
  { group: "Documents", id: PERMISSIONS.documentsRead, label: "View documents", detail: "Open files in the knowledge base." },
  { group: "Documents", id: PERMISSIONS.documentsWrite, label: "Upload documents", detail: "Add files and weekly photos." },
  { group: "Documents", id: PERMISSIONS.documentsDelete, label: "Remove documents", detail: "Delete a file from the library." },
  { group: "Documents", id: PERMISSIONS.importsRun, label: "Import Excel", detail: "Load workbooks into properties." },
  { group: "Documents", id: PERMISSIONS.photosRead, label: "View photos", detail: "See weekly house photos and draw reports." },
  { group: "Documents", id: PERMISSIONS.photosWrite, label: "File photos", detail: "Upload a weekly photo set." },
  { group: "People", id: PERMISSIONS.membersManage, label: "Manage members", detail: "Invite people and set what they can do." },
  { group: "People", id: PERMISSIONS.activityRead, label: "See activity", detail: "Read the activity log and notifications." },
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

export function permissionsFor(user) {
  if (user?.role === "admin") return [...all]
  const granted = new Set(ROLE_PERMISSIONS[user?.role] || [])
  for (const permission of user?.extraPermissions || []) granted.add(permission)
  for (const permission of user?.deniedPermissions || []) granted.delete(permission)
  return [...granted]
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
  { href: "/notifications", label: "Notifications", icon: "bell", permission: PERMISSIONS.activityRead, zone: "primary", countKey: "notifications" },
  { href: "/draws", label: "Draws", icon: "layers", permission: PERMISSIONS.drawsRead, zone: "primary" },
  { href: "/overview", label: "Overview", icon: "grid", permission: PERMISSIONS.propertiesRead, section: "Plan your day" },
  { href: "/tasks", label: "To-do list", icon: "check", permission: PERMISSIONS.propertiesRead, section: "Plan your day" },
  { href: "/payments", label: "Upcoming payments", icon: "card", permission: PERMISSIONS.expensesRead, section: "Plan your day" },
  { href: "/calendar", label: "Payment calendar", icon: "calendar", permission: PERMISSIONS.expensesRead, section: "Plan your day" },
  { href: "/properties", label: "Properties", icon: "building", permission: PERMISSIONS.propertiesRead, section: "Projects" },
  { href: "/construction", label: "Construction intelligence", icon: "chart", permission: PERMISSIONS.drawsRead, section: "Projects" },
  { href: "/loans", label: "Loans & lenders", icon: "bank", permission: PERMISSIONS.propertiesRead, section: "Projects" },
  { href: "/expenses", label: "Expenses", icon: "receipt", permission: PERMISSIONS.expensesRead, section: "Records" },
  { href: "/documents", label: "Documents", icon: "file", permission: PERMISSIONS.documentsRead, section: "Records" },
  { href: "/activity", label: "Team activity", icon: "pulse", permission: PERMISSIONS.activityRead, section: "Records" },
  { href: "/members", label: "Members", icon: "users", permission: PERMISSIONS.membersManage, section: "Team" },
]

const CONTRACTOR_NAV = new Set(["/properties", "/expenses"])

export function navFor(user) {
  const items = NAV.filter((item) => !item.permission || can(user, item.permission))
  if (user?.role === "contractor") return items.filter((item) => CONTRACTOR_NAV.has(item.href))
  return items
}

export function homeFor(user) {
  return user?.role === "contractor" ? "/properties" : "/overview"
}
