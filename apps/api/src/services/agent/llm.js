import { AGENT_DEFAULTS } from "@synergifund/shared"
import { AgentSetting, AiMonth, AiUsage } from "../../models/index.js"
import { teamToday } from "../../lib/dates.js"
import { appOrigin } from "../appUrl.js"
import { listedCost } from "./catalog.js"

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
const MAX_ATTEMPTS = 4
const TIMEOUT_MS = 120000

export function modelKey() {
  return String(process.env.OPENROUTER_API_KEY || process.env.MODEL_API_KEY || "").trim()
}

// The models the team chose in Settings → Agent.
export async function agentSettings() {
  const stored = await AgentSetting.findOne({ key: "org" })
  return {
    taskModel: stored?.taskModel || AGENT_DEFAULTS.taskModel,
    decisionModel: stored?.decisionModel || AGENT_DEFAULTS.decisionModel,
  }
}

export function createUsageTracker() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0, cost: 0 }
}

function trackUsage(tracker, usage, cost) {
  if (!tracker || !usage) return
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
  tracker.promptTokens += prompt
  tracker.completionTokens += completion
  tracker.totalTokens += Number(usage.total_tokens ?? prompt + completion) || 0
  tracker.calls += 1
  tracker.cost = (tracker.cost || 0) + (cost || 0)
}

/* ---------- what the AI costs, and the team's monthly budget ---------- */

// What a job's model calls are for and who they are for: `feature` (agent, voice, memory, receipts, documents, calls,
// teammate) and `userId` (none for background work). One per job: it is checked against the budget at its first call
// only (`cleared` after), so a question already being answered finishes.
export function createMeter(feature, userId = null) {
  return { feature, userId: userId || null, cleared: false }
}

// The team's month on its clock, "2026-11".
export function teamMonth(date = new Date()) {
  return teamToday(date).slice(0, 7)
}

export function budgetLimit(value) {
  const number = value === "" || value == null ? NaN : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

// "$500" or "$312.40".
export function dollars(value) {
  const number = Number(value) || 0
  return `$${number.toLocaleString("en-US", Number.isInteger(number) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// "Dec 1": when the month after `month` starts.
function nextMonthStart(month) {
  const [year, number] = month.split("-").map(Number)
  return new Date(Date.UTC(year, number, 1, 12)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

// This month's spending and the budget: { month, limit (null: none), spent, reached }.
export async function budgetState() {
  const month = teamMonth()
  const [setting, total] = await Promise.all([
    AgentSetting.findOne({ key: "org" }).select("monthlyLimit").lean(),
    AiMonth.findOne({ month }).select("cost").lean(),
  ])
  const limit = budgetLimit(setting?.monthlyLimit)
  const spent = total?.cost || 0
  return { month, limit, spent, reached: limit != null && spent >= limit, resets: nextMonthStart(month) }
}

export function budgetMessage(state) {
  return `This month's AI budget (${dollars(state.limit)}) is used up. An admin can raise it in Settings → Agent; it starts again on ${state.resets}.`
}

export class BudgetReached extends Error {
  constructor(state) {
    super(budgetMessage(state))
    this.budgetReached = true
    this.fatal = true
  }
}

// Throws BudgetReached when this month's budget is used up. Without a meter every call is checked.
export async function checkBudget(meter = null) {
  if (meter?.cleared) return
  const state = await budgetState()
  if (state.reached) throw new BudgetReached(state)
  if (meter) meter.cleared = true
}

// The charge OpenRouter reports (with a bring-your-own-key provider's part), or null when the answer has none.
function chargedCost(usage) {
  const charged = Number(usage?.cost)
  if (usage?.cost == null || !Number.isFinite(charged)) return null
  const upstream = usage.is_byok ? Number(usage.cost_details?.upstream_inference_cost) || 0 : 0
  return charged + upstream
}

// Saves one call and adds it to the month. Returns its cost. A failure to save is logged and never fails the answer.
// (chat() does this for its own calls; the Agent's voice calls it for the speech it streams, see voice.js.)
export async function recordUsage({ meter, model, usage }) {
  const promptTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0
  const completionTokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0
  const cachedTokens = Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0) || 0
  let cost = chargedCost(usage)
  const estimated = cost == null
  try {
    if (estimated) cost = (await listedCost(model, { promptTokens, completionTokens, cachedTokens })) ?? 0
    const at = new Date()
    const day = teamToday(at)
    await AiUsage.create({ at, month: day.slice(0, 7), day, feature: meter?.feature || "other", userId: meter?.userId || null, model, promptTokens, completionTokens, cachedTokens, cost, estimated })
    const total = await AiMonth.findOneAndUpdate({ month: day.slice(0, 7) }, { $inc: { cost, calls: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true })
    await alertAdmins(total)
  } catch (error) {
    console.error("AI usage could not be recorded:", error.message)
  }
  return cost || 0
}

// The admins hear once a month when spending reaches 80% of the budget, and once when it is used up (a jump past both
// sends only the second).
async function alertAdmins(total) {
  const setting = await AgentSetting.findOne({ key: "org" }).select("monthlyLimit").lean()
  const limit = budgetLimit(setting?.monthlyLimit)
  if (!limit) return
  const full = total.cost >= limit
  if (!full && (total.cost < limit * 0.8 || total.alerted80)) return
  if (full && total.alerted100) return
  const claimed = await AiMonth.findOneAndUpdate(
    { month: total.month, [full ? "alerted100" : "alerted80"]: { $ne: true } },
    { $set: full ? { alerted100: true, alerted80: true } : { alerted80: true } },
  )
  if (!claimed) return
  const resets = nextMonthStart(total.month)
  // Loaded here: notify.js reaches the chat hub, which reaches services that call the model.
  const { notify } = await import("../notify.js")
  await notify({
    roles: ["admin"],
    title: full ? "This month's AI budget is used up" : "AI spending reached 80% of this month's budget",
    body: full
      ? `${dollars(total.cost)} of ${dollars(limit)}. New AI work is paused until ${resets}, or until an admin raises the budget in Settings → Agent.`
      : `${dollars(total.cost)} of ${dollars(limit)} used. Settings → Agent shows where it went.`,
    href: "/settings?tab=agent",
    event: "agent.budget",
    email: false,
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// `extra`: more request settings for this call only, such as { reasoning: { effort: "low" } }. `meter`: what the call
// is for and who for (createMeter); every call is counted against the team's monthly budget. `attempts`: how many
// times a busy or failing model service is tried.
export async function chat({ model, messages, tools, toolChoice, temperature = 0.2, maxTokens = 4000, tracker, extra = null, timeoutMs = TIMEOUT_MS, meter = null, attempts = MAX_ATTEMPTS }) {
  const key = modelKey()
  if (!key) throw new Error("The agent is not connected to a model yet. Add OPENROUTER_API_KEY to the server .env file.")
  await checkBudget(meter)
  const body = { model, messages, temperature, max_tokens: maxTokens, ...(extra || {}) }
  if (tools?.length) {
    body.tools = tools
    if (toolChoice) body.tool_choice = toolChoice
  }
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${(process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": appOrigin(),
          "X-Title": "SynergiFund",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) {
        const message = data.error?.message || `The model service answered ${response.status}.`
        const retryable = response.status === 429 || response.status >= 500
        lastError = new Error(message)
        lastError.fatal = !retryable
        if (!retryable || attempt === attempts) throw lastError
      } else {
        trackUsage(tracker, data.usage, await recordUsage({ meter, model, usage: data.usage }))
        const message = data.choices?.[0]?.message || {}
        return {
          content: typeof message.content === "string" ? message.content : "",
          toolCalls: (message.tool_calls || []).map((call, index) => ({
            id: call.id || `call_${index}_${Date.now()}`,
            name: call.function?.name || "",
            arguments: call.function?.arguments || "{}",
          })),
        }
      }
    } catch (error) {
      lastError = error.name === "AbortError" ? new Error("The model took too long to answer.") : error
      if (lastError.fatal || attempt === attempts) throw lastError
    } finally {
      clearTimeout(timer)
    }
    await wait(500 * 2 ** (attempt - 1))
  }
  throw lastError || new Error("The model did not answer.")
}
