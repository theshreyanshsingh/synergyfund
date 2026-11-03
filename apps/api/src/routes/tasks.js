import { Router } from "express"
import mongoose from "mongoose"
import { PERMISSIONS, TASK_LABELS, TASK_PRIORITIES, TASK_STATUSES, taskStatus } from "@synergifund/shared"
import { DocumentFile, Property, ReviewItem, Task, TaskComment, User } from "../models/index.js"
import { asyncHandler, requireAnyPermission, requirePermission, sendError } from "../lib/http.js"
import { propertyFilter } from "../services/access.js"
import { deleteStoredFile, saveUploadedFile, sendStoredFile, upload } from "../services/files.js"
import { changeSummary, notify, recordActivity } from "../services/notify.js"
import { isDay, teamToday } from "../lib/dates.js"

// Tasks: a fixed set of fields everyone shares (name, property, assignee, status, due, priority, labels, who added
// it), a log of what changed, comments with @mentions and files, and each person's own way of viewing the list.
export const tasksRouter = Router()

const TASK_FIELDS = [["title", "Task"], ["due", "Due"], ["priority", "Priority"], ["labels", "Labels"], ["owner", "Assignee"], ["notes", "Description"]]
const MAX_TITLE = 300
const MAX_HISTORY = 200
const MAX_COMMENT = 5000
const MAX_COMMENT_FILES = 5
const COMMENT_FILES = /\.(pdf|png|jpe?g|gif|webp|heic|docx?|xlsx?|xlsm|csv|txt|mp4|mov)$/i
const VIEW_KEYS = ["main", "property"]
const VIEW_COLUMNS = ["property", "assignee", "status", "due", "priority", "labels", "createdBy"]
const VIEW_GROUPS = ["status", "property", "assignee", "due", "priority"]
const VIEW_SORTS = ["title", "property", "assignee", "status", "due", "priority", "createdBy", "created"]
const VIEW_DUE = ["overdue", "today", "week", "none"]
const BULK = ["status", "assignee", "due", "delete"]

export function presentTask(task, person, includeEmail, extra = {}) {
  return {
    id: String(task._id),
    title: task.title,
    owner: person?.name || task.owner || "",
    assigneeId: task.assigneeId ? String(task.assigneeId) : "",
    assigneeName: person?.name || task.owner || "",
    assigneeEmail: includeEmail ? person?.email || "" : "",
    due: task.due || "",
    priority: TASK_PRIORITIES.includes(task.priority) ? task.priority : "Medium",
    labels: task.labels || [],
    done: Boolean(task.done),
    status: taskStatus(task),
    propertyId: task.propertyId ? String(task.propertyId) : "",
    notes: task.notes || "",
    createdById: task.createdBy ? String(task.createdBy) : "",
    createdByName: task.createdByName || "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...extra,
  }
}

export async function assigneeMap(tasks) {
  const ids = [...new Set(tasks.map((task) => task.assigneeId).filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const people = await User.find({ _id: { $in: ids } }).select("name email")
  return new Map(people.map((person) => [String(person._id), person]))
}

// The tasks this person can see: a contractor only theirs; everyone else those on properties they can open, and those
// on no property.
async function taskScope(req) {
  if (req.user.role === "contractor") return { assigneeId: req.user._id }
  const properties = await Property.find(propertyFilter(req.user)).select("_id")
  return { $or: [{ propertyId: { $in: properties.map((property) => property._id) } }, { propertyId: null }] }
}

async function visibleTask(req, id) {
  if (!mongoose.isValidObjectId(id)) return null
  const task = await Task.findById(id)
  if (!task) return null
  if (req.user.role === "contractor") return String(task.assigneeId || "") === String(req.user._id) ? task : null
  if (!task.propertyId) return task
  const allowed = await Property.exists({ _id: task.propertyId, ...propertyFilter(req.user) })
  return allowed ? task : null
}

async function propertyNames(tasks) {
  const ids = [...new Set(tasks.map((task) => task.propertyId).filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const properties = await Property.find({ _id: { $in: ids } }).select("address")
  return new Map(properties.map((property) => [String(property._id), property.address]))
}

async function commentCounts(tasks) {
  if (!tasks.length) return new Map()
  const rows = await TaskComment.aggregate([{ $match: { taskId: { $in: tasks.map((task) => task._id) } } }, { $group: { _id: "$taskId", count: { $sum: 1 } } }])
  return new Map(rows.map((row) => [String(row._id), row.count]))
}

async function presentList(req, tasks) {
  const [people, names, counts] = await Promise.all([assigneeMap(tasks), propertyNames(tasks), commentCounts(tasks)])
  const includeEmail = req.permissions.includes(PERMISSIONS.tasksAssign)
  return tasks.map((task) => presentTask(task, people.get(String(task.assigneeId || "")), includeEmail, {
    property: names.get(String(task.propertyId || "")) || "",
    commentCount: counts.get(String(task._id)) || 0,
  }))
}

function canEdit(req) {
  return req.permissions.includes(PERMISSIONS.tasksEdit) || req.permissions.includes(PERMISSIONS.tasksManage)
}

function note(task, user, text) {
  task.history = [...(task.history || []), { at: new Date(), byName: user.name, text }].slice(-MAX_HISTORY)
}

// "Nov 20", or "Nov 20, 2027" outside this year.
function dayLabel(key) {
  const [year, month, day] = String(key).split("-").map(Number)
  const date = new Date(year, month - 1, day, 12)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}

// Completing keeps the status it had, to go back to on reopening.
function setStatus(task, next) {
  const current = taskStatus(task)
  if (next === current) return false
  if (next === "Completed") {
    task.previousStatus = current
    task.done = true
    task.status = "Completed"
  } else {
    task.done = false
    task.status = next
  }
  return true
}

function reopenedStatus(task) {
  return TASK_STATUSES.includes(task.previousStatus) && task.previousStatus !== "Completed" ? task.previousStatus : "Not started"
}

function cleanLabels(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",")
  const labels = []
  for (const item of list) {
    const typed = String(item || "").trim().replace(/\s+/g, " ").slice(0, 32)
    const label = TASK_LABELS.find((known) => known.toLowerCase() === typed.toLowerCase()) || typed
    if (!label || labels.some((existing) => existing.toLowerCase() === label.toLowerCase())) continue
    labels.push(label)
    if (labels.length === 8) break
  }
  return labels
}

function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE)
}

async function readAssignee(req, res) {
  if (!("assigneeId" in req.body)) return { assignee: null, given: false }
  if (!req.permissions.includes(PERMISSIONS.tasksAssign)) {
    sendError(res, 403, "You do not have permission to assign tasks.")
    return null
  }
  const value = String(req.body.assigneeId || "").trim()
  if (!value) return { assignee: null, given: true }
  if (!mongoose.isValidObjectId(value)) {
    sendError(res, 400, "Choose an assignee from the list.")
    return null
  }
  const assignee = await User.findOne({ _id: value, bot: { $ne: true } }).select("name email")
  if (!assignee) {
    sendError(res, 400, "Choose an assignee from the list.")
    return null
  }
  return { assignee, given: true }
}

// A property for a task: one this person can open ("" for none).
async function readProperty(req, res) {
  if (!("propertyId" in req.body)) return { given: false }
  const value = String(req.body.propertyId || "").trim()
  if (!value) return { given: true, property: null }
  const property = mongoose.isValidObjectId(value) ? await Property.findOne({ _id: value, ...propertyFilter(req.user) }).select("address") : null
  if (!property) {
    sendError(res, 400, "Choose a property from the list.")
    return null
  }
  return { given: true, property }
}

function readDue(req, res) {
  if (!("due" in req.body)) return { given: false }
  const due = String(req.body.due || "").trim()
  if (due && !isDay(due)) {
    sendError(res, 400, "Pick a due date from the calendar.")
    return null
  }
  return { given: true, due }
}

async function mailAssignee({ user, task, assignee }) {
  if (!assignee) return { status: "Skipped" }
  if (!assignee.email) return { status: "Failed", error: "The assignee has no email address." }
  const property = task.propertyId ? await Property.findById(task.propertyId).select("address").catch(() => null) : null
  return notify({
    userIds: [assignee._id],
    title: `Task assigned: ${task.title}`,
    body: String(assignee._id) === String(user._id) ? `You assigned yourself “${task.title}”.` : `${user.name} assigned you “${task.title}”.`,
    details: [
      ["Property", property?.address || ""],
      ["Due", task.due || "No due date"],
      ["Priority", task.priority || ""],
      ["Labels", (task.labels || []).join(", ")],
      ["Description", task.notes || ""],
      ["Assigned by", user.name],
    ],
    // Opens Tasks on this task.
    href: `/tasks?task=${task._id}`,
    event: "task.assigned",
  })
}

async function moveOpenReviewsOntoTasks() {
  const open = await ReviewItem.find({ status: "Open" })
  for (const item of open) {
    const already = await Task.findOne({ reviewId: item._id })
    if (!already) {
      await Task.create({
        title: item.title,
        notes: item.detail || "",
        propertyId: item.propertyId,
        labels: ["Verify"],
        priority: "High",
        reviewId: item._id,
      })
    }
    item.status = "Moved"
    await item.save()
  }
}

// How someone left the page: what is grouped, sorted, filtered and hidden, which groups are folded.
function cleanView(value) {
  const view = value && typeof value === "object" ? value : {}
  const pick = (list, allowed, limit = 50) => [...new Set((Array.isArray(list) ? list : []).map(String))].filter((item) => !allowed || allowed.includes(item)).slice(0, limit)
  const ids = (list) => pick(list, null).filter((id) => id === "none" || mongoose.isValidObjectId(id))
  const filters = view.filters && typeof view.filters === "object" ? view.filters : {}
  return {
    groupBy: VIEW_GROUPS.includes(view.groupBy) ? view.groupBy : "status",
    sort: { key: VIEW_SORTS.includes(view.sort?.key) ? view.sort.key : "", dir: view.sort?.dir === "desc" ? "desc" : "asc" },
    hidden: pick(view.hidden, VIEW_COLUMNS),
    me: view.me === true,
    filters: {
      status: pick(filters.status, TASK_STATUSES),
      priority: pick(filters.priority, TASK_PRIORITIES),
      assignee: ids(filters.assignee),
      property: ids(filters.property),
      label: pick(filters.label, null).map((label) => label.slice(0, 32)),
      due: pick(filters.due, VIEW_DUE),
    },
    collapsed: pick(view.collapsed, null, 100).map((key) => key.slice(0, 80)),
  }
}

const DEFAULT_VIEW = { ...cleanView({}), hidden: ["createdBy"], collapsed: ["completed"] }

tasksRouter.get(
  "/",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    await moveOpenReviewsOntoTasks()
    const filter = await taskScope(req)
    if (req.query.propertyId) {
      if (!mongoose.isValidObjectId(req.query.propertyId)) return sendError(res, 404, "That property was not found.")
      filter.propertyId = req.query.propertyId
    }
    const items = await Task.find(filter).sort({ done: 1, due: 1, createdAt: 1 })
    const key = VIEW_KEYS.includes(req.query.view) ? req.query.view : "main"
    const saved = req.user.taskViews?.[key]
    // `today` on the team's clock, for overdue and the due-date groups.
    res.json({ items: await presentList(req, items), view: saved ? cleanView(saved) : DEFAULT_VIEW, today: teamToday() })
  }),
)

tasksRouter.get(
  "/assignees",
  requirePermission(PERMISSIONS.tasksAssign),
  asyncHandler(async (req, res) => {
    const users = await User.find({ bot: { $ne: true } }).select("name email").sort({ name: 1, email: 1 })
    res.json({ items: users.map((user) => ({ id: String(user._id), name: user.name, email: user.email })) })
  }),
)

// Each person's toolbar settings, so the page opens the way they left it.
tasksRouter.patch(
  "/view",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const key = VIEW_KEYS.includes(req.body.key) ? req.body.key : "main"
    const view = cleanView(req.body.view)
    req.user.taskViews = { ...(req.user.taskViews || {}), [key]: view }
    req.user.markModified("taskViews")
    await req.user.save()
    res.json({ view })
  }),
)

tasksRouter.post(
  "/",
  requirePermission(PERMISSIONS.tasksManage),
  asyncHandler(async (req, res) => {
    const title = cleanTitle(req.body.title)
    if (!title) return sendError(res, 400, "Describe what needs to happen.")
    const assignee = await readAssignee(req, res)
    if (!assignee) return
    const place = await readProperty(req, res)
    if (!place) return
    const due = readDue(req, res)
    if (!due) return
    const status = TASK_STATUSES.includes(req.body.status) ? req.body.status : "Not started"
    const task = new Task({
      title,
      propertyId: place.property?._id,
      assigneeId: assignee.assignee?._id,
      owner: assignee.assignee?.name || "",
      due: due.due || "",
      priority: TASK_PRIORITIES.includes(req.body.priority) ? req.body.priority : "Medium",
      labels: cleanLabels(req.body.labels),
      notes: String(req.body.notes || "").slice(0, 20000),
      createdBy: req.user._id,
      createdByName: req.user.name,
      status: status === "Completed" ? "Completed" : status,
      done: status === "Completed",
      previousStatus: status === "Completed" ? "Not started" : undefined,
      history: [{ at: new Date(), byName: req.user.name, text: "Created" }],
    })
    await task.save()
    // A task added for yourself on Home (quiet) needs no notice that you assigned it to yourself.
    const forSelf = req.body.quiet === true && assignee.assignee && String(assignee.assignee._id) === String(req.user._id)
    const mail = forSelf ? { status: "Skipped" } : await mailAssignee({ user: req.user, task, assignee: assignee.assignee })
    await recordActivity({
      user: req.user,
      title: "Task created",
      detail: [task.title, task.owner ? `Assigned to ${task.owner}` : "Unassigned", task.due ? `Due ${task.due}` : ""].filter(Boolean).join(" · "),
      propertyId: task.propertyId,
    })
    const [item] = await presentList(req, [task])
    res.status(201).json({ task: item, mail })
  }),
)

// Several tasks at once: a status, an assignee or a due date for all of them, or delete them.
tasksRouter.post(
  "/bulk",
  requireAnyPermission(PERMISSIONS.tasksEdit, PERMISSIONS.tasksManage, PERMISSIONS.tasksAssign),
  asyncHandler(async (req, res) => {
    const action = String(req.body.action || "")
    if (!BULK.includes(action)) return sendError(res, 400, "Choose what to change.")
    const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(String))].slice(0, 500)
    if (!ids.length) return sendError(res, 400, "Select the tasks first.")
    if ((action === "status" || action === "due") && !canEdit(req)) return sendError(res, 403, "You do not have permission to edit tasks.")
    if (action === "assignee" && !req.permissions.includes(PERMISSIONS.tasksAssign)) return sendError(res, 403, "You do not have permission to assign tasks.")
    if (action === "delete" && !req.permissions.includes(PERMISSIONS.tasksManage)) return sendError(res, 403, "You do not have permission to delete tasks.")
    if (action === "status" && !TASK_STATUSES.includes(req.body.value)) return sendError(res, 400, "Choose a status.")
    let assignee = null
    if (action === "assignee") {
      req.body.assigneeId = req.body.value
      const read = await readAssignee(req, res)
      if (!read) return
      assignee = read.assignee
    }
    const due = action === "due" ? String(req.body.value || "").trim() : ""
    if (action === "due" && due && !isDay(due)) return sendError(res, 400, "Pick a due date from the calendar.")
    const tasks = (await Promise.all(ids.map((id) => visibleTask(req, id)))).filter(Boolean)
    if (!tasks.length) return sendError(res, 404, "Those tasks were not found.")
    if (action === "delete") {
      for (const task of tasks) await removeTask(task)
      await recordActivity({ user: req.user, title: "Tasks deleted", detail: `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}: ${tasks.map((task) => task.title).slice(0, 5).join(", ")}${tasks.length > 5 ? "…" : ""}` })
      return res.json({ deleted: tasks.map((task) => String(task._id)) })
    }
    const changed = []
    for (const task of tasks) {
      if (action === "status" && setStatus(task, req.body.value)) note(task, req.user, req.body.value === "Completed" ? "Completed" : `Status changed to ${req.body.value}`)
      else if (action === "due" && (task.due || "") !== due) {
        task.due = due
        note(task, req.user, due ? `Due date changed to ${dayLabel(due)}` : "Due date removed")
      } else if (action === "assignee" && String(task.assigneeId || "") !== String(assignee?._id || "")) {
        task.assigneeId = assignee ? assignee._id : null
        task.owner = assignee?.name || ""
        note(task, req.user, assignee ? `Assigned to ${assignee.name}` : "Unassigned")
      } else continue
      await task.save()
      changed.push(task)
    }
    // One notice to the new assignee for all of them, not one each.
    let mail = { status: "Skipped" }
    if (action === "assignee" && assignee && changed.length && String(assignee._id) !== String(req.user._id)) {
      mail = changed.length === 1
        ? await mailAssignee({ user: req.user, task: changed[0], assignee })
        : await notify({
          userIds: [assignee._id],
          title: `${changed.length} tasks assigned to you`,
          body: `${req.user.name} assigned you ${changed.length} tasks: ${changed.map((task) => `“${task.title}”`).slice(0, 5).join(", ")}${changed.length > 5 ? "…" : ""}.`,
          details: changed.slice(0, 10).map((task) => ["Task", task.title]),
          href: "/tasks",
          event: "task.assigned",
        })
    }
    if (changed.length) {
      const what = action === "status" ? `Status set to ${req.body.value}` : action === "due" ? (due ? `Due ${due}` : "Due date removed") : assignee ? `Assigned to ${assignee.name}` : "Unassigned"
      await recordActivity({ user: req.user, title: "Tasks updated", detail: `${changed.length} ${changed.length === 1 ? "task" : "tasks"} · ${what}` })
    }
    res.json({ tasks: await presentList(req, tasks), mail })
  }),
)

tasksRouter.get(
  "/:id",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const task = await visibleTask(req, req.params.id)
    if (!task) return sendError(res, 404, "That task was not found.")
    const [item] = await presentList(req, [task])
    res.json({ task: { ...item, history: (task.history || []).map((entry) => ({ at: entry.at, byName: entry.byName || "", text: entry.text || "" })) } })
  }),
)

tasksRouter.patch(
  "/:id",
  requireAnyPermission(PERMISSIONS.tasksEdit, PERMISSIONS.tasksManage, PERMISSIONS.tasksAssign),
  asyncHandler(async (req, res) => {
    const task = await visibleTask(req, req.params.id)
    if (!task) return sendError(res, 404, "That task was not found.")
    const editing = ["title", "due", "priority", "labels", "notes", "done", "status", "propertyId"].some((key) => key in req.body)
    if (editing && !canEdit(req)) return sendError(res, 403, "You do not have permission to edit tasks.")
    if ("status" in req.body && !TASK_STATUSES.includes(req.body.status)) return sendError(res, 400, "Choose a status.")
    if ("priority" in req.body && !TASK_PRIORITIES.includes(req.body.priority)) return sendError(res, 400, "Choose a priority.")
    if ("title" in req.body && !cleanTitle(req.body.title)) return sendError(res, 400, "Give the task a name.")
    const assignee = await readAssignee(req, res)
    if (!assignee) return
    const place = await readProperty(req, res)
    if (!place) return
    const due = readDue(req, res)
    if (!due) return
    const before = task.toObject()
    const previousAssignee = String(task.assigneeId || "")
    if (assignee.given && String(assignee.assignee?._id || "") !== previousAssignee) {
      task.assigneeId = assignee.assignee ? assignee.assignee._id : null
      task.owner = assignee.assignee?.name || ""
      note(task, req.user, assignee.assignee ? `Assigned to ${assignee.assignee.name}` : "Unassigned")
    }
    if ("status" in req.body) {
      const was = taskStatus(task)
      if (setStatus(task, req.body.status)) note(task, req.user, req.body.status === "Completed" ? "Completed" : was === "Completed" ? `Reopened as ${req.body.status}` : `Status changed to ${req.body.status}`)
    } else if ("done" in req.body) {
      const next = req.body.done ? "Completed" : reopenedStatus(task)
      if (setStatus(task, next)) note(task, req.user, next === "Completed" ? "Completed" : `Reopened as ${next}`)
    }
    if ("title" in req.body && cleanTitle(req.body.title) !== task.title) {
      task.title = cleanTitle(req.body.title)
      note(task, req.user, "Renamed")
    }
    if (due.given && due.due !== (task.due || "")) {
      task.due = due.due
      note(task, req.user, due.due ? `Due date changed to ${dayLabel(due.due)}` : "Due date removed")
    }
    if ("priority" in req.body && req.body.priority !== task.priority) {
      task.priority = req.body.priority
      note(task, req.user, `Priority changed to ${req.body.priority}`)
    }
    if ("labels" in req.body) {
      const labels = cleanLabels(req.body.labels)
      if (labels.join("|") !== (task.labels || []).join("|")) {
        task.labels = labels
        note(task, req.user, labels.length ? `Labels changed to ${labels.join(", ")}` : "Labels removed")
      }
    }
    if (place.given && String(place.property?._id || "") !== String(task.propertyId || "")) {
      task.propertyId = place.property ? place.property._id : null
      note(task, req.user, place.property ? `Property changed to ${place.property.address}` : "Property removed")
    }
    if ("notes" in req.body && String(req.body.notes || "") !== (task.notes || "")) {
      task.notes = String(req.body.notes || "").slice(0, 20000)
      note(task, req.user, "Description changed")
    }
    await task.save()
    const changedAssignee = assignee.given && String(task.assigneeId || "") !== previousAssignee
    const mail = changedAssignee ? await mailAssignee({ user: req.user, task, assignee: assignee.assignee }) : "Skipped"
    const after = task.toObject()
    const title = before.done !== after.done ? (after.done ? "Task completed" : "Task reopened") : changedAssignee ? "Task assigned" : "Task updated"
    const changes = [changeSummary(before, after, TASK_FIELDS.filter(([key]) => key !== "title")), before.status !== after.status && before.done === after.done ? `Status ${taskStatus(before)} → ${taskStatus(after)}` : ""].filter(Boolean).join(" · ")
    await recordActivity({ user: req.user, title, detail: [task.title, changes].filter(Boolean).join(" · "), propertyId: task.propertyId })
    const [item] = await presentList(req, [task])
    res.json({ task: { ...item, history: (task.history || []).map((entry) => ({ at: entry.at, byName: entry.byName || "", text: entry.text || "" })) }, mail })
  }),
)

tasksRouter.post(
  "/:id/duplicate",
  requirePermission(PERMISSIONS.tasksManage),
  asyncHandler(async (req, res) => {
    const original = await visibleTask(req, req.params.id)
    if (!original) return sendError(res, 404, "That task was not found.")
    const status = taskStatus(original) === "Completed" ? "Not started" : taskStatus(original)
    const task = await Task.create({
      title: cleanTitle(`${original.title} (copy)`),
      propertyId: original.propertyId,
      assigneeId: original.assigneeId,
      owner: original.owner,
      due: original.due,
      priority: original.priority,
      labels: original.labels,
      notes: original.notes,
      status,
      createdBy: req.user._id,
      createdByName: req.user.name,
      history: [{ at: new Date(), byName: req.user.name, text: `Created as a copy of “${original.title}”` }],
    })
    const assignee = task.assigneeId ? await User.findById(task.assigneeId).select("name email") : null
    const mail = assignee && String(assignee._id) !== String(req.user._id) ? await mailAssignee({ user: req.user, task, assignee }) : { status: "Skipped" }
    await recordActivity({ user: req.user, title: "Task created", detail: `${task.title} · Copy of “${original.title}”`, propertyId: task.propertyId })
    const [item] = await presentList(req, [task])
    res.status(201).json({ task: item, mail })
  }),
)

async function removeTask(task) {
  const comments = await TaskComment.find({ taskId: task._id }).select("attachments")
  const fileIds = comments.flatMap((comment) => comment.attachments.map((item) => item.fileId)).filter(Boolean)
  const files = fileIds.length ? await DocumentFile.find({ _id: { $in: fileIds }, kind: "task" }) : []
  for (const file of files) await deleteStoredFile(file).catch(() => {})
  if (files.length) await DocumentFile.deleteMany({ _id: { $in: files.map((file) => file._id) } })
  await TaskComment.deleteMany({ taskId: task._id })
  await task.deleteOne()
}

tasksRouter.delete(
  "/:id",
  requirePermission(PERMISSIONS.tasksManage),
  asyncHandler(async (req, res) => {
    const task = await visibleTask(req, req.params.id)
    if (!task) return sendError(res, 404, "That task was not found.")
    await removeTask(task)
    await recordActivity({ user: req.user, title: "Task deleted", detail: task.title, propertyId: task.propertyId })
    res.json({ ok: true })
  }),
)

/* ---------- comments ---------- */

// Who can be @mentioned on a task: the team (not contractors or the AI teammate), and the task's assignee.
async function mentionable(task) {
  const people = await User.find({ bot: { $ne: true }, $or: [{ role: { $ne: "contractor" } }, ...(task.assigneeId ? [{ _id: task.assigneeId }] : [])] }).select("name").sort({ name: 1 })
  return people.map((person) => ({ id: String(person._id), name: person.name }))
}

function presentComment(comment) {
  return {
    id: String(comment._id),
    parentId: comment.parentId ? String(comment.parentId) : "",
    userId: String(comment.userId),
    userName: comment.userName || "",
    text: comment.text || "",
    mentionIds: (comment.mentionIds || []).map(String),
    attachments: (comment.attachments || []).map((item) => ({ id: String(item.fileId), name: item.name || "File", mime: item.mime || "", size: item.size || 0 })),
    createdAt: comment.createdAt,
  }
}

tasksRouter.get(
  "/:id/comments",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const task = await visibleTask(req, req.params.id)
    if (!task) return sendError(res, 404, "That task was not found.")
    const comments = await TaskComment.find({ taskId: task._id }).sort({ createdAt: 1 })
    res.json({ comments: comments.map(presentComment), people: await mentionable(task) })
  }),
)

function receiveFiles(req, res, next) {
  if (!req.is("multipart/form-data")) return next()
  upload.array("files", MAX_COMMENT_FILES)(req, res, (error) => {
    if (!error) return next()
    const message = error.code === "LIMIT_FILE_SIZE" ? "Each file can be up to 20 MB." : error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "LIMIT_FILE_COUNT" ? `Attach up to ${MAX_COMMENT_FILES} files to a comment.` : "The files could not be read."
    sendError(res, 400, message)
  })
}

tasksRouter.post(
  "/:id/comments",
  requirePermission("properties.read"),
  receiveFiles,
  asyncHandler(async (req, res) => {
    const task = await visibleTask(req, req.params.id)
    if (!task) return sendError(res, 404, "That task was not found.")
    const text = String(req.body.text || "").replace(/\r\n/g, "\n").trim()
    const files = req.files || []
    if (!text && !files.length) return sendError(res, 400, "Write a comment or attach a file.")
    if (text.length > MAX_COMMENT) return sendError(res, 400, "Keep a comment under 5,000 characters.")
    const odd = files.find((file) => !COMMENT_FILES.test(file.originalname || ""))
    if (odd) return sendError(res, 400, `${odd.originalname} can't be attached. Attach photos, PDFs, Word, Excel, CSV, text or video files.`)
    let parent = null
    if (req.body.parentId) {
      parent = mongoose.isValidObjectId(req.body.parentId) ? await TaskComment.findOne({ _id: req.body.parentId, taskId: task._id }) : null
      if (!parent) return sendError(res, 404, "That comment was not found.")
      // Replies hang off the first comment of a thread.
      if (parent.parentId) parent = await TaskComment.findById(parent.parentId)
    }
    const people = await mentionable(task)
    let mentions = req.body.mentionIds
    if (typeof mentions === "string") {
      try {
        mentions = JSON.parse(mentions)
      } catch {
        mentions = mentions.split(",")
      }
    }
    const mentionIds = [...new Set((Array.isArray(mentions) ? mentions : []).map(String))].filter((id) => people.some((person) => person.id === id))
    const saved = []
    try {
      for (const file of files) saved.push(await saveUploadedFile(file, req.user, { kind: "task" }))
    } catch (error) {
      for (const file of saved) await deleteStoredFile(file).catch(() => {})
      if (saved.length) await DocumentFile.deleteMany({ _id: { $in: saved.map((file) => file._id) } })
      throw error
    }
    const comment = await TaskComment.create({
      taskId: task._id,
      parentId: parent?._id,
      userId: req.user._id,
      userName: req.user.name,
      text,
      mentionIds,
      attachments: saved.map((file) => ({ fileId: file._id, name: file.name, mime: file.mime, size: file.size })),
    })
    // The assignee and whoever added the task hear of every comment; someone @mentioned hears they were.
    const href = `/tasks?task=${task._id}&comments=1`
    const preview = text ? (text.length > 140 ? `${text.slice(0, 140)}…` : text) : `${saved.length} ${saved.length === 1 ? "file" : "files"}`
    const mentioned = mentionIds.filter((id) => id !== String(req.user._id))
    if (mentioned.length) await notify({ userIds: mentioned, title: `${req.user.name} mentioned you on “${task.title}”`, body: preview, href, event: "task.mention", email: false })
    const watchers = [task.assigneeId, task.createdBy].filter(Boolean).map(String).filter((id) => id !== String(req.user._id) && !mentioned.includes(id))
    if (watchers.length) await notify({ userIds: watchers, title: `${req.user.name} commented on “${task.title}”`, body: preview, href, event: "task.comment", email: false })
    await recordActivity({ user: req.user, title: "Task comment", detail: `${task.title} · ${preview}`, propertyId: task.propertyId })
    res.status(201).json({ comment: presentComment(comment) })
  }),
)

tasksRouter.delete(
  "/:id/comments/:commentId",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const task = await visibleTask(req, req.params.id)
    const comment = task && mongoose.isValidObjectId(req.params.commentId) ? await TaskComment.findOne({ _id: req.params.commentId, taskId: task._id }) : null
    if (!comment) return sendError(res, 404, "That comment was not found.")
    if (String(comment.userId) !== String(req.user._id) && req.user.role !== "admin") return sendError(res, 403, "You can delete your own comments.")
    const thread = [comment, ...(comment.parentId ? [] : await TaskComment.find({ parentId: comment._id }))]
    const fileIds = thread.flatMap((item) => item.attachments.map((file) => file.fileId)).filter(Boolean)
    const files = fileIds.length ? await DocumentFile.find({ _id: { $in: fileIds }, kind: "task" }) : []
    for (const file of files) await deleteStoredFile(file).catch(() => {})
    if (files.length) await DocumentFile.deleteMany({ _id: { $in: files.map((file) => file._id) } })
    await TaskComment.deleteMany({ _id: { $in: thread.map((item) => item._id) } })
    res.json({ deleted: thread.map((item) => String(item._id)) })
  }),
)

// A file on a task comment, for the people who can see the task.
tasksRouter.get(
  "/:id/files/:fileId",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const task = await visibleTask(req, req.params.id)
    if (!task || !mongoose.isValidObjectId(req.params.fileId)) return sendError(res, 404, "That file was not found.")
    const held = await TaskComment.exists({ taskId: task._id, "attachments.fileId": req.params.fileId })
    const file = held ? await DocumentFile.findOne({ _id: req.params.fileId, kind: "task" }) : null
    if (!file) return sendError(res, 404, "That file was not found.")
    await sendStoredFile(res, file, { download: req.query.download === "1", range: req.headers.range })
  }),
)
