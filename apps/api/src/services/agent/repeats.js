import { PERMISSIONS, chatTitleFromPrompt, permissionsFor } from "@synergifund/shared"
import mongoose from "mongoose"
import { AgentPrompt, AgentThread, User } from "../../models/index.js"
import { teamHour, teamToday } from "../../lib/dates.js"
import { devServer } from "../../lib/runtime.js"
import { publicUser } from "../../lib/serialize.js"
import { notify } from "../notify.js"
import { agentSettings, budgetMessage, budgetState, modelKey } from "./llm.js"
import { runAgent } from "./run.js"
import { silentResponse } from "./stream.js"

// Prompts the Agent asks on its own (Prompts → Repeat on the Agent page), like the weekly brief. When the hour comes on
// the team's clock, the question is asked with the person's own permissions, the answer is saved as a new chat, and
// they get a notification that opens it. Nothing is saved for them: a change the Agent prepares waits for their
// Confirm, as in any chat.

export const REPEAT_EVERY = ["day", "weekday", "week", "month"]
export const MAX_REPEATING = 10
const CHECK_MS = 5 * 60 * 1000
// A claim this old with no answer saved: the server stopped mid-run, so it is asked again.
const STALE_CLAIM_MS = 30 * 60 * 1000

export const BRIEF_TEXT = "My weekly brief. Start with the three things that need my attention most this week. Then, in short sections: money due in the next 14 days (loan payments, bills, insurance and taxes) with dates, amounts and the total; draws requested and not funded yet; loans maturing in the next 90 days; my tasks that are overdue or due this week; and records that look wrong. Leave out a section with nothing in it."
// Mondays at 8 AM.
export const BRIEF_REPEAT = { every: "week", day: 1, hour: 8 }

let timer = null
let checking = false

// The repeat as sent ({ every: "" } for none), or a message when it can't be used.
export function cleanRepeat(value) {
  const every = String(value?.every ?? "")
  if (!every) return { repeat: { every: "" } }
  if (!REPEAT_EVERY.includes(every)) return { error: "Choose how often: every day, weekdays, every week or every month." }
  const hour = Number(value.hour)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { error: "Choose the hour it's asked." }
  const day = Number(value.day)
  if (every === "week" && !(Number.isInteger(day) && day >= 0 && day <= 6)) return { error: "Choose the day of the week." }
  if (every === "month" && !(Number.isInteger(day) && day >= 1 && day <= 28)) return { error: "Choose a date from the 1st to the 28th." }
  return { repeat: every === "week" || every === "month" ? { every, day, hour } : { every, hour } }
}

// Whether a repeat's time has come on this team day (YYYY-MM-DD) by this hour.
export function repeatDue(repeat, day, hour) {
  if (!REPEAT_EVERY.includes(repeat?.every) || hour < repeat.hour) return false
  const date = new Date(`${day}T12:00:00Z`)
  const weekday = date.getUTCDay()
  if (repeat.every === "weekday") return weekday >= 1 && weekday <= 5
  if (repeat.every === "week") return weekday === repeat.day
  if (repeat.every === "month") return date.getUTCDate() === repeat.day
  return true
}

// A prompt that starts repeating (or moves to a new time) after today's time has passed starts next time, not at once.
export function startingDay(repeat, now = new Date()) {
  const today = teamToday(now)
  return repeatDue(repeat, today, teamHour(now)) ? today : ""
}

// "Weekly brief" (or daily, monthly), else the question's start.
export function repeatName(prompt) {
  if (!prompt.brief) return chatTitleFromPrompt(prompt.text)
  const every = prompt.repeat?.every
  return every === "day" || every === "weekday" ? "Daily brief" : every === "month" ? "Monthly brief" : "Weekly brief"
}

function dayLabel(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

async function ask(prompt, day) {
  const user = await User.findById(prompt.userId)
  const permissions = user && !user.bot ? permissionsFor(publicUser(user)) : []
  if (!permissions.includes(PERMISSIONS.agentAsk)) {
    await AgentPrompt.updateOne({ _id: prompt._id }, { $set: { lastRunAt: new Date(), lastError: "Not asked: this account can no longer use the Agent." }, $unset: { runningAt: 1 } }, { timestamps: false })
    return
  }
  const name = repeatName(prompt)
  // This month's AI budget is used up: not asked today, and the person hears why.
  const budget = await budgetState()
  if (budget.reached) {
    await AgentPrompt.updateOne({ _id: prompt._id }, { $set: { lastRunAt: new Date(), lastError: `Not asked: ${budgetMessage(budget)}` }, $unset: { runningAt: 1 } }, { timestamps: false })
    await notify({ userIds: [user._id], title: `${name} was not asked today`, body: budgetMessage(budget), href: "/knowledge", event: "agent.repeat", email: false })
    return
  }
  // Saved with its answer (runAgent saves it), so the chat never shows half asked for someone to post into.
  const thread = new AgentThread({ userId: user._id, title: `${name} · ${dayLabel(day)}`.slice(0, 80), named: true, messages: [{ role: "user", content: prompt.text }] })
  await runAgent({ user, permissions, thread, prompt: prompt.text, res: silentResponse(), settings: await agentSettings(), learn: false })
  const answer = thread.messages[thread.messages.length - 1]
  const failed = answer?.role !== "assistant" || answer.error
  await AgentPrompt.updateOne({ _id: prompt._id }, { $set: { lastRunAt: new Date(), lastThreadId: thread._id, lastError: failed ? "The Agent could not finish the answer. Open the chat and press Retry." : "" }, $unset: { runningAt: 1 } }, { timestamps: false })
  // Only that it's ready: a phone's lock screen shows the notice, so the figures stay in the chat.
  await notify({
    userIds: [user._id],
    title: failed ? `${name} could not be finished` : `${name} is ready`,
    body: failed ? "Open the chat and press Retry." : "Open it in the Agent.",
    href: `/knowledge?chat=${thread._id}`,
    event: "agent.repeat",
    email: false,
  })
}

// Every few minutes: each repeating prompt whose time has come today is claimed (so it runs once, even with more than
// one server) and asked, one at a time. A claim left by a server that stopped mid-run is asked again after a while.
async function check(now = new Date()) {
  if (checking || mongoose.connection.readyState !== 1 || !modelKey()) return
  checking = true
  try {
    const day = teamToday(now)
    const hour = teamHour(now)
    const stale = new Date(now.getTime() - STALE_CLAIM_MS)
    // The time as the asking goes on (one prompt can take minutes): each claim says when it was really made, so a
    // prompt claimed late in a long run never looks cut off to another server while it is still being asked.
    const started = Date.now()
    const clock = () => new Date(now.getTime() + (Date.now() - started))
    const waiting = await AgentPrompt.find({ "repeat.every": { $in: REPEAT_EVERY }, $or: [{ lastRunDay: { $ne: day } }, { lastRunDay: day, runningAt: { $lt: stale } }] }).sort({ "repeat.hour": 1 }).limit(500)
    for (const prompt of waiting) {
      if (!repeatDue(prompt.repeat, day, hour)) continue
      const claimed = await AgentPrompt.findOneAndUpdate({ _id: prompt._id, lastRunDay: prompt.lastRunDay ?? null, runningAt: prompt.runningAt ?? null }, { $set: { lastRunDay: day, runningAt: clock() } }, { new: true, timestamps: false })
      if (!claimed) continue
      try {
        await ask(claimed, day)
      } catch (error) {
        console.error("Repeating prompt failed", error)
        await AgentPrompt.updateOne({ _id: prompt._id }, { $set: { lastRunAt: new Date(), lastError: "The Agent could not ask it this time." }, $unset: { runningAt: 1 } }, { timestamps: false }).catch(() => {})
      }
    }
  } finally {
    checking = false
  }
}

// `npm run dev` (lib/runtime.js) leaves them to the server unless AGENT_REPEATS=on; AGENT_REPEATS=off turns them off
// anywhere.
export function startRepeats({ everyMs = Number(process.env.AGENT_REPEATS_MS) || CHECK_MS } = {}) {
  if (timer || process.env.AGENT_REPEATS === "off" || (devServer() && process.env.AGENT_REPEATS !== "on")) return
  const tick = () => check().catch((error) => console.error("Repeating prompts check failed", error))
  timer = setInterval(tick, everyMs)
  timer.unref?.()
  setTimeout(tick, Math.min(everyMs, 20000)).unref?.()
}

export function stopRepeats() {
  clearInterval(timer)
  timer = null
}

export { check as runRepeatsCheck }
