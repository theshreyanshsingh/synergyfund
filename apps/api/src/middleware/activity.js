import { Activity } from "../models/index.js"
import { activityRecorded } from "../services/notify.js"

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const RESOURCES = {
  properties: "Property",
  expenses: "Expense",
  draws: "Draw",
  documents: "Document",
  push: "Notifications",
  tasks: "Task",
  bills: "Bill",
  lenders: "Lender",
  loans: "Loan",
  members: "Member",
  agent: "Agent",
  "photo-sets": "Weekly photos",
  overview: "Overview",
  notifications: "Notifications",
}
const VERBS = { POST: "changed", PUT: "updated", PATCH: "updated", DELETE: "removed" }

function fallbackTitle(req, path) {
  const resource = RESOURCES[path.split("/").filter(Boolean)[0]] || "Record"
  return `${resource} ${VERBS[req.method] || "changed"}`
}

function fallbackDetail(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {}
  const name = [body.title, body.name, body.address].find((value) => typeof value === "string" && value.trim())
  return name ? String(name).trim().slice(0, 120) : ""
}

export function trackActivity(req, res, next) {
  if (!MUTATIONS.has(req.method)) {
    next()
    return
  }
  const path = req.path
  res.on("finish", () => {
    if (res.statusCode >= 400 || !req.user || activityRecorded(req.user)) return
    if (path.startsWith("/chat/")) return
    Activity.create({ actorId: req.user._id, actorName: req.user.name, title: fallbackTitle(req, path), detail: fallbackDetail(req) }).catch((error) => console.error("Activity log failed", error))
  })
  next()
}
