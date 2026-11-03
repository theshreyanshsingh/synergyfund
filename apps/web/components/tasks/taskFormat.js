import { TASK_PRIORITIES, TASK_STATUSES } from "@synergifund/shared"

// The four statuses (fixed) and their pill colors, the priorities, and the columns everyone shares.
export const STATUS_TONE = { "Not started": "grey", "In progress": "blue", Waiting: "orange", Completed: "green" }
export const PRIORITY_TONE = { High: "high", Medium: "medium", Low: "low" }
export const OPEN_STATUSES = TASK_STATUSES.filter((status) => status !== "Completed")
export { TASK_PRIORITIES, TASK_STATUSES }

// Left to right, after the checkbox and the task's name. `createdBy` (Assigned by) starts hidden.
export const COLUMNS = [
  { key: "property", label: "Property" },
  { key: "assignee", label: "Assigned to" },
  { key: "status", label: "Status" },
  { key: "due", label: "Due" },
  { key: "priority", label: "Priority" },
  { key: "labels", label: "Labels" },
  { key: "createdBy", label: "Assigned by" },
]

export const GROUPS = [
  { key: "status", label: "Status" },
  { key: "property", label: "Property" },
  { key: "assignee", label: "Assigned to" },
  { key: "due", label: "Due" },
  { key: "priority", label: "Priority" },
]

export const SORTS = [
  { key: "title", label: "Task" },
  { key: "property", label: "Property" },
  { key: "assignee", label: "Assigned to" },
  { key: "status", label: "Status" },
  { key: "due", label: "Due" },
  { key: "priority", label: "Priority" },
  { key: "createdBy", label: "Assigned by" },
  { key: "created", label: "Date added" },
]

export const DUE_FILTERS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "none", label: "No date" },
]

export const COMPLETED_KEY = "completed"

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function shiftDay(key, days) {
  const [year, month, day] = key.split("-").map(Number)
  return todayKey(new Date(year, month - 1, day + days, 12))
}

export function parseDay(key) {
  const [year, month, day] = String(key || "").split("-").map(Number)
  return year && month && day ? new Date(year, month - 1, day, 12) : null
}

// "Nov 4", or "Nov 4, 2027" when it is not this year.
export function dueLabel(key) {
  const date = parseDay(key)
  if (!date) return ""
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}

// Which due-date bucket an open task is in (This week is the next 7 days after today).
export function dueBucket(task, today = todayKey()) {
  if (!task.due) return "none"
  if (task.due < today) return "overdue"
  if (task.due === today) return "today"
  if (task.due <= shiftDay(today, 7)) return "week"
  return "later"
}

export function isOverdue(task, today = todayKey()) {
  return Boolean(task.due) && task.status !== "Completed" && task.due < today
}

const RANK = {
  status: (task) => TASK_STATUSES.indexOf(task.status),
  priority: (task) => TASK_PRIORITIES.indexOf(task.priority),
}

function text(value) {
  return String(value || "").toLowerCase()
}

// Sorting within each group: by the picked column, else by due date (no date last), then when added.
export function sortTasks(tasks, sort) {
  const dir = sort?.dir === "desc" ? -1 : 1
  const by = sort?.key
  const compare = (a, b) => {
    if (by === "title") return text(a.title).localeCompare(text(b.title))
    if (by === "property") return (a.property ? 0 : 1) - (b.property ? 0 : 1) || text(a.property).localeCompare(text(b.property))
    if (by === "assignee") return (a.assigneeName ? 0 : 1) - (b.assigneeName ? 0 : 1) || text(a.assigneeName).localeCompare(text(b.assigneeName))
    if (by === "createdBy") return (a.createdByName ? 0 : 1) - (b.createdByName ? 0 : 1) || text(a.createdByName).localeCompare(text(b.createdByName))
    if (by === "status" || by === "priority") return RANK[by](a) - RANK[by](b)
    if (by === "created") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
    return (a.due ? 0 : 1) - (b.due ? 0 : 1) || String(a.due).localeCompare(String(b.due))
  }
  return [...tasks].sort((a, b) => compare(a, b) * (by ? dir : 1) || new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
}

// The groups for `groupBy`, open tasks in theirs and every completed one in Completed at the bottom. `add` is what a
// task added in that group gets (null: no Add task row there).
export function groupTasks(tasks, groupBy, { people = [], properties = [], fixedProperty = "", today = todayKey() } = {}) {
  const open = tasks.filter((task) => task.status !== "Completed")
  const done = tasks.filter((task) => task.status === "Completed")
  let groups
  if (groupBy === "property" && !fixedProperty) {
    const seen = new Map()
    for (const task of open) if (task.propertyId) seen.set(task.propertyId, task.property || properties.find((item) => item.id === task.propertyId)?.address || "Property")
    groups = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ key: `property:${id}`, name, items: open.filter((task) => task.propertyId === id), add: { propertyId: id } }))
    groups.push({ key: "property:none", name: "No property", items: open.filter((task) => !task.propertyId), add: { propertyId: "" } })
  } else if (groupBy === "assignee") {
    const seen = new Map()
    for (const task of open) if (task.assigneeId) seen.set(task.assigneeId, task.assigneeName || people.find((person) => person.id === task.assigneeId)?.name || "Someone")
    groups = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ key: `assignee:${id}`, name, items: open.filter((task) => task.assigneeId === id), add: { assigneeId: id } }))
    groups.push({ key: "assignee:none", name: "Unassigned", items: open.filter((task) => !task.assigneeId), add: {} })
  } else if (groupBy === "due") {
    groups = [
      { key: "due:overdue", name: "Overdue", tone: "bad", items: open.filter((task) => dueBucket(task, today) === "overdue"), add: null },
      { key: "due:today", name: "Today", items: open.filter((task) => dueBucket(task, today) === "today"), add: { due: today } },
      { key: "due:week", name: "This week", items: open.filter((task) => dueBucket(task, today) === "week"), add: { due: shiftDay(today, 1) } },
      { key: "due:later", name: "Later", items: open.filter((task) => dueBucket(task, today) === "later"), add: null },
      { key: "due:none", name: "No date", items: open.filter((task) => dueBucket(task, today) === "none"), add: {} },
    ]
  } else if (groupBy === "priority") {
    groups = TASK_PRIORITIES.map((priority) => ({ key: `priority:${priority}`, name: priority, tone: PRIORITY_TONE[priority], items: open.filter((task) => task.priority === priority), add: { priority } }))
  } else {
    groups = OPEN_STATUSES.map((status) => ({ key: `status:${status}`, name: status, tone: STATUS_TONE[status], items: open.filter((task) => task.status === status), add: { status } }))
  }
  groups.push({ key: COMPLETED_KEY, name: "Completed", tone: "green", items: done, add: { status: "Completed" } })
  return groups
}

// Search, Me and the filters (any of the ticked values in a category; every category that has ticks).
export function filterTasks(tasks, { query = "", me = false, meId = "", filters = {}, today = todayKey() }) {
  const needle = query.trim().toLowerCase()
  const has = (list) => Array.isArray(list) && list.length > 0
  return tasks.filter((task) => {
    if (me && task.assigneeId !== meId) return false
    if (needle && ![task.title, task.property, task.assigneeName, task.createdByName, task.notes, ...(task.labels || [])].join(" ").toLowerCase().includes(needle)) return false
    if (has(filters.status) && !filters.status.includes(task.status)) return false
    if (has(filters.priority) && !filters.priority.includes(task.priority)) return false
    if (has(filters.assignee) && !filters.assignee.includes(task.assigneeId || "none")) return false
    if (has(filters.property) && !filters.property.includes(task.propertyId || "none")) return false
    if (has(filters.label) && !(task.labels || []).some((label) => filters.label.includes(label))) return false
    if (has(filters.due)) {
      const bucket = dueBucket(task, today)
      if (!filters.due.some((key) => (key === "week" ? bucket === "week" || bucket === "today" : key === "overdue" ? task.status !== "Completed" && bucket === "overdue" : bucket === key))) return false
    }
    return true
  })
}

// "Just now", "5 min ago", "3 h ago", "Oct 15".
export function sinceLabel(value) {
  const date = new Date(value)
  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}
