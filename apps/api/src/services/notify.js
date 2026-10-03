import { Resend } from "resend"
import { User, Notification, MailMessage, Activity } from "../models/index.js"

function mailer() {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

function messageHtml({ title, body, href }) {
  const link = href ? `${process.env.WEB_ORIGIN || "http://localhost:3000"}${href}` : ""
  return `<div style="font-family:Inter,Arial,sans-serif;color:#111827;line-height:1.5">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#6b7280">SYNERGIFUND</p>
    <h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
    <p style="margin:0 0 16px">${body}</p>
    ${link ? `<a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:8px;padding:8px 12px">Open in SynergiFund</a>` : ""}
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
  if (!unique.length) return
  await Notification.insertMany(
    unique.map((person) => ({ userId: person._id, title, body, href, event })),
  )
  const resend = mailer()
  const record = await MailMessage.create({
    to: unique.map((person) => person.email),
    subject: title,
    body,
    event,
    status: resend ? "Sending" : "Queued",
  })
  if (!resend) return
  const from = process.env.RESEND_FROM || "SynergiFund <onboarding@resend.dev>"
  const results = await Promise.allSettled(
    unique.map((person) =>
      resend.emails.send({
        from,
        to: person.email,
        subject: title,
        text: body,
        html: messageHtml({ title, body, href }),
      }),
    ),
  )
  record.status = results.every((result) => result.status === "fulfilled" && !result.value?.error) ? "Sent" : "Failed"
  await record.save()
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
