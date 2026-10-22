import { Resend } from "resend"
import { User, Notification, MailMessage, Activity } from "../models/index.js"
import { pushToUsers } from "./push.js"
import { emitToUsers } from "./chatHub.js"
import { appOrigin } from "./appUrl.js"

const BATCH_SIZE = 100
const MAX_ATTEMPTS = 3
const RETRYABLE = new Set(["rate_limit_exceeded", "internal_server_error", "application_error", "concurrent_idempotent_requests"])

function mailer() {
  const key = String(process.env.RESEND_API_KEY || "").trim()
  if (!key) return null
  return new Resend(key)
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]))
}

function appLink(href) {
  if (!href) return ""
  return `${appOrigin()}${href.startsWith("/") ? href : `/${href}`}`
}

function cleanDetails(details) {
  return (details || []).filter(([label, value]) => label && value != null && String(value).trim() !== "").map(([label, value]) => [String(label), String(value)])
}

function messageText({ name, title, body, details, href }) {
  const link = appLink(href)
  return [
    name ? `Hi ${name},` : "",
    body,
    cleanDetails(details).map(([label, value]) => `${label}: ${value}`).join("\n"),
    link ? `Open in SynergiFund: ${link}` : "",
    "You are receiving this because you are a member of the SynergiFund workspace.",
  ].filter(Boolean).join("\n\n")
}

function messageHtml({ name, title, body, details, href }) {
  const link = appLink(href)
  const rows = cleanDetails(details)
    .map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;font-size:14px;color:#111827">${escapeHtml(value)}</td></tr>`)
    .join("")
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.55">
    <p style="margin:0 0 14px;font-size:12px;letter-spacing:.08em;color:#6b7280;font-weight:600">SYNERGIFUND</p>
    <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3">${escapeHtml(title)}</h1>
    ${name ? `<p style="margin:0 0 10px;font-size:15px">Hi ${escapeHtml(name)},</p>` : ""}
    <p style="margin:0 0 16px;font-size:15px;white-space:pre-line">${escapeHtml(body)}</p>
    ${rows ? `<table role="presentation" style="border-collapse:collapse;margin:0 0 20px">${rows}</table>` : ""}
    ${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600">Open in SynergiFund</a>` : ""}
    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">You are receiving this because you are a member of the SynergiFund workspace.</p>
  </div>
</body></html>`
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sendBatch(resend, emails, idempotencyKey) {
  let last = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await resend.batch.send(emails, { idempotencyKey })
      if (!result.error) return { ids: (result.data?.data || []).map((item) => item.id).filter(Boolean) }
      last = result.error
      const retryable = RETRYABLE.has(result.error.name) || result.error.statusCode === 429 || result.error.statusCode >= 500
      if (!retryable) break
    } catch (error) {
      last = { message: error.message || "The email service did not answer." }
    }
    if (attempt < MAX_ATTEMPTS) await wait(800 * 2 ** (attempt - 1))
  }
  return { error: last?.message || "The email could not be sent." }
}

export async function sendMail({ people, title, body, details, href, event }) {
  const recipients = people.filter((person) => String(person.email || "").includes("@"))
  if (!recipients.length) return { status: "Failed", error: "Nobody on this notification has an email address.", sent: 0 }
  const resend = mailer()
  const record = await MailMessage.create({
    to: recipients.map((person) => person.email),
    subject: title,
    body,
    event,
    status: resend ? "Sending" : "Failed",
    error: resend ? "" : "RESEND_API_KEY is not set.",
  })
  if (!resend) return { status: "Failed", error: record.error, sent: 0 }
  const from = process.env.RESEND_FROM || "SynergiFund <noreply@synergifund.com>"
  const emails = recipients.map((person) => ({
    from,
    to: [person.email],
    subject: title,
    text: messageText({ name: person.name, title, body, details, href }),
    html: messageHtml({ name: person.name, title, body, details, href }),
    tags: [{ name: "event", value: String(event || "notice").replace(/[^a-zA-Z0-9_-]/g, "_") }],
  }))
  const errors = []
  for (let start = 0; start < emails.length; start += BATCH_SIZE) {
    const chunk = emails.slice(start, start + BATCH_SIZE)
    const outcome = await sendBatch(resend, chunk, `${record._id}-${start}`)
    if (outcome.error) errors.push(outcome.error)
    else {
      record.providerIds.push(...outcome.ids)
      record.sentCount += chunk.length
    }
  }
  record.status = !errors.length ? "Sent" : record.sentCount ? "Partly sent" : "Failed"
  record.error = [...new Set(errors)].join(" ")
  await record.save()
  return { status: record.status, error: record.error, sent: record.sentCount }
}

// `exceptUserIds`: people left out, usually whoever made the change. `email: false` sends only the in-app notice and push.
export async function notify({ roles = [], userIds = [], exceptUserIds = [], title, body, details, href, event, push = true, email = true }) {
  try {
    // The AI teammate's account never gets notifications or emails.
    const roleUsers = roles.length ? await User.find({ role: { $in: roles }, bot: { $ne: true } }).select("_id email name") : []
    const direct = userIds.length ? await User.find({ _id: { $in: userIds.filter(Boolean) }, bot: { $ne: true } }).select("_id email name") : []
    const seen = new Set(exceptUserIds.filter(Boolean).map(String))
    const people = [...roleUsers, ...direct].filter((person) => {
      const id = String(person._id)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (!people.length) return { status: "Skipped", error: "Nobody to notify.", sent: 0 }
    await Notification.insertMany(people.map((person) => ({ userId: person._id, title, body, href, event })))
    emitToUsers(people.map((person) => String(person._id)), "notification:new", { title, href })
    const pushed = push ? pushToUsers(people.map((person) => person._id), { title, body, href }).catch((error) => {
      console.error("Push notification failed", error)
      return { sent: 0, failed: 0 }
    }) : Promise.resolve({ sent: 0, failed: 0 })
    if (!email) {
      await pushed
      return { status: "Sent", error: "", sent: people.length }
    }
    const mail = await sendMail({ people, title, body, details, href, event })
    await pushed
    if (mail.status !== "Sent") console.error(`Email for ${event} ${mail.status}: ${mail.error}`)
    return mail
  } catch (error) {
    console.error(`Notification ${event} failed`, error)
    return { status: "Failed", error: error.message || "The notification could not be sent.", sent: 0 }
  }
}

export async function notifyPropertyAccess({ actor, person, properties }) {
  if (!person || !properties.length) return { status: "Skipped", sent: 0 }
  const one = properties.length === 1
  const addresses = properties.map((property) => property.address)
  return notify({
    userIds: [person._id],
    title: one ? `You were added to ${addresses[0]}` : `You were added to ${properties.length} properties`,
    body: `${actor.name} gave you access to ${one ? "this property" : "these properties"} in SynergiFund. You can open ${one ? "it" : "them"}, see the draws and file costs and weekly photos.`,
    details: [[one ? "Property" : "Properties", addresses.join(", ")], ["Added by", actor.name]],
    href: one ? `/properties/${properties[0]._id}` : "/properties",
    event: "property.assigned",
  })
}

// Important changes that every admin hears about, in Notifications and as a push on their phone or computer (no email).
// Keyed by the activity title, with the part of the app the alert opens. Whoever made the change is not told about
// it. Alerts that already have their own notice (Expense submitted, Expense rejected, Draw pulled) are not listed here.
const ADMIN_ALERTS = new Map([
  ["Draw recorded", { event: "draw.created", area: "draws" }],
  ["Draw updated", { event: "draw.updated", area: "draws" }],
  ["Draw removed", { event: "draw.removed", area: "draws" }],
  ["Draw budget set", { event: "draw.budget", area: "draws" }],
  ["Draw budget updated", { event: "draw.budget", area: "draws" }],
  ["Line items updated", { event: "draw.line_items", area: "draws" }],
  ["Draw workbook uploaded", { event: "draw.workbook_uploaded", area: "draws" }],
  ["Draw workbook imported", { event: "draw.workbook_imported", area: "draws" }],
  ["Draw workbook appended", { event: "draw.workbook_imported", area: "draws" }],
  ["Draw data cleared", { event: "draw.cleared", area: "draws" }],
  ["Expense approved", { event: "expense.approved", area: "expenses" }],
  ["Expense request updated", { event: "expense.updated", area: "expenses" }],
  ["Cost added", { event: "expense.cost_added", area: "expenses" }],
  ["Property added", { event: "property.created", area: "property" }],
  ["Property updated", { event: "property.updated", area: "property" }],
  ["Property deleted", { event: "property.deleted", area: "properties" }],
  ["Property workbook uploaded", { event: "property.workbook_uploaded", area: "properties" }],
  ["Workbook imported", { event: "property.workbook_imported", area: "properties" }],
  ["Weekly photos filed", { event: "property.photos", area: "property" }],
  ["File removed from the library", { event: "document.removed", area: "documents" }],
  ["Company added", { event: "company.created", area: "companies" }],
  ["Company updated", { event: "company.updated", area: "companies" }],
  ["Company deleted", { event: "company.deleted", area: "companies" }],
  ["Companies imported", { event: "company.imported", area: "companies" }],
  ["Property assigned to a company", { event: "company.property_assigned", area: "companies" }],
  ["Property removed from a company", { event: "company.property_removed", area: "companies" }],
  ["Payment scheduled", { event: "payment.scheduled", area: "payments" }],
  ["Payment updated", { event: "payment.updated", area: "payments" }],
  ["Payment marked paid", { event: "payment.paid", area: "payments" }],
  ["Payment deleted", { event: "payment.deleted", area: "payments" }],
  ["Loan recorded", { event: "loan.created", area: "loans" }],
  ["Loan updated", { event: "loan.updated", area: "loans" }],
  ["Lender saved", { event: "lender.created", area: "loans" }],
  ["Member invited", { event: "member.invited", area: "members" }],
  ["Member access updated", { event: "member.updated", area: "members" }],
  ["Member password set", { event: "member.password", area: "members" }],
  ["Member removed", { event: "member.removed", area: "members" }],
  ["Backup restored", { event: "backup.restored", area: "settings" }],
])
const AREA_PAGES = { draws: "/draws", expenses: "/expenses", property: "/properties", properties: "/properties", documents: "/documents", companies: "/companies", payments: "/payments", loans: "/loans", members: "/members", settings: "/settings?tab=backups" }
// The same kind of change by the same person within this time is one alert ("Draw updated (3)"), so a bulk edit or
// an import does not buzz every admin's phone once per row.
const ALERT_GATHER_MS = 1500
const gathering = new Map()

function alertHref(area, propertyId) {
  if (propertyId && area === "draws") return `/properties/${propertyId}?tab=draws`
  if (propertyId && area === "property") return `/properties/${propertyId}`
  if (propertyId && area === "documents") return `/properties/${propertyId}?tab=documents`
  return AREA_PAGES[area] || "/notifications"
}

function queueAdminAlert({ user, title, detail, propertyId, href, except }) {
  const alert = ADMIN_ALERTS.get(title)
  if (!alert || !user?._id) return
  const key = `${user._id}|${title}`
  let batch = gathering.get(key)
  if (!batch) {
    batch = { user, title, alert, details: [], hrefs: new Set(), except: new Set() }
    gathering.set(key, batch)
    setTimeout(() => sendAdminAlert(key).catch((error) => console.error(`Admin alert for ${title} failed`, error)), ALERT_GATHER_MS)
  }
  batch.details.push(String(detail || "").trim())
  batch.hrefs.add(href || alertHref(alert.area, propertyId))
  for (const id of except || []) if (id) batch.except.add(String(id))
}

async function sendAdminAlert(key) {
  const batch = gathering.get(key)
  gathering.delete(key)
  if (!batch) return
  const count = batch.details.length
  const details = batch.details.filter(Boolean)
  const listed = details.slice(0, 3).join(" | ") + (details.length > 3 ? ` and ${details.length - 3} more` : "")
  const body = `${batch.user.name || "Someone"}${listed ? `: ${listed}` : ""}`
  await notify({
    roles: ["admin"],
    exceptUserIds: [batch.user._id, ...batch.except],
    title: count > 1 ? `${batch.title} (${count})` : batch.title,
    body: body.length > 300 ? `${body.slice(0, 299)}…` : body,
    href: batch.hrefs.size === 1 ? [...batch.hrefs][0] : AREA_PAGES[batch.alert.area],
    event: batch.alert.event,
    email: false,
  })
}

const recorded = new WeakSet()

// Records what happened in the activity log. Important changes also alert every admin (see ADMIN_ALERTS): `href`
// overrides where the alert opens, `alertExcept` leaves out people who already get their own notice about it.
export async function recordActivity({ user, title, detail, propertyId, href = "", alertExcept = [] }) {
  if (user && typeof user === "object") recorded.add(user)
  await Activity.create({
    actorId: user._id,
    actorName: user.name,
    title,
    detail,
    propertyId,
  })
  try {
    queueAdminAlert({ user, title, detail, propertyId, href, except: alertExcept })
  } catch (error) {
    console.error(`Admin alert for ${title} failed`, error)
  }
}

export function activityRecorded(user) {
  return Boolean(user && recorded.has(user))
}

function shown(value, money) {
  if (value == null || value === "") return "blank"
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none"
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "number") return money ? `$${value.toLocaleString("en-US", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : value.toLocaleString("en-US")
  const text = String(value)
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

export function changeSummary(before, after, fields) {
  const changes = []
  for (const [key, label, money] of fields) {
    const left = before?.[key]
    const right = after?.[key]
    if (JSON.stringify(left ?? null) === JSON.stringify(right ?? null)) continue
    if ((left == null || left === "") && (right == null || right === "")) continue
    changes.push(`${label} ${shown(left, money)} → ${shown(right, money)}`)
  }
  return changes.join(" · ")
}
