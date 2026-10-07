import { Resend } from "resend"
import { User, Notification, MailMessage, Activity } from "../models/index.js"

function mailer() {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]))
}

function messageHtml({ title, body, href }) {
  const link = href ? `${process.env.WEB_ORIGIN || "http://localhost:3000"}${href}` : ""
  return `<div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#6b7280">SYNERGIFUND</p>
    <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>
    <p style="margin:0 0 16px">${escapeHtml(body)}</p>
    ${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:8px;padding:8px 12px">Open in SynergiFund</a>` : ""}
  </div>`
}

export async function notify({ roles = [], userIds = [], title, body, href, event }) {
  const roleUsers = roles.length ? await User.find({ role: { $in: roles } }).select("_id email name") : []
  const direct = userIds.length ? await User.find({ _id: { $in: userIds } }).select("_id email name") : []
  const people = [...roleUsers, ...direct]
  const seen = new Set()
  const unique = people.filter((person) => {
    const id = String(person._id)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  if (!unique.length) return { status: "Skipped" }
  await Notification.insertMany(
    unique.map((person) => ({ userId: person._id, title, body, href, event })),
  )
  const recipients = unique.map((person) => String(person.email || "").trim()).filter(Boolean)
  if (!recipients.length) return { status: "Failed", error: "The assignee has no email address." }
  const resend = mailer()
  const record = await MailMessage.create({
    to: recipients,
    subject: title,
    body,
    event,
    status: resend ? "Sending" : "Failed",
    error: resend ? "" : "RESEND_API_KEY is not set.",
  })
  if (!resend) return { status: "Failed", error: record.error }
  const from = process.env.RESEND_FROM || "SynergiFund <noreply@superblocks.xyz>"
  const results = await Promise.all(
    recipients.map((email) =>
      resend.emails.send({
        from,
        to: email,
        subject: title,
        text: body,
        html: messageHtml({ title, body, href }),
      }),
    ),
  )
  const errors = results.map((result) => result?.error?.message).filter(Boolean)
  record.status = errors.length ? "Failed" : "Sent"
  record.error = errors.join(" ")
  await record.save()
  return { status: record.status, error: record.error }
}

export async function recordActivity({ user, title, detail, propertyId }) {
  await Activity.create({
    actorId: user._id,
    actorName: user.name,
    title,
    detail,
    propertyId,
  })
}
