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

// Saves a call and adds it to the month without the caller waiting for the database (three writes each call), and
// gives its cost as charged (0 when the answer came without one: what is saved is then priced from the list).
const recording = new Set()

export function noteUsage({ meter, model, usage }) {
  const saving = recordUsage({ meter, model, usage }).finally(() => recording.delete(saving))
  recording.add(saving)
  return chargedCost(usage) ?? 0
}

// Once every call noted so far is saved (the tests read them).
export async function usageSettled() {
  while (recording.size) await Promise.allSettled([...recording])
}

// Saves one call and adds it to the month. Returns its cost. A failure to save is logged and never fails the answer.
// (noteUsage does this for chat()'s calls and the Agent's voice, see voice.js, without waiting.)
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

// The instructions (the first message) marked to be cached by an Anthropic model, which caches only what is marked:
// asked again within a few minutes (the next question, the next step), they are read for a tenth of the price.
function cachedInstructions(model, messages) {
  const [first, ...rest] = messages || []
  if (!String(model).startsWith("anthropic/") || first?.role !== "system" || typeof first.content !== "string") return messages
  return [{ ...first, content: [{ type: "text", text: first.content, cache_control: { type: "ephemeral" } }] }, ...rest]
}

// A streamed answer read as it comes: `onText(text, { calling })` gets the text so far after each piece (`calling`:
// a tool call has begun). Gives what a whole answer gives ({ data, streamed }); a service that answers in one piece
// anyway is read as one, and a stream that stops before its end is a failure (what came of it is not the answer).
async function readAnswer(response, onText) {
  if (!/event-stream/i.test(response.headers.get("content-type") || "")) {
    const data = await response.json().catch(() => ({}))
    const content = data.choices?.[0]?.message?.content
    if (!data.error && typeof content === "string" && content) onText(content, { calling: Boolean(data.choices[0].message.tool_calls?.length) })
    return { data, streamed: false }
  }
  let content = ""
  let usage = null
  let provider = ""
  let error = null
  // (The service ends a whole answer with a reason it finished, then [DONE].)
  let finished = false
  const calls = []
  const decoder = new TextDecoder()
  let rest = ""
  const read = (line) => {
    if (!line.startsWith("data:")) return false
    const text = line.slice(5).trim()
    if (text === "[DONE]") {
      finished = true
      return true
    }
    let piece
    try {
      piece = JSON.parse(text)
    } catch {
      return false
    }
    if (piece?.error) {
      error = piece.error
      return true
    }
    if (piece?.usage) usage = piece.usage
    if (typeof piece?.provider === "string") provider ||= piece.provider
    if (piece?.choices?.[0]?.finish_reason) finished = true
    const delta = piece?.choices?.[0]?.delta || {}
    for (const call of delta.tool_calls || []) {
      const at = Number.isInteger(call.index) ? call.index : calls.length
      calls[at] ||= { id: "", type: "function", function: { name: "", arguments: "" } }
      if (call.id) calls[at].id = call.id
      if (call.function?.name) calls[at].function.name += call.function.name
      if (call.function?.arguments) calls[at].function.arguments += call.function.arguments
    }
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content
      onText(content, { calling: calls.length > 0 })
    }
    return false
  }
  reading: for await (const chunk of response.body) {
    rest += decoder.decode(chunk, { stream: true })
    for (let end = rest.indexOf("\n"); end !== -1; end = rest.indexOf("\n")) {
      const line = rest.slice(0, end).trim()
      rest = rest.slice(end + 1)
      if (read(line)) break reading
    }
  }
  if (rest.trim()) read(rest.trim())
  if (!error && !finished) error = { message: "The model's answer was cut off.", code: 502 }
  const message ={ role: "assistant", content, ...(calls.length ? { tool_calls: calls.filter(Boolean) } : {}) }
  return { data: error ? { error } : { provider, usage, choices: [{ message }] }, streamed: true }
}

// What a call stopped part-way would have been charged for its instructions, by their length (about four characters
// a token), when the service could not say.
function stoppedUsage(body) {
  return { prompt_tokens: Math.round(JSON.stringify(body.messages || []).length / 4), completion_tokens: 0 }
}

// `extra`: more request settings for this call only, such as { reasoning: { effort: "low" } }. `meter`: what the call
// is for and who for (createMeter); every call is counted against the team's monthly budget. `attempts`: how many
// times a busy or failing model service is tried. `cache`: the instructions are cached (cachedInstructions).
// `onText(text, { calling })`: the answer is streamed and this gets its text so far as it comes (see readAnswer); a
// call that fails part-way is tried again like any other, and this then gets the new answer's text from its start.
// `signal`: stops the call (it then throws an AbortError, and what it cost so far is counted from its length).
// Gives { content, toolCalls, provider }, `provider` being who served it ("Io Net").
export async function chat({ model, messages, tools, toolChoice, temperature = 0.2, maxTokens = 4000, tracker, extra = null, timeoutMs = TIMEOUT_MS, meter = null, attempts = MAX_ATTEMPTS, cache = false, onText = null, signal = null }) {
  const key = modelKey()
  if (!key) throw new Error("The agent is not connected to a model yet. Add OPENROUTER_API_KEY to the server .env file.")
  await checkBudget(meter)
  const body = { model, messages: cache ? cachedInstructions(model, messages) : messages, temperature, max_tokens: maxTokens, ...(extra || {}) }
  if (onText) Object.assign(body, { stream: true, usage: { include: true } })
  if (tools?.length) {
    body.tools = tools
    if (toolChoice) body.tool_choice = toolChoice
  }
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) throw stopped()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const stop = () => controller.abort()
    signal?.addEventListener("abort", stop, { once: true })
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
      const streaming = onText && response.ok
      const data = streaming ? (await readAnswer(response, onText)).data : await response.json().catch(() => ({}))
      if (!response.ok || data.error) {
        const message = data.error?.message || `The model service answered ${response.status}.`
        // (A stream that fails part-way says why in its last piece, with a status code or none.)
        const status = streaming ? Number(data.error?.code) || 502 : response.status
        const retryable = status === 429 || status >= 500
        lastError = new Error(message)
        lastError.fatal = !retryable
        if (!retryable || attempt === attempts) throw lastError
      } else {
        trackUsage(tracker, data.usage, noteUsage({ meter, model, usage: data.usage }))
        const message = data.choices?.[0]?.message || {}
        return {
          content: typeof message.content === "string" ? message.content : "",
          toolCalls: (message.tool_calls || []).map((call, index) => ({
            id: call.id || `call_${index}_${Date.now()}`,
            name: call.function?.name || "",
            arguments: call.function?.arguments || "{}",
          })),
          provider: typeof data.provider === "string" ? data.provider : "",
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        // (Stopped by the caller: it is charged for what it was sent.)
        noteUsage({ meter, model, usage: stoppedUsage(body) })
        throw stopped()
      }
      lastError = error.name === "AbortError" ? new Error("The model took too long to answer.") : error
      if (lastError.fatal || attempt === attempts) throw lastError
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", stop)
    }
    await wait(500 * 2 ** (attempt - 1))
  }
  throw lastError || new Error("The model did not answer.")
}

function stopped() {
  const error = new Error("The model call was stopped.")
  error.name = "AbortError"
  error.stopped = true
  return error
}
