import { Resend } from "resend"
import { User, Notification, MailMessage, Activity } from "../models/index.js"
import { pushToUsers } from "./push.js"

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
  const origin = String(process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/+$/, "")
  return `${origin}${href.startsWith("/") ? href : `/${href}`}`
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

export async function notify({ roles = [], userIds = [], title, body, details, href, event }) {
  try {
    const roleUsers = roles.length ? await User.find({ role: { $in: roles } }).select("_id email name") : []
    const direct = userIds.length ? await User.find({ _id: { $in: userIds.filter(Boolean) } }).select("_id email name") : []
    const seen = new Set()
    const people = [...roleUsers, ...direct].filter((person) => {
      const id = String(person._id)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (!people.length) return { status: "Skipped", error: "Nobody to notify.", sent: 0 }
    await Notification.insertMany(people.map((person) => ({ userId: person._id, title, body, href, event })))
    const pushed = pushToUsers(people.map((person) => person._id), { title, body, href }).catch((error) => {
      console.error("Push notification failed", error)
      return { sent: 0, failed: 0 }
    })
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

const recorded = new WeakSet()

export async function recordActivity({ user, title, detail, propertyId }) {
  if (user && typeof user === "object") recorded.add(user)
  await Activity.create({
    actorId: user._id,
    actorName: user.name,
    title,
    detail,
    propertyId,
  })
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
