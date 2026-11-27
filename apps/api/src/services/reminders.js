import { permissionsFor } from "@synergifund/shared"
import { Bill, Loan, Property, ScheduledRun, Task, User } from "../models/index.js"
import { attentionItems } from "../routes/workspace.js"
import { publicUser } from "../lib/serialize.js"
import { teamHour, teamToday } from "../lib/dates.js"
import { notify } from "./notify.js"

// The morning reminder: once a day, after REMINDER_HOUR on the team's clock (7 AM unless set), each person gets one
// notification (in the app, on their phone and by email) with what needs them today, and nothing when nothing does:
// - their tasks due today or overdue;
// - for people who handle money (expenses.approve: admins and finance): payments due within 3 days or overdue, loan
//   payments coming up, loans behind or maturing within 14 days, and insurance expiring within 14 days. The same items
//   as Overview's "Needs attention".
// REMINDERS=off turns it off.
export const REMINDER_HOUR = Number.isFinite(Number(process.env.REMINDER_HOUR)) && process.env.REMINDER_HOUR !== "" ? Number(process.env.REMINDER_HOUR) : 7
const RUN_NAME = "daily-reminders"
const MAX_LINES = 8

function shiftDay(key, days) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function shortDay(key) {
  return key ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""
}

function dollars(amount) {
  return amount == null || !Number.isFinite(Number(amount)) ? "" : `$${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// Payments and deadlines for the people who handle money, from the same rules as "Needs attention".
async function moneyItems(today) {
  const properties = await Property.find({})
  const ids = properties.map((property) => property._id)
  const [loans, bills] = await Promise.all([
    Loan.find({ propertyId: { $in: ids } }),
    Bill.find({ $or: [{ propertyId: { $in: ids } }, { propertyId: null }] }),
  ])
  const names = new Map(properties.map((property) => [String(property._id), property.address]))
  const soon = shiftDay(today, 3)
  const fortnight = shiftDay(today, 14)
  return attentionItems({ properties, budgetsByProperty: new Map(), draws: [], drawsByProperty: new Map(), loans, bills, tasks: [], names, days: 14 })
    .filter((item) => ["Mortgage", "Payment", "Insurance", "Loan"].includes(item.kind))
    .filter((item) => item.tone === "bad" || (item.date && item.date <= (item.kind === "Mortgage" || item.kind === "Payment" ? soon : fortnight)))
}

function taskLine(task, today, names) {
  const where = names.get(String(task.propertyId || ""))
  const when = task.due < today ? `overdue since ${shortDay(task.due)}` : "due today"
  return `• ${task.title}${where ? ` · ${where}` : ""} (${when})`
}

function moneyLine(item, today) {
  const when = item.date ? (item.date < today ? `was due ${shortDay(item.date)}` : item.date === today ? "today" : shortDay(item.date)) : ""
  return `• ${item.title}${item.property ? ` · ${item.property}` : ""}${dollars(item.amount) ? ` · ${dollars(item.amount)}` : ""} (${[item.detail, when].filter(Boolean).join(", ")})`
}

// Each person's reminder for `today`: [{ user, title, body, href }], only for people with something due.
export async function buildReminders(today = teamToday()) {
  const people = await User.find({ bot: { $ne: true } })
  const tasks = await Task.find({ done: false, assigneeId: { $ne: null }, due: { $ne: "", $lte: today } }).sort({ due: 1 }).lean()
  const handlesMoney = people.filter((person) => permissionsFor(publicUser(person)).includes("expenses.approve"))
  const money = handlesMoney.length ? await moneyItems(today) : []
  const propertyIds = [...new Set(tasks.map((task) => String(task.propertyId || "")).filter(Boolean))]
  const names = new Map((await Property.find({ _id: { $in: propertyIds } }).select("_id address").lean()).map((property) => [String(property._id), property.address]))
  const moneyPeople = new Set(handlesMoney.map((person) => String(person._id)))
  const reminders = []
  for (const person of people) {
    const mine = tasks.filter((task) => String(task.assigneeId) === String(person._id))
    const theirMoney = moneyPeople.has(String(person._id)) ? money : []
    if (!mine.length && !theirMoney.length) continue
    const overdue = mine.filter((task) => task.due < today).length
    const parts = []
    if (mine.length) parts.push(`${plural(mine.length, "task", "tasks")} ${overdue === mine.length ? "overdue" : overdue ? `due (${overdue} overdue)` : "due"}`)
    if (theirMoney.length) parts.push(plural(theirMoney.length, "payment or deadline", "payments and deadlines"))
    const sections = []
    if (mine.length) {
      sections.push([`Your tasks:`, ...mine.slice(0, MAX_LINES).map((task) => taskLine(task, today, names)), mine.length > MAX_LINES ? `…and ${mine.length - MAX_LINES} more in Tasks.` : ""].filter(Boolean).join("\n"))
    }
    if (theirMoney.length) {
      sections.push(["Payments and deadlines:", ...theirMoney.slice(0, MAX_LINES).map((item) => moneyLine(item, today)), theirMoney.length > MAX_LINES ? `…and ${theirMoney.length - MAX_LINES} more on Overview.` : ""].filter(Boolean).join("\n"))
    }
    reminders.push({
      user: person,
      title: `Today: ${parts.join(" · ")}`,
      body: sections.join("\n\n"),
      href: theirMoney.length ? "/overview" : "/tasks",
    })
  }
  return reminders
}

// Sends this morning's reminders once: the first run after REMINDER_HOUR claims the day (ScheduledRun), so a restart
// or a second call sends nothing more. `force` skips the hour (for tests).
let sending = false

export async function sendDailyReminders({ now = new Date(), force = false } = {}) {
  const today = teamToday(now)
  if (!force && teamHour(now) < REMINDER_HOUR) return { skipped: "too early" }
  // (One at a time in this process, too: a slow run and the next tick never overlap.)
  if (sending) return { skipped: "already sending" }
  sending = true
  try {
    // Claims today: matches only a run from an earlier day; when today's is already there, the insert this tries
    // instead fails on the _id, which the database always keeps unique.
    try {
      await ScheduledRun.findOneAndUpdate({ _id: RUN_NAME, day: { $ne: today } }, { $set: { day: today, at: now } }, { upsert: true, new: true })
    } catch (error) {
      if (error?.code === 11000) return { skipped: "already sent today" }
      throw error
    }
    const reminders = await buildReminders(today)
    for (const reminder of reminders) {
      await notify({ userIds: [reminder.user._id], title: reminder.title, body: reminder.body, href: reminder.href, event: "reminder.daily" })
    }
    return { sent: reminders.length }
  } finally {
    sending = false
  }
}

let timer = null

export function startReminders() {
  if (String(process.env.REMINDERS || "").toLowerCase() === "off" || timer) return
  const tick = () => sendDailyReminders().catch((error) => console.error("Daily reminders failed", error))
  timer = setInterval(tick, 10 * 60 * 1000)
  timer.unref?.()
  setTimeout(tick, 60 * 1000).unref?.()
}
