import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { AGENT_DEFAULTS, LINE_STATUSES, TEAMMATE_DEFAULTS, isPendingDraw } from "@synergifund/shared"
import { AgentSetting, ChatChannel, ChatMessage, DocumentFile, Draw, ExpenseRequest, PhotoSet, Property, SiteWatch, Task, User } from "../models/index.js"
import { postChatMessage } from "../routes/chat.js"
import { chat, modelKey } from "./agent/llm.js"
import { setAlwaysOnline } from "./chatHub.js"
import { bus } from "./events.js"
import { readStoredFile } from "./files.js"
import { notify, recordActivity, sendMail } from "./notify.js"

// The AI teammate in property chats. It reads what the team and contractors say and the photos they post, keeps
// each line item's status (Not started → In progress → Complete) and expected finish date up to date, raises a
// draw when enough work is done (an email to the draws inbox and a high-priority task), answers when someone talks
// to it, and checks in with contractors when a house has gone quiet. It never claims to be a person.

const TIMEZONE = process.env.TEAM_TIMEZONE || "America/New_York"
// A review runs once the chat has been quiet for a moment, so a burst of messages is read together.
const REVIEW_QUIET_MS = Number(process.env.TEAMMATE_REVIEW_MS) || 90000
const REPLY_QUIET_MS = Number(process.env.TEAMMATE_REPLY_MS) || 25000
const REVIEW_MAX_WAIT_MS = 8 * 60 * 1000
const SWEEP_MS = Number(process.env.TEAMMATE_SWEEP_MS) || 20 * 60 * 1000
const MAX_REVIEWS_PER_DAY = 40
const MAX_IMAGES = 4
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
// A person's own status change is not overruled by the AI for this long.
const HUMAN_HOLD_MS = 7 * 24 * 3600 * 1000
const DRAW_ALERT_GAP_MS = 5 * 24 * 3600 * 1000
const DAY_MS = 24 * 3600 * 1000

let cached = { at: 0, settings: null }
const timers = new Map()
const running = new Set()
const reviewsToday = new Map()
let sweepTimer = null
let started = false

function clamp(value, low, high, fallback) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback
}

export async function teammateSettings({ fresh = false } = {}) {
  if (!fresh && cached.settings && Date.now() - cached.at < 30000) return cached.settings
  const stored = await AgentSetting.findOne({ key: "org" })
  const settings = {
    on: Boolean(stored?.teammateOn),
    name: String(stored?.teammateName || TEAMMATE_DEFAULTS.name).trim().slice(0, 60) || TEAMMATE_DEFAULTS.name,
    userId: stored?.teammateUserId ? String(stored.teammateUserId) : "",
    followUpDays: clamp(stored?.followUpDays, 1, 30, TEAMMATE_DEFAULTS.followUpDays),
    drawEmail: String(stored?.drawEmail || TEAMMATE_DEFAULTS.drawEmail).trim().toLowerCase(),
    decisionModel: stored?.decisionModel || AGENT_DEFAULTS.decisionModel,
    onAt: stored?.teammateOnAt || null,
  }
  cached = { at: Date.now(), settings }
  return settings
}

export function forgetTeammateSettings() {
  cached = { at: 0, settings: null }
}

// The teammate's account: a team member who works in every property chat but cannot sign in.
export async function ensureTeammate(settings) {
  let user = settings.userId ? await User.findById(settings.userId) : null
  if (!user) user = await User.findOne({ bot: true })
  if (!user) {
    user = await User.create({
      name: settings.name,
      email: `ai-teammate-${randomBytes(4).toString("hex")}@synergifund.invalid`,
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
      role: "member",
      title: "Project coordinator",
      bot: true,
    })
  } else if (user.name !== settings.name || !user.bot) {
    user.name = settings.name
    user.bot = true
    await user.save()
  }
  if (settings.userId !== String(user._id)) {
    await AgentSetting.updateOne({ key: "org" }, { $set: { teammateUserId: user._id } }, { upsert: true })
    forgetTeammateSettings()
  }
  if (settings.on) setAlwaysOnline([user._id])
  return user
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "there"
}

function localParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value]))
  return { weekday: parts.weekday, hour: Number(parts.hour) % 24, today: `${parts.year}-${parts.month}-${parts.day}` }
}

// Check-ins go out on weekdays, 9 am to 5 pm in the team's time zone, like a person would send them.
export function workingHours(date = new Date()) {
  const { weekday, hour } = localParts(date)
  return !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 17
}

function readJson(content) {
  const text = String(content || "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function money(value) {
  return value == null ? "" : `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/* ---------- reacting to chat ---------- */

async function onMessage({ channel, property, message, author }) {
  if (channel?.kind !== "property" || !property || author?.bot) return
  const settings = await teammateSettings()
  if (!settings.on || !modelKey() || !settings.userId) return
  // A contractor said something: they are not waiting on a check-in any more.
  if (author.role === "contractor") await SiteWatch.updateOne({ propertyId: property._id }, { $set: { followUpsUnanswered: 0 } }, { upsert: true }).catch(() => {})
  const mentioned = (message.mentionIds || []).some((id) => String(id) === settings.userId)
  const named = new RegExp(`\\b${firstName(settings.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(message.text || "")
  const previous = await ChatMessage.findOne({ channelId: channel._id, _id: { $ne: message._id }, deletedAt: null, parentId: null }).sort({ createdAt: -1 }).select("userId createdAt mentionIds")
  const answering = previous && String(previous.userId) === settings.userId && Date.now() - previous.createdAt.getTime() < 2 * DAY_MS && (previous.mentionIds || []).some((id) => String(id) === String(author._id))
  schedule(String(property._id), { reply: mentioned || named || answering })
}

function schedule(propertyId, { reply = false } = {}) {
  const now = Date.now()
  const waiting = timers.get(propertyId)
  if (waiting) clearTimeout(waiting.timer)
  const entry = { firstAt: waiting?.firstAt || now, reply: Boolean(waiting?.reply || reply), timer: null }
  const wait = Math.max(0, Math.min(entry.reply ? REPLY_QUIET_MS : REVIEW_QUIET_MS, entry.firstAt + REVIEW_MAX_WAIT_MS - now))
  entry.timer = setTimeout(() => {
    timers.delete(propertyId)
    reviewProperty(propertyId, { reply: entry.reply }).catch((error) => console.error("AI teammate: review failed", error))
  }, wait)
  timers.set(propertyId, entry)
}

function underDailyLimit(propertyId) {
  const { today } = localParts()
  const entry = reviewsToday.get(propertyId)
  if (!entry || entry.day !== today) {
    reviewsToday.set(propertyId, { day: today, count: 1 })
    return true
  }
  entry.count += 1
  return entry.count <= MAX_REVIEWS_PER_DAY
}

async function propertyChannel(propertyId) {
  return ChatChannel.findOne({ kind: "property", propertyId, archivedAt: null })
}

async function imagesFrom(fileIds) {
  if (!fileIds.length) return []
  const files = await DocumentFile.find({ _id: { $in: fileIds } }).select("name mime size storage storagePath createdAt")
  const usable = files.filter((file) => IMAGE_TYPES.has(String(file.mime || "").toLowerCase()) && (file.size || 0) <= MAX_IMAGE_BYTES).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_IMAGES)
  const images = []
  for (const file of usable) {
    try {
      const data = await readStoredFile(file)
      images.push({ name: file.name, url: `data:${file.mime};base64,${Buffer.from(data).toString("base64")}` })
    } catch (error) {
      console.error("AI teammate: a photo could not be read", error.message)
    }
  }
  return images
}

function lineView(line) {
  return {
    id: String(line._id),
    title: line.title,
    status: LINE_STATUSES.includes(line.status) ? line.status : "Not started",
    expected: line.forecastDate || "",
    budget: line.budget ?? null,
    lastChange: line.statusBy ? `${line.status} by ${line.statusBy}${line.statusNote ? ` (${line.statusNote})` : ""}` : "",
  }
}

function reviewPrompt(settings, { reply }) {
  return `You are ${settings.name}, project coordinator on the SynergiFund team. SynergiFund buys, renovates and rents houses. You work in each house's chat with the team and the contractors. You are an AI assistant and you never pretend to be a person: if anyone asks whether you are a bot, an AI or a real person, say plainly that you are SynergiFund's AI assistant on the team.

From the chat and the photos, keep the renovation's line items up to date and decide whether a draw should be requested. Return JSON only, no other text:
{"lineItems": [{"id": "the line item id", "status": "Not started" | "In progress" | "Complete", "expected": "YYYY-MM-DD or empty", "reason": "short evidence, e.g. Roman said drywall started Monday; photos show hung sheets"}],
 "draw": {"needed": true | false, "reason": "...", "items": ["line item titles finished since the last draw"]},
 "memory": "your running notes on this house: what is done, in progress, waiting, promised dates, who said what (at most 1200 characters)",
 "message": "what you post in the chat now, or empty"}

Line items:
- List only line items whose status or expected date should change. Use the line item ids given.
- "In progress" when work has clearly started (someone says so, or photos show it underway). "Complete" only when someone says it is done or photos clearly show it finished. Never guess from vague talk.
- "expected": the date it should be finished, from what was said ("done by Friday"), the pace so far and normal durations for that kind of work. Today or later. Leave it empty when there is no reasonable basis.

Draws (asking the lender to release money for finished work):
- needed is true when enough work has been finished since the last draw to ask for the next one, or someone in the chat says a draw should be requested or the contractor asks to be paid for finished work.
- needed is false when a draw is already requested and waiting, a draw request task is already open, or not enough is done.

The message:
- ${reply ? "Someone is talking to you or answering you: reply." : "Nobody asked you anything. Post a message only if you changed a line item, as a short acknowledgement; otherwise leave it empty."}
- Write like a friendly, capable coordinator texting the crew: short (one to three sentences), warm, natural, first names, no corporate language, no bullet lists, no emoji overload.
- Ask for a few photos when they would show progress.
- Never mention budgets, costs, draw amounts, loans or lenders in the chat: contractors read it. Never promise payments, approvals or dates on the company's behalf.
- Only state facts from the chat, the photos or the records below. If you do not know, say you will check with the team.`
}

// Reads the latest chat and photos for one house and updates its line items, raises a draw, and replies.
export async function reviewProperty(propertyId, { reply = false, force = false } = {}) {
  if (running.has(propertyId)) {
    schedule(propertyId, { reply })
    return { skipped: "busy" }
  }
  running.add(propertyId)
  try {
    const settings = await teammateSettings()
    if ((!settings.on && !force) || !modelKey()) return { skipped: "off" }
    if (!force && !underDailyLimit(propertyId)) return { skipped: "limit" }
    const bot = await ensureTeammate(settings)
    const property = await Property.findById(propertyId)
    if (!property) return { skipped: "missing" }
    const channel = await propertyChannel(property._id)
    const watch = (await SiteWatch.findOne({ propertyId: property._id })) || new SiteWatch({ propertyId: property._id })
    const since = watch.lastReviewedAt || new Date(0)
    const recent = (await ChatMessage.find({ channelId: channel?._id, deletedAt: null }).sort({ createdAt: -1 }).limit(40)).reverse()
    const fresh = recent.filter((message) => message.createdAt > since && String(message.userId) !== String(bot._id))
    const photoSets = await PhotoSet.find({ propertyId: property._id, createdAt: { $gt: since } }).sort({ createdAt: -1 }).limit(3)
    if (!fresh.length && !photoSets.length && !reply && !force) return { skipped: "nothing new" }

    const authorIds = [...new Set(recent.map((message) => String(message.userId)).filter(Boolean))]
    const authors = new Map((await User.find({ _id: { $in: authorIds } }).select("name role bot")).map((user) => [String(user._id), user]))
    const who = (id, fallback) => {
      const person = authors.get(String(id))
      if (!person) return fallback || "Someone"
      return `${person.name} (${person.bot ? "you" : person.role === "contractor" ? "contractor" : "team"})`
    }
    const transcript = recent.map((message) => {
      const when = message.createdAt.toLocaleString("en-US", { timeZone: TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      const files = (message.attachments || []).length ? ` [shared ${message.attachments.map((file) => file.name).join(", ")}]` : ""
      const mark = message.createdAt > since ? " (new)" : ""
      return `[${when}]${mark} ${who(message.userId, message.userName)}: ${String(message.text || "").replace(/<@([a-f0-9]{24})>/g, (_, id) => `@${authors.get(id)?.name || "someone"}`)}${files}`
    }).join("\n")
    const images = await imagesFrom([
      ...fresh.flatMap((message) => (message.attachments || []).map((file) => file.fileId)),
      ...photoSets.flatMap((set) => set.fileIds || []),
    ])
    const draws = await Draw.find({ propertyId: property._id }).sort({ createdAt: 1 }).select("title status requestedDate fundedDate fundedAmount lines")
    const openDrawTasks = await Task.find({ propertyId: property._id, done: false, labels: "Draw" }).select("title createdAt")
    const { today } = localParts()
    const facts = {
      today,
      house: { address: property.address, city: property.city || "", stage: property.stage, goal: property.strategy || "" },
      lineItems: (property.scopeLines || []).map(lineView),
      draws: draws.map((draw) => ({ title: draw.title, status: draw.status, requested: draw.requestedDate || "", funded: draw.fundedDate || "", lineItems: (draw.lines || []).map((line) => line.title).filter(Boolean) })),
      openDrawRequestTasks: openDrawTasks.map((task) => task.title),
      weeklyPhotoSets: photoSets.map((set) => ({ weekOf: set.weekOf, photos: (set.fileIds || []).length, note: set.note || "" })),
      yourNotes: watch.memory || "",
    }
    const content = [{ type: "text", text: `Records for this house:\n${JSON.stringify(facts, null, 1)}\n\nChat (oldest first; "(new)" marks what you have not read yet):\n${transcript || "(no messages yet)"}${images.length ? `\n\nThe ${images.length} newest photos follow.` : ""}` }]
    for (const image of images) content.push({ type: "image_url", image_url: { url: image.url } })
    const answer = await chat({ model: settings.decisionModel, temperature: 0.3, maxTokens: 2500, timeoutMs: 120000, messages: [{ role: "system", content: reviewPrompt(settings, { reply }) }, { role: "user", content }] })
    const result = readJson(answer.content)
    if (!result) throw new Error("The AI model's answer could not be read.")

    const current = (await Property.findById(property._id)) || property
    const changes = applyLineItems(current, result.lineItems, settings, today)
    if (changes.length) {
      await current.save()
      await recordActivity({ user: bot, title: "Line item progress", detail: `${current.address}: ${changes.join(" · ")}`, propertyId: current._id })
    }
    let raised = null
    if (result.draw?.needed) raised = await raiseDraw({ property: current, watch, settings, bot, reason: String(result.draw.reason || "").slice(0, 600), items: Array.isArray(result.draw.items) ? result.draw.items.map(String).slice(0, 20) : [], draws, openDrawTasks })
    const text = String(result.message || "").trim()
    let posted = null
    if (channel && text && (reply || changes.length)) posted = await postChatMessage({ channel, property, author: bot, text: text.slice(0, 1200) })
    let lastReviewedAt = recent.length ? recent[recent.length - 1].createdAt : new Date()
    if (photoSets[0] && photoSets[0].createdAt > lastReviewedAt) lastReviewedAt = photoSets[0].createdAt
    await SiteWatch.updateOne({ propertyId: property._id }, {
      $set: {
        memory: String(result.memory || watch.memory || "").slice(0, 1500),
        lastReviewedAt,
        ...(posted ? { lastReplyAt: new Date() } : {}),
        ...(raised ? { lastDrawAlertAt: watch.lastDrawAlertAt, drawTaskId: watch.drawTaskId } : {}),
      },
    }, { upsert: true })
    return { changes, draw: Boolean(raised), message: posted ? posted.text : "" }
  } finally {
    running.delete(propertyId)
  }
}

function applyLineItems(property, items, settings, today) {
  const changes = []
  const lines = new Map((property.scopeLines || []).map((line) => [String(line._id), line]))
  const by = `${settings.name} (AI)`
  const latest = new Date(Date.now() + 365 * DAY_MS).toISOString().slice(0, 10)
  for (const item of Array.isArray(items) ? items : []) {
    const line = lines.get(String(item?.id || ""))
    if (!line) continue
    const reason = String(item.reason || "").trim().slice(0, 300)
    const status = LINE_STATUSES.includes(item.status) ? item.status : ""
    // A person's own recent change stands.
    const heldByPerson = line.statusBy && !line.statusBy.endsWith("(AI)") && line.statusAt && Date.now() - line.statusAt.getTime() < HUMAN_HOLD_MS
    const notes = []
    if (status && status !== (line.status || "Not started") && !heldByPerson) {
      line.status = status
      line.statusBy = by
      line.statusAt = new Date()
      line.statusNote = reason
      notes.push(status)
    }
    const expected = /^\d{4}-\d{2}-\d{2}$/.test(String(item.expected || "")) ? item.expected : ""
    const forecastSetAt = line.forecastAt || line.statusAt
    const forecastHeld = line.forecastBy && !line.forecastBy.endsWith("(AI)") && (!forecastSetAt || Date.now() - forecastSetAt.getTime() < HUMAN_HOLD_MS)
    if (line.status === "Complete") {
      if (line.forecastDate) {
        line.forecastDate = ""
        line.forecastNote = ""
      }
    } else if (expected && expected >= today && expected <= latest && expected !== line.forecastDate && !forecastHeld) {
      line.forecastDate = expected
      line.forecastNote = reason
      line.forecastBy = by
      line.forecastAt = new Date()
      notes.push(`expected ${expected}`)
    }
    if (notes.length) changes.push(`${line.title} → ${notes.join(", ")}`)
  }
  return changes
}

// Enough work is done for the next draw: email the draws inbox and add a high-priority task, once.
async function raiseDraw({ property, watch, settings, bot, reason, items, draws, openDrawTasks }) {
  const waiting = draws.some(isPendingDraw)
  const recent = watch.lastDrawAlertAt && Date.now() - watch.lastDrawAlertAt.getTime() < DRAW_ALERT_GAP_MS
  if (waiting || recent || openDrawTasks.length) return null
  const { today } = localParts()
  const done = items.length ? items.join(", ") : "See the property chat"
  const task = await Task.create({
    propertyId: property._id,
    title: `Request draw · ${property.address}`,
    priority: "High",
    labels: ["Draw"],
    due: today,
    notes: [`Work finished: ${done}`, reason && `Why: ${reason}`, `Raised by ${settings.name} (AI teammate) from the property chat.`].filter(Boolean).join("\n"),
  })
  await recordActivity({ user: bot, title: "Draw request raised", detail: `${property.address} · ${done}`, propertyId: property._id })
  const lines = (property.scopeLines || []).map((line) => `${line.title}: ${line.status || "Not started"}${line.forecastDate ? ` (expected ${line.forecastDate})` : ""}${line.budget != null ? ` · budget ${money(line.budget)}` : ""}`)
  const mail = await sendMail({
    people: [{ email: settings.drawEmail, name: "" }],
    title: `Draw needed: ${property.address}`,
    body: `${settings.name}, the AI teammate, thinks it is time to request the next draw for ${property.address}.\n\n${reason || "Enough work has been finished since the last draw."}`,
    details: [["Property", [property.address, property.city].filter(Boolean).join(", ")], ["Work finished", done], ["Line items", lines.join("\n")], ["Draws so far", draws.map((draw) => `${draw.title}: ${draw.status}`).join(", ") || "None"], ["Task", "A high-priority task was added to Tasks."]],
    href: `/properties/${property._id}?tab=draws`,
    event: "draw.needed",
  }).catch((error) => ({ status: "Failed", error: error.message }))
  await notify({ roles: ["admin"], title: `Draw needed: ${property.address}`, body: `${done}. ${reason}`.slice(0, 280), href: `/tasks?task=${task._id}`, event: "draw.needed", email: false })
  watch.lastDrawAlertAt = new Date()
  watch.drawTaskId = task._id
  return { task, mail }
}

/* ---------- checking in with contractors ---------- */

async function lastContractorUpdate(property, contractors, channel) {
  const ids = contractors.map((person) => person._id)
  const [message, photos, expense] = await Promise.all([
    channel ? ChatMessage.findOne({ channelId: channel._id, userId: { $in: ids }, deletedAt: null }).sort({ createdAt: -1 }).select("createdAt") : null,
    PhotoSet.findOne({ propertyId: property._id, uploadedBy: { $in: ids } }).sort({ createdAt: -1 }).select("createdAt"),
    ExpenseRequest.findOne({ propertyId: property._id, requestedBy: { $in: ids } }).sort({ createdAt: -1 }).select("createdAt"),
  ])
  return [message, photos, expense].map((item) => item?.createdAt?.getTime() || 0).reduce((a, b) => Math.max(a, b), 0)
}

// Houses under renovation whose contractors have not posted, filed photos or sent an expense for a while get a
// friendly check-in. After two unanswered check-ins the team gets a task to call them.
export async function followUpSweep({ force = false, propertyId = "" } = {}) {
  const settings = await teammateSettings()
  if ((!settings.on && !force) || !modelKey()) return []
  if (!force && !workingHours()) return []
  const bot = await ensureTeammate(settings)
  const filter = propertyId ? { _id: propertyId } : { stage: "Renovation" }
  const properties = await Property.find(filter).select("address city stage scopeLines assignedUserIds")
  const sent = []
  for (const property of properties) {
    if (sent.length >= 10) break
    const contractors = await User.find({ _id: { $in: property.assignedUserIds || [] }, role: "contractor", bot: { $ne: true } }).select("name")
    if (!contractors.length) continue
    const channel = await propertyChannel(property._id)
    if (!channel) continue
    // The clock starts when the teammate began following this house, so turning it on never sends a burst of
    // check-ins: contractors get the full quiet period first. (An upsert, as a review may be creating it too.)
    const watch = await SiteWatch.findOneAndUpdate({ propertyId: property._id }, { $setOnInsert: { propertyId: property._id } }, { upsert: true, new: true })
    const gap = settings.followUpDays * DAY_MS
    const contractorLast = await lastContractorUpdate(property, contractors, channel)
    const quietFor = Date.now() - Math.max(contractorLast, watch.createdAt?.getTime?.() || Date.now(), settings.onAt ? new Date(settings.onAt).getTime() : 0)
    const nudgedRecently = watch.lastFollowUpAt && Date.now() - watch.lastFollowUpAt.getTime() < gap
    if (!force && (quietFor < gap || nudgedRecently)) continue
    const text = await checkInText({ settings, property, contractors, watch, days: Math.max(1, Math.floor(quietFor / DAY_MS)) })
    if (!text) continue
    const mentions = contractors.map((person) => `<@${person._id}>`).join(" ")
    await postChatMessage({ channel, property, author: bot, text: `${mentions} ${text}` })
    const answered = Boolean(watch.lastFollowUpAt && contractorLast > watch.lastFollowUpAt.getTime())
    const update = { $set: { lastFollowUpAt: new Date() } }
    if (answered) update.$set.followUpsUnanswered = force ? 0 : 1
    else if (!force) update.$inc = { followUpsUnanswered: 1 }
    const counted = (await SiteWatch.findOneAndUpdate({ _id: watch._id }, update, { new: true })) || watch
    watch.followUpsUnanswered = counted.followUpsUnanswered || 0
    if (!force && watch.followUpsUnanswered >= 3 && (!watch.escalatedAt || watch.escalatedAt < new Date(Date.now() - gap * 2))) {
      const names = contractors.map((person) => person.name).join(", ")
      const lastSeen = contractorLast ? new Date(contractorLast).toLocaleDateString("en-US", { timeZone: TIMEZONE, month: "short", day: "numeric" }) : "none on file"
      const task = await Task.create({ propertyId: property._id, title: `Call ${names} · no update on ${property.address}`, priority: "High", labels: ["Verify"], due: localParts().today, notes: `${settings.name} (AI teammate) checked in ${watch.followUpsUnanswered - 1} times with no reply. Their last update: ${lastSeen}.` })
      await notify({ roles: ["admin"], title: `No update on ${property.address}`, body: `${names} has not answered ${watch.followUpsUnanswered - 1} check-ins.`, href: `/tasks?task=${task._id}`, event: "teammate.escalated", email: false })
      await SiteWatch.updateOne({ _id: watch._id }, { $set: { escalatedAt: new Date() } })
    }
    sent.push({ property: property.address, text })
  }
  return sent
}

async function checkInText({ settings, property, contractors, watch, days }) {
  const active = (property.scopeLines || []).filter((line) => line.status === "In progress").map((line) => `${line.title}${line.forecastDate ? ` (expected ${line.forecastDate})` : ""}`)
  const next = (property.scopeLines || []).filter((line) => (line.status || "Not started") === "Not started").map((line) => line.title).slice(0, 4)
  const answer = await chat({
    model: settings.decisionModel,
    temperature: 0.8,
    maxTokens: 300,
    timeoutMs: 60000,
    messages: [
      { role: "system", content: `You are ${settings.name}, project coordinator on the SynergiFund team, checking in with a contractor in a house's chat. Write one short, friendly, natural message (one or two sentences) like a coordinator texting the crew: ask how it's going and for a few photos. Mention a specific line item when you can. No greeting with their name (it is added for you), no sign-off, no emoji overload, no money. Vary your wording. You are an AI assistant; never claim to be a person. Return only the message.` },
      { role: "user", content: JSON.stringify({ house: property.address, contractors: contractors.map((person) => firstName(person.name)), daysSinceLastUpdate: days, inProgress: active, upNext: next, yourNotes: watch.memory || "", checkInsWithoutReply: watch.followUpsUnanswered || 0 }) },
    ],
  })
  return String(answer.content || "").trim().replace(/^["“]|["”]$/g, "").slice(0, 600)
}

/* ---------- start ---------- */

export async function startTeammate() {
  if (started) return
  started = true
  bus.on("chat:message", (event) => {
    onMessage(event).catch((error) => console.error("AI teammate: reading a message failed", error))
  })
  const settings = await teammateSettings({ fresh: true })
  if (settings.on) await ensureTeammate(settings).catch((error) => console.error("AI teammate: account setup failed", error))
  sweepTimer = setInterval(() => {
    followUpSweep().catch((error) => console.error("AI teammate: check-ins failed", error))
  }, SWEEP_MS)
  sweepTimer.unref?.()
}
