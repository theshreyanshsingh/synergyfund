import { Router } from "express"
import { chatTitleFromPrompt } from "@synergifund/shared"
import mongoose from "mongoose"
import { NOT_OWNED_STAGES, cityLine } from "@synergifund/shared"
import { AgentMemory, AgentPrompt, AgentProposal, AgentRename, AgentSetting, AgentThread, AiMonth, AiUsage, DocumentFile, HouseSummary, Loan, Property, TeamNote, TeamNoteDraft, User } from "../models/index.js"
import { asyncHandler, blockContractors, requirePermission, sendError } from "../lib/http.js"
import { presentProperty } from "../lib/serialize.js"
import { teamToday, teamZoneName } from "../lib/dates.js"
import { ownsProperty } from "../services/access.js"
import { agentSettings, budgetLimit, budgetMessage, budgetState, dollars, modelKey, teamMonth } from "../services/agent/llm.js"
import { MAX_MEMORIES, MAX_MEMORY_CHARS, forgetNotes, makeRoom, memoryText, presentMemory, secretIn } from "../services/agent/memory.js"
import { openRouterModels } from "../services/agent/catalog.js"
import { MAX_HOUSE_NOTES, MAX_NOTE_CHARS, MAX_TEAM_NOTES, addressesOf, businessRoom, editsKnowledge, freshDrafts, noteText, presentDraft, presentTeamNote, seesKnowledge } from "../services/agent/knowledge.js"
import { presentSummary, summaryStatus, wantSummary } from "../services/agent/summaries.js"
import { HIDDEN_KINDS, documentReading, nudgeDocumentReader } from "../services/agent/documents.js"
import { BRIEF_REPEAT, BRIEF_TEXT, MAX_REPEATING, REPEAT_EVERY, cleanRepeat, repeatName, startingDay } from "../services/agent/repeats.js"
import { applyRename, freshRenames, presentRename } from "../services/agent/renames.js"
import { applyLoanProposal, applyProposal, changedSince, freshProposals, presentProposal } from "../services/agent/proposals.js"
import { runAgent } from "../services/agent/run.js"
import { resumeRun } from "../services/agent/stream.js"
import { recordActivity } from "../services/notify.js"
import { escapeRegex } from "../services/chat.js"
import { headerNameUtf8, upload } from "../services/files.js"
import { memoFileName, writeMemo } from "../services/agent/memo.js"
import { MAX_ATTACHMENTS, attachmentProblem, removeAttachments, saveAttachments, sweepAttachments, threadFileIds } from "../services/agent/attachments.js"

export const agentRouter = Router()

const MAX_PROMPT = 10000
const MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i
export const TEMPORARY_CHAT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TITLE = 80
const MAX_PROMPTS = 200
const FEEDBACK = ["up", "down", ""]

async function checkModel(id) {
  if (!MODEL_ID.test(id)) return "Enter an OpenRouter model id such as anthropic/claude-sonnet-5.5."
  const models = await openRouterModels()
  if (!models) return ""
  const model = models.get(id)
  if (!model) return `OpenRouter has no model called ${id}.`
  if (!(model.supported_parameters || []).includes("tools")) return `${id} cannot call tools, so the agent cannot use it.`
  return ""
}

const PROVIDERS = [
  ["anthropic", "Anthropic"],
  ["moonshotai", "Moonshot"],
  ["openai", "OpenAI"],
  ["google", "Google"],
  ["deepseek", "DeepSeek"],
  ["x-ai", "xAI"],
  ["qwen", "Qwen"],
  ["mistralai", "Mistral"],
  ["meta-llama", "Meta"],
]

function perMillion(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 1e6 * 100) / 100 : null
}

function presentModel(model) {
  const [provider] = model.id.split("/")
  return {
    id: model.id,
    name: String(model.name || model.id).replace(/^[^:]+:\s*/, ""),
    provider: PROVIDERS.find(([key]) => key === provider)?.[1] || provider,
    input: perMillion(model.pricing?.prompt),
    output: perMillion(model.pricing?.completion),
    context: model.context_length || null,
    created: model.created || 0,
  }
}

// `budget` (budgetState): everyone hears when this month's AI budget is used up; admins see the budget and spending.
function presentSettings(settings, user, budget) {
  const admin = user.role === "admin"
  return {
    canManage: admin,
    modelConnected: Boolean(modelKey()),
    webConnected: Boolean(String(process.env.FIRECRAWL_API_KEY || "").trim()),
    budgetReached: budget.reached,
    ...(budget.reached ? { budgetMessage: budgetMessage(budget) } : {}),
    ...(admin ? { ...settings, monthlyLimit: budget.limit, spent: budget.spent, resets: budget.resets } : {}),
  }
}

function presentMessage(message) {
  return {
    id: String(message._id),
    // PDFs the Agent made for the answer (their words stay on the server).
    files: (message.files || []).map((item) => ({ id: String(item.fileId), name: item.name || "Document.pdf", mime: item.mime || "application/pdf", size: item.size || 0 })),
    memoryNotes: (message.memoryNotes || []).map(String),
    role: message.role === "user" ? "user" : "assistant",
    content: message.content || "",
    // Said or heard in a spoken conversation (services/agent/voice.js).
    voice: Boolean(message.voice),
    toolCalls: (message.toolCalls || []).map((call) => ({ tool: call.tool, args: call.args || {}, result: call.result || {} })),
    todos: (message.todos || []).map((todo) => ({ id: todo.id, content: todo.content, status: todo.status })),
    agentRunDurationMs: message.agentRunDurationMs ?? null,
    error: Boolean(message.error),
    attachments: (message.attachments || []).map((item) => ({ id: String(item.fileId), name: item.name || "File", mime: item.mime || "", size: item.size || 0 })),
    feedback: FEEDBACK.includes(message.feedback) ? message.feedback : "",
    createdAt: message.at,
  }
}

function presentThread(thread) {
  return { id: String(thread._id), title: thread.title || "New chat", pinned: Boolean(thread.pinned), updatedAt: thread.updatedAt }
}

function presentPrompt(prompt) {
  const repeating = REPEAT_EVERY.includes(prompt.repeat?.every)
  return {
    id: String(prompt._id),
    text: prompt.text,
    updatedAt: prompt.updatedAt,
    brief: Boolean(prompt.brief),
    name: repeatName(prompt),
    repeat: repeating ? { every: prompt.repeat.every, day: prompt.repeat.day ?? null, hour: prompt.repeat.hour } : null,
    // The last time the Agent asked it on its own, and the chat it left.
    lastRun: prompt.lastRunAt ? { at: prompt.lastRunAt, chatId: prompt.lastThreadId ? String(prompt.lastThreadId) : "", error: prompt.lastError || "" } : null,
  }
}

async function ownThread(req, res, select = "") {
  const thread = mongoose.isValidObjectId(req.params.id) ? await AgentThread.findOne({ _id: req.params.id, userId: req.user._id }).select(select) : null
  if (!thread) sendError(res, 404, "That conversation was not found.")
  return thread
}

agentRouter.use(requirePermission("agent.ask"))

agentRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    // ?documents=1 (Settings): admins also see how far the Agent has got reading the documents. The Agent page asks
    // without it, so opening the Agent never counts the library.
    const forAdmin = req.user.role === "admin" && req.query.documents === "1"
    const [settings, budget, documents, summaries] = await Promise.all([agentSettings(), budgetState(), forAdmin ? documentReading() : null, forAdmin ? summaryStatus() : null])
    res.json({ settings: { ...presentSettings(settings, req.user, budget), ...(documents ? { documents, summaries } : {}) } })
  }),
)

agentRouter.get(
  "/models",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") {
      sendError(res, 403, "Only an admin can change the agent models.")
      return
    }
    const models = await openRouterModels()
    if (!models) {
      sendError(res, 502, "OpenRouter's model list could not be loaded. Try again in a minute.")
      return
    }
    const order = PROVIDERS.map(([key]) => key)
    const items = [...models.values()]
      .filter((model) => order.includes(model.id.split("/")[0]) && !model.id.includes(":") && (model.supported_parameters || []).includes("tools"))
      .sort((left, right) => order.indexOf(left.id.split("/")[0]) - order.indexOf(right.id.split("/")[0]) || (right.created || 0) - (left.created || 0))
      .map(presentModel)
    res.json({ items })
  }),
)

agentRouter.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") {
      sendError(res, 403, "Only an admin can change the agent models.")
      return
    }
    // readAllDocuments: also read the documents that were there before the reader started (true), or only new ones.
    const reading = req.body.readAllDocuments
    if (reading !== undefined && typeof reading !== "boolean") {
      sendError(res, 400, "readAllDocuments must be true or false.")
      return
    }
    // monthlyLimit: the team's AI budget for a month in dollars (a number, or digits); blank (or null) for no limit.
    const asked = req.body.monthlyLimit
    const limitGiven = asked !== undefined
    const blank = asked === null || (typeof asked === "string" && !asked.trim())
    const limit = !limitGiven || blank ? null : typeof asked === "number" || (typeof asked === "string" && /^\d+(\.\d+)?$/.test(asked.trim())) ? budgetLimit(asked) : NaN
    if (limitGiven && !blank && (limit == null || Number.isNaN(limit) || limit > 1000000 || Math.abs(Math.round(limit * 100) - limit * 100) > 1e-6)) {
      sendError(res, 400, "Enter the monthly budget in dollars, like 500, or leave it blank for no limit.")
      return
    }
    const modelsGiven = ["taskModel", "decisionModel"].some((key) => req.body[key] !== undefined)
    const next = await agentSettings()
    const before = { ...next }
    for (const key of ["taskModel", "decisionModel"]) {
      if (req.body[key] === undefined) continue
      const id = String(req.body[key] || "").trim()
      const problem = await checkModel(id)
      if (problem) {
        sendError(res, 400, problem)
        return
      }
      next[key] = id
    }
    const was = limitGiven ? await budgetState() : null
    await AgentSetting.findOneAndUpdate({ key: "org" }, { ...next, ...(reading !== undefined ? { docsReadAll: reading } : {}), ...(limitGiven ? { monthlyLimit: limit } : {}), key: "org", updatedBy: req.user.email }, { upsert: true, new: true, setDefaultsOnInsert: true })
    if (limitGiven && was.limit !== limit) {
      // With a new budget the admins hear again at its 80% and 100%, unless spending is already past them.
      await AiMonth.updateOne({ month: was.month }, { $set: { alerted80: limit != null && was.spent >= limit * 0.8, alerted100: limit != null && was.spent >= limit } })
      await recordActivity({ user: req.user, title: "AI budget changed", detail: `Monthly AI budget ${was.limit == null ? "no limit" : dollars(was.limit)} → ${limit == null ? "no limit" : dollars(limit)}` })
    }
    if (reading !== undefined) {
      await recordActivity({ user: req.user, title: "Agent document reading changed", detail: reading ? "The Agent reads the documents that were already there, as well as new ones" : "The Agent reads new documents only" })
      if (reading) nudgeDocumentReader()
    }
    const changes = [
      before.taskModel !== next.taskModel ? `Task model ${before.taskModel} → ${next.taskModel}` : "",
      before.decisionModel !== next.decisionModel ? `Decision model ${before.decisionModel} → ${next.decisionModel}` : "",
    ].filter(Boolean).join(" · ")
    if (modelsGiven || (reading === undefined && !limitGiven)) await recordActivity({ user: req.user, title: "Agent models changed", detail: changes || "Saved with no changes" })
    res.json({ settings: { ...presentSettings(next, req.user, await budgetState()), documents: await documentReading(), summaries: await summaryStatus() } })
  }),
)

// What the AI cost in a month (Settings → Agent → AI spending; admins only): the total and the budget, each day, and
// by what it was for, by person and by model. ?month=YYYY-MM, this month when left out. `months`: the months with
// spending, newest first, for the month picker.
const FEATURES = ["agent", "voice", "memory", "knowledge", "receipts", "documents", "calls", "teammate", "other"]

// The days of `month` for the chart: every one, or this month's up to today.
function monthDays(month) {
  const [year, number] = month.split("-").map(Number)
  const today = teamToday()
  const last = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : new Date(Date.UTC(year, number, 0)).getUTCDate()
  return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)
}

agentRouter.get(
  "/usage",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") return sendError(res, 403, "Only an admin can see AI spending.")
    const current = teamMonth()
    const asked = String(req.query.month || "")
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= current ? asked : current
    const [budget, totals, groups] = await Promise.all([
      budgetState(),
      AiMonth.find({ cost: { $gt: 0 } }).select("month").sort({ month: -1 }).limit(24).lean(),
      AiUsage.aggregate([
        { $match: { month } },
        { $group: { _id: { day: "$day", feature: "$feature", userId: "$userId", model: "$model" }, cost: { $sum: "$cost" }, calls: { $sum: 1 }, tokens: { $sum: { $add: ["$promptTokens", "$completionTokens"] } }, estimated: { $max: "$estimated" } } },
      ]),
    ])
    const people = new Map((await User.find({ _id: { $in: [...new Set(groups.map((row) => row._id.userId).filter(Boolean).map(String))] } }).select("name").lean()).map((user) => [String(user._id), user.name]))
    const add = (map, key, row, extra = {}) => {
      const item = map.get(key) || { ...extra, cost: 0, calls: 0, tokens: 0 }
      item.cost += row.cost
      item.calls += row.calls
      item.tokens += row.tokens
      map.set(key, item)
    }
    const byDay = new Map(monthDays(month).map((day) => [day, { day, cost: 0, calls: 0, tokens: 0 }]))
    const byFeature = new Map()
    const byPerson = new Map()
    const byModel = new Map()
    for (const row of groups) {
      const { day, feature, userId, model } = row._id
      add(byDay, day, row, { day })
      const kind = FEATURES.includes(feature) ? feature : "other"
      add(byFeature, kind, row, { feature: kind })
      const id = userId ? String(userId) : ""
      add(byPerson, id, row, { id, name: id ? people.get(id) || "Former member" : "Background work" })
      add(byModel, model || "", row, { model: model || "Unknown model" })
    }
    const sorted = (map) => [...map.values()].sort((left, right) => right.cost - left.cost)
    const round = (item) => ({ ...item, cost: Math.round(item.cost * 1e6) / 1e6 })
    const total = groups.reduce((sum, row) => sum + row.cost, 0)
    const months = [...new Set([current, ...totals.map((item) => item.month)])].sort().reverse()
    res.json({
      month,
      current: month === current,
      months,
      limit: budget.limit,
      resets: budget.resets,
      total: Math.round(total * 1e6) / 1e6,
      calls: groups.reduce((sum, row) => sum + row.calls, 0),
      estimated: groups.some((row) => row.estimated),
      byDay: [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day)).map(round),
      byFeature: sorted(byFeature).map(round),
      byPerson: sorted(byPerson).map(round),
      byModel: sorted(byModel).map(round),
    })
  }),
)

agentRouter.get(
  "/threads",
  asyncHandler(async (req, res) => {
    // `q` searches the titles and what was said.
    const filter = { userId: req.user._id, temporary: { $ne: true } }
    const needle = String(req.query.q || "").trim().slice(0, 100)
    if (needle) {
      const pattern = new RegExp(escapeRegex(needle), "i")
      filter.$or = [{ title: pattern }, { "messages.content": pattern }]
    }
    const threads = await AgentThread.find(filter).select("title pinned updatedAt").sort({ updatedAt: -1 }).limit(200)
    sweepAttachments(req.user._id).catch((error) => console.error("Agent attachment clean-up failed", error))
    res.json({ items: threads.map(presentThread) })
  }),
)

agentRouter.get(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const thread = await AgentThread.findOne({ _id: req.params.id, userId: req.user._id }).catch(() => null)
    if (!thread) {
      sendError(res, 404, "That conversation was not found.")
      return
    }
    const messages = thread.messages.map(presentMessage)
    await freshProposals(messages)
    await freshRenames(messages)
    await freshDrafts(messages)
    res.json({ thread: { ...presentThread(thread), messages } })
  }),
)

agentRouter.delete(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const thread = await AgentThread.findOne({ _id: req.params.id, userId: req.user._id }).select("title temporary messages.attachments messages.files").catch(() => null)
    const result = thread ? await AgentThread.deleteOne({ _id: thread._id }) : null
    if (!result?.deletedCount) {
      sendError(res, 404, "That conversation was not found.")
      return
    }
    await removeAttachments(threadFileIds([thread])).catch((error) => console.error("Agent attachment removal failed", error))
    await AgentProposal.deleteMany({ threadId: thread._id, status: "pending" })
    await AgentRename.deleteMany({ threadId: thread._id, status: "pending" })
    await TeamNoteDraft.deleteMany({ threadId: thread._id, status: "pending" })
    if (!thread.temporary) await recordActivity({ user: req.user, title: "Agent chat deleted", detail: thread.title || "" })
    res.json({ ok: true })
  }),
)

// Rename a chat, or pin it to the top of the list.
agentRouter.patch(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const thread = await ownThread(req, res, "title named pinned updatedAt temporary")
    if (!thread) return
    if ("title" in req.body) {
      const title = String(req.body.title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE)
      if (!title) return sendError(res, 400, "Give the chat a name.")
      thread.title = title
      thread.named = true
    }
    if ("pinned" in req.body) thread.pinned = req.body.pinned === true
    // Renaming or pinning does not move the chat up the list.
    await thread.save({ timestamps: false })
    res.json({ thread: presentThread(thread) })
  }),
)

// Thumbs up or down on an answer ("" takes it back).
agentRouter.patch(
  "/threads/:id/messages/:messageId",
  asyncHandler(async (req, res) => {
    const thread = await ownThread(req, res)
    if (!thread) return
    const message = mongoose.isValidObjectId(req.params.messageId) ? thread.messages.id(req.params.messageId) : null
    if (!message || message.role === "user") return sendError(res, 404, "That answer was not found.")
    const feedback = String(req.body.feedback ?? "")
    if (!FEEDBACK.includes(feedback)) return sendError(res, 400, "Send up, down or nothing.")
    message.feedback = feedback
    await thread.save({ timestamps: false })
    res.json({ feedback })
  }),
)

// An answer as a PDF memo (Download as PDF under it): the chat's name, who asked and when, the question, the answer,
// and what the Agent looked at (the steps it took, as the chat lists them).
agentRouter.get(
  "/threads/:id/messages/:messageId/memo",
  asyncHandler(async (req, res) => {
    const thread = await ownThread(req, res)
    if (!thread) return
    const at = thread.messages.findIndex((message) => String(message._id) === req.params.messageId)
    const answer = at === -1 ? null : thread.messages[at]
    if (!answer || answer.role === "user" || answer.error || !String(answer.content || "").trim()) return sendError(res, 404, "That answer was not found.")
    const asked = thread.messages.slice(0, at).reverse().find((message) => message.role === "user")
    const question = asked ? asked.content || `About ${(asked.attachments || []).map((file) => file.name).join(", ")}` : ""
    const looked = (answer.toolCalls || []).filter((call) => call.tool !== "todo_write" && call.result?.success !== false).map((call) => call.result?.title || "")
    const name = memoFileName(thread.title)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${headerNameUtf8(name)}`)
    res.setHeader("Cache-Control", "private, no-store")
    writeMemo(res, { title: thread.title || "Agent answer", name: req.user.name, at: answer.at, question, answer: answer.content, looked })
  }),
)

// Saved prompts: each person's own questions to ask again, some asked by the Agent on its own (repeats.js). `zone`:
// the team's clock the hours are on. `briefOffered`: the weekly brief can be turned on (not for contractors).
agentRouter.get(
  "/prompts",
  asyncHandler(async (req, res) => {
    const prompts = await AgentPrompt.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(MAX_PROMPTS)
    res.json({ items: prompts.map(presentPrompt), zone: teamZoneName(), briefOffered: req.user.role !== "contractor" && !prompts.some((prompt) => prompt.brief) })
  }),
)

function promptText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim()
}

function repeatKey(repeat) {
  return REPEAT_EVERY.includes(repeat?.every) ? `${repeat.every}:${repeat.day ?? ""}:${repeat.hour}` : ""
}

// How often a prompt is asked on its own. A message when it can't be set.
async function setRepeat(prompt, value) {
  const { repeat, error } = cleanRepeat(value)
  if (error) return error
  if (repeatKey(repeat) === repeatKey(prompt.repeat)) return ""
  if (repeat.every && !repeatKey(prompt.repeat)) {
    const repeating = await AgentPrompt.countDocuments({ userId: prompt.userId, _id: { $ne: prompt._id }, "repeat.every": { $in: REPEAT_EVERY } })
    if (repeating >= MAX_REPEATING) return `Up to ${MAX_REPEATING} prompts can repeat. Turn one off first.`
  }
  prompt.repeat = repeat
  if (repeat.every) prompt.lastRunDay = startingDay(repeat) || prompt.lastRunDay
  return ""
}

agentRouter.post(
  "/prompts",
  asyncHandler(async (req, res) => {
    // { brief: true } turns on the weekly brief: its question, Mondays at 8 AM, both changeable after.
    const brief = req.body.brief === true
    if (brief && req.user.role === "contractor") return sendError(res, 403, "The weekly brief is for the team.")
    const text = brief ? BRIEF_TEXT : promptText(req.body.text)
    if (!text) return sendError(res, 400, "Write the prompt to save.")
    if (text.length > MAX_PROMPT) return sendError(res, 400, "Keep a prompt under 10,000 characters.")
    // Saving the same words again keeps the one already there, with the repeat sent if there is one ("Never" from New
    // doesn't turn off a prompt that already repeats; Edit does that).
    const repeating = Boolean(req.body.repeat?.every)
    const existing = await AgentPrompt.findOne(brief ? { userId: req.user._id, brief: true } : { userId: req.user._id, text })
    if (existing && !repeating) return res.json({ prompt: presentPrompt(existing) })
    if (!existing && (await AgentPrompt.countDocuments({ userId: req.user._id })) >= MAX_PROMPTS) return sendError(res, 400, `Keep up to ${MAX_PROMPTS} prompts. Delete one you no longer use.`)
    const prompt = existing || new AgentPrompt({ userId: req.user._id, text, brief })
    const problem = brief || repeating ? await setRepeat(prompt, brief && !existing ? BRIEF_REPEAT : req.body.repeat) : ""
    if (problem) return sendError(res, 400, problem)
    await prompt.save()
    res.status(existing ? 200 : 201).json({ prompt: presentPrompt(prompt) })
  }),
)

agentRouter.patch(
  "/prompts/:id",
  asyncHandler(async (req, res) => {
    const prompt = mongoose.isValidObjectId(req.params.id) ? await AgentPrompt.findOne({ _id: req.params.id, userId: req.user._id }) : null
    if (!prompt) return sendError(res, 404, "That prompt was not found.")
    if ("text" in req.body) {
      const text = promptText(req.body.text)
      if (!text) return sendError(res, 400, "Write the prompt to save.")
      if (text.length > MAX_PROMPT) return sendError(res, 400, "Keep a prompt under 10,000 characters.")
      prompt.text = text
    }
    if ("repeat" in req.body) {
      const problem = await setRepeat(prompt, req.body.repeat)
      if (problem) return sendError(res, 400, problem)
    }
    await prompt.save()
    res.json({ prompt: presentPrompt(prompt) })
  }),
)

agentRouter.delete(
  "/prompts/:id",
  asyncHandler(async (req, res) => {
    const result = mongoose.isValidObjectId(req.params.id) ? await AgentPrompt.deleteOne({ _id: req.params.id, userId: req.user._id }) : null
    if (!result?.deletedCount) return sendError(res, 404, "That prompt was not found.")
    res.json({ ok: true })
  }),
)

/* ---------- memory: what the Agent remembers about this person (only they see it) ---------- */

agentRouter.get(
  "/memories",
  asyncHandler(async (req, res) => {
    const items = await AgentMemory.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean()
    res.json({ on: !req.user.agentMemoryOff, items: items.map(presentMemory), max: MAX_MEMORIES })
  }),
)

// Memory on or off for this person: off, the Agent neither uses nor learns what it remembers (the notes are kept).
agentRouter.patch(
  "/memories/settings",
  asyncHandler(async (req, res) => {
    if (typeof req.body.on !== "boolean") return sendError(res, 400, "Send on as true or false.")
    req.user.agentMemoryOff = !req.body.on
    await req.user.save()
    res.json({ on: req.body.on })
  }),
)

function memoryProblem(text) {
  if (!text) return "Write what the Agent should remember."
  if (secretIn(text)) return "The Agent doesn't remember passwords, account numbers or other secrets."
  return ""
}

agentRouter.post(
  "/memories",
  asyncHandler(async (req, res) => {
    if (typeof req.body.text !== "string") return sendError(res, 400, "Write what the Agent should remember.")
    const raw = req.body.text
    if (raw.trim().length > MAX_MEMORY_CHARS) return sendError(res, 400, `Keep a memory under ${MAX_MEMORY_CHARS} characters.`)
    const text = memoryText(raw)
    const problem = memoryProblem(text)
    if (problem) return sendError(res, 400, problem)
    const existing = await AgentMemory.findOne({ userId: req.user._id, text })
    if (existing) return res.json({ memory: presentMemory(existing) })
    // Full: the oldest the Agent learned makes way; when all are ones the person wrote, one has to go first.
    if (!(await makeRoom(req.user._id, 1))) return sendError(res, 400, `The Agent keeps up to ${MAX_MEMORIES} memories. Delete one first.`)
    const memory = await AgentMemory.create({ userId: req.user._id, text, source: "added" })
    res.status(201).json({ memory: presentMemory(memory) })
  }),
)

agentRouter.patch(
  "/memories/:id",
  asyncHandler(async (req, res) => {
    const memory = mongoose.isValidObjectId(req.params.id) ? await AgentMemory.findOne({ _id: req.params.id, userId: req.user._id }) : null
    if (!memory) return sendError(res, 404, "That memory was not found.")
    if (typeof req.body.text !== "string") return sendError(res, 400, "Write what the Agent should remember.")
    const raw = req.body.text
    if (raw.trim().length > MAX_MEMORY_CHARS) return sendError(res, 400, `Keep a memory under ${MAX_MEMORY_CHARS} characters.`)
    const text = memoryText(raw)
    const problem = memoryProblem(text)
    if (problem) return sendError(res, 400, problem)
    // The old words go from the chats' "Memory updated" notes (they were wrong, or out of date).
    const before = memory.text
    memory.text = text
    await memory.save()
    if (before !== text) await forgetNotes(req.user._id, [before], ["Saved", "Updated"])
    res.json({ memory: presentMemory(memory) })
  }),
)

// A deleted memory goes from the chats' "Memory updated" notes too, so its words aren't kept anywhere.
agentRouter.delete(
  "/memories/:id",
  asyncHandler(async (req, res) => {
    const memory = mongoose.isValidObjectId(req.params.id) ? await AgentMemory.findOneAndDelete({ _id: req.params.id, userId: req.user._id }) : null
    if (!memory) return sendError(res, 404, "That memory was not found.")
    await forgetNotes(req.user._id, [memory.text])
    res.json({ ok: true })
  }),
)

// Forget everything, and every "Memory updated" note in the chats.
agentRouter.delete(
  "/memories",
  asyncHandler(async (req, res) => {
    const result = await AgentMemory.deleteMany({ userId: req.user._id })
    await AgentThread.updateMany({ userId: req.user._id, "messages.memoryNotes.0": { $exists: true } }, { $set: { "messages.$[].memoryNotes": [] } }, { timestamps: false })
    res.json({ ok: true, deleted: result.deletedCount || 0 })
  }),
)

/* ---------- team knowledge: what the team wrote down, and the house summaries (Knowledge → Team) ---------- */

// For the people who see the whole books (knowledge.js); only admins change it.
function knowledgeReader(req, res) {
  if (seesKnowledge(req.user)) return true
  sendError(res, 403, "Team knowledge is for people who see the whole books.")
  return false
}

function knowledgeEditor(req, res) {
  if (editsKnowledge(req.user)) return true
  sendError(res, 403, "Only an admin can change the team's knowledge.")
  return false
}

function teamNoteProblem(raw) {
  if (typeof raw !== "string") return { error: "Write the note." }
  const text = noteText(raw)
  if (!text) return { error: "Write the note." }
  if (String(raw ?? "").trim().length > MAX_NOTE_CHARS) return { error: `Keep a team note under ${MAX_NOTE_CHARS} characters.` }
  if (secretIn(text)) return { error: "Team notes never hold passwords, account numbers or other secrets." }
  return { text }
}

// Room for one more note of `text`: up to MAX_TEAM_NOTES in all, MAX_HOUSE_NOTES on one house, and the notes about the
// business within what goes into every question.
async function teamNoteRoom(propertyId, text) {
  if ((await TeamNote.countDocuments()) >= MAX_TEAM_NOTES) return `The team keeps up to ${MAX_TEAM_NOTES} notes. Delete one first.`
  if (propertyId && (await TeamNote.countDocuments({ propertyId })) >= MAX_HOUSE_NOTES) return `A house keeps up to ${MAX_HOUSE_NOTES} notes. Delete one first.`
  return propertyId ? "" : businessRoom(text.length)
}

// Notes about a house are part of what its summary is written from (and right where the records differ): it is written
// again soon.
async function addTeamNote({ user, text, property = null }) {
  const note = await TeamNote.create({ text, propertyId: property?._id, createdBy: user._id, createdByName: user.name, updatedByName: user.name })
  await recordActivity({ user, title: "Team note added", detail: property ? `About ${property.address}` : "About the business", propertyId: property?._id })
  if (property) await wantSummary(property._id)
  return note
}

// Knowledge → Team: the team's notes about the business, and every house with its summary.
agentRouter.get(
  "/knowledge",
  asyncHandler(async (req, res) => {
    if (!knowledgeReader(req, res)) return
    const [notes, properties, summaries, houseNotes, status] = await Promise.all([
      TeamNote.find({ propertyId: null }).sort({ createdAt: -1 }).lean(),
      Property.find().select("address city state zip stage").lean(),
      HouseSummary.find().select("propertyId summary state writtenAt error").lean(),
      TeamNote.aggregate([{ $match: { propertyId: { $ne: null } } }, { $group: { _id: "$propertyId", count: { $sum: 1 } } }]),
      summaryStatus(),
    ])
    const byHouse = new Map(summaries.map((record) => [String(record.propertyId), record]))
    const noted = new Map(houseNotes.map((row) => [String(row._id), row.count]))
    const sold = (property) => NOT_OWNED_STAGES.includes(property.stage)
    const houses = [...properties]
      .sort((left, right) => Number(sold(left)) - Number(sold(right)) || left.address.localeCompare(right.address, undefined, { numeric: true }))
      .map((property) => {
        const summary = presentSummary(byHouse.get(String(property._id)))
        return { id: String(property._id), address: property.address, city: cityLine(property), stage: property.stage || "", state: summary.state, what: summary.what || "", writtenAt: summary.writtenAt, notes: noted.get(String(property._id)) || 0 }
      })
    res.json({ canEdit: editsKnowledge(req.user), notes: notes.map((note) => presentTeamNote(note)), houses, max: MAX_TEAM_NOTES, maxChars: MAX_NOTE_CHARS, writing: { connected: status.connected, on: status.on } })
  }),
)

// One house's summary and the team's notes on it (the property page's Summary card).
agentRouter.get(
  "/knowledge/houses/:id",
  asyncHandler(async (req, res) => {
    if (!knowledgeReader(req, res)) return
    const property = mongoose.isValidObjectId(req.params.id) ? await Property.findById(req.params.id).select("address").lean() : null
    if (!property) return sendError(res, 404, "That property is not available.")
    const [record, notes, status] = await Promise.all([HouseSummary.findOne({ propertyId: property._id }).lean(), TeamNote.find({ propertyId: property._id }).sort({ createdAt: 1 }).lean(), summaryStatus()])
    const addresses = new Map([[String(property._id), property.address]])
    res.json({ canEdit: editsKnowledge(req.user), summary: presentSummary(record), notes: notes.map((note) => presentTeamNote(note, addresses)), maxChars: MAX_NOTE_CHARS, writing: { connected: status.connected, on: status.on } })
  }),
)

// Write a house's summary again now (or every house's, with no id).
agentRouter.post(
  "/knowledge/rewrite",
  asyncHandler(async (req, res) => {
    if (!knowledgeEditor(req, res)) return
    const id = req.body.propertyId
    if (id !== undefined && id !== null && id !== "") {
      const property = mongoose.isValidObjectId(id) ? await Property.findById(id).select("_id").lean() : null
      if (!property) return sendError(res, 404, "That property is not available.")
      await wantSummary(property._id)
      return res.json({ ok: true, summary: presentSummary(await HouseSummary.findOne({ propertyId: property._id }).lean()) })
    }
    await wantSummary()
    await recordActivity({ user: req.user, title: "House summaries rewritten", detail: "The Agent writes every house's summary again" })
    res.json({ ok: true, summaries: await summaryStatus() })
  }),
)

agentRouter.post(
  "/knowledge/notes",
  asyncHandler(async (req, res) => {
    if (!knowledgeEditor(req, res)) return
    const { text, error } = teamNoteProblem(req.body.text)
    if (error) return sendError(res, 400, error)
    const id = req.body.propertyId
    let property = null
    if (id !== undefined && id !== null && id !== "") {
      property = mongoose.isValidObjectId(id) ? await Property.findById(id).select("address").lean() : null
      if (!property) return sendError(res, 404, "That property is not available.")
    }
    const existing = await TeamNote.findOne({ propertyId: property?._id ?? null, text })
    if (existing) return res.json({ note: presentTeamNote(existing, new Map(property ? [[String(property._id), property.address]] : [])) })
    const room = await teamNoteRoom(property?._id, text)
    if (room) return sendError(res, 400, room)
    const note = await addTeamNote({ user: req.user, text, property })
    res.status(201).json({ note: presentTeamNote(note, new Map(property ? [[String(property._id), property.address]] : [])) })
  }),
)

agentRouter.patch(
  "/knowledge/notes/:id",
  asyncHandler(async (req, res) => {
    if (!knowledgeEditor(req, res)) return
    const note = mongoose.isValidObjectId(req.params.id) ? await TeamNote.findById(req.params.id) : null
    if (!note) return sendError(res, 404, "That note was not found.")
    const { text, error } = teamNoteProblem(req.body.text)
    if (error) return sendError(res, 400, error)
    if (note.text !== text) {
      const room = note.propertyId ? "" : await businessRoom(text.length, note._id)
      if (room) return sendError(res, 400, room)
      note.text = text
      note.updatedByName = req.user.name
      await note.save()
      const address = note.propertyId ? (await addressesOf([note])).get(String(note.propertyId)) : ""
      await recordActivity({ user: req.user, title: "Team note changed", detail: address ? `About ${address}` : "About the business", propertyId: note.propertyId })
      if (note.propertyId) await wantSummary(note.propertyId)
    }
    res.json({ note: presentTeamNote(note, await addressesOf([note])) })
  }),
)

agentRouter.delete(
  "/knowledge/notes/:id",
  asyncHandler(async (req, res) => {
    if (!knowledgeEditor(req, res)) return
    const note = mongoose.isValidObjectId(req.params.id) ? await TeamNote.findByIdAndDelete(req.params.id) : null
    if (!note) return sendError(res, 404, "That note was not found.")
    const address = note.propertyId ? (await addressesOf([note])).get(String(note.propertyId)) : ""
    await recordActivity({ user: req.user, title: "Team note deleted", detail: address ? `About ${address}` : "About the business", propertyId: note.propertyId })
    if (note.propertyId) await wantSummary(note.propertyId)
    res.json({ ok: true })
  }),
)

// A team note the Agent prepared ("remember for the team…"): Confirm adds it, Cancel drops it. Only the admin who asked.
const DRAFT_CLOSED = {
  saved: "This note was already added.",
  cancelled: "This note was cancelled. Ask the agent again.",
  expired: "This note has expired. Ask the agent again.",
}

async function openDraft(req, res) {
  const draft = mongoose.isValidObjectId(req.params.id) ? await TeamNoteDraft.findOne({ _id: req.params.id, userId: req.user._id }) : null
  if (!draft) {
    sendError(res, 404, "That note was not found.")
    return null
  }
  const { status } = presentDraft(draft)
  if (status !== "pending") {
    sendError(res, 409, DRAFT_CLOSED[status] || DRAFT_CLOSED.expired)
    return null
  }
  return draft
}

agentRouter.post(
  "/team-notes/:id/confirm",
  asyncHandler(async (req, res) => {
    if (!knowledgeEditor(req, res)) return
    const draft = await openDraft(req, res)
    if (!draft) return
    const property = draft.propertyId ? await Property.findById(draft.propertyId).select("address").lean() : null
    if (draft.propertyId && !property) return sendError(res, 409, "Not added: that house is no longer in the records.")
    const existing = await TeamNote.findOne({ propertyId: property?._id ?? null, text: draft.text })
    const room = existing ? "" : await teamNoteRoom(property?._id, draft.text)
    if (room) return sendError(res, 400, room)
    // Taken first, so a second tap can't add it twice.
    const taken = await TeamNoteDraft.findOneAndUpdate({ _id: draft._id, status: "pending" }, { status: "saved", decidedAt: new Date() }, { new: true })
    if (!taken) return sendError(res, 409, DRAFT_CLOSED.saved)
    let note = existing
    try {
      note ||= await addTeamNote({ user: req.user, text: draft.text, property })
    } catch (error) {
      // Not added: the card can be confirmed again.
      await TeamNoteDraft.updateOne({ _id: draft._id, status: "saved" }, { status: "pending", $unset: { decidedAt: 1 } })
      throw error
    }
    taken.noteId = note._id
    await taken.save()
    res.json({ draft: presentDraft(taken) })
  }),
)

agentRouter.post(
  "/team-notes/:id/cancel",
  asyncHandler(async (req, res) => {
    const draft = await openDraft(req, res)
    if (!draft) return
    const taken = await TeamNoteDraft.findOneAndUpdate({ _id: draft._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() }, { new: true })
    if (!taken) return sendError(res, 409, DRAFT_CLOSED.saved)
    res.json({ draft: presentDraft(taken) })
  }),
)

// A question can come with files (sent as a form); a plain question is JSON.
function receiveAttachments(req, res, next) {
  if (!req.is("multipart/form-data")) return next()
  upload.array("files", MAX_ATTACHMENTS)(req, res, (error) => {
    if (!error) return next()
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Each file can be up to 20 MB."
      : error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "LIMIT_FILE_COUNT"
        ? `Attach up to ${MAX_ATTACHMENTS} files at a time.`
        : "The files could not be read."
    sendError(res, 400, message)
  })
}

agentRouter.post(
  "/run",
  receiveAttachments,
  asyncHandler(async (req, res) => {
    const prompt = String(req.body.prompt || "").trim()
    const files = req.files || []
    if (!prompt && !files.length && !req.body.replaceFrom) {
      sendError(res, 400, "Ask a question about the records you can see.")
      return
    }
    const problem = files.map(attachmentProblem).find(Boolean)
    if (problem) {
      sendError(res, 400, problem)
      return
    }
    if (prompt.length > MAX_PROMPT) {
      sendError(res, 400, "Keep the question under 10,000 characters.")
      return
    }
    // This month's AI budget is used up: the question is not saved or asked.
    const budget = await budgetState()
    if (budget.reached) {
      sendError(res, 402, budgetMessage(budget))
      return
    }
    let thread = null
    if (req.body.threadId) {
      thread = await AgentThread.findOne({ _id: req.body.threadId, userId: req.user._id }).catch(() => null)
      if (!thread) {
        sendError(res, 404, "That conversation was not found.")
        return
      }
    }
    // Retry or Edit: the question `replaceFrom` (one of this person's) and everything after it is replaced by this one.
    // Its files come along when none are sent with it.
    let carried = []
    if (req.body.replaceFrom) {
      const at = thread ? thread.messages.findIndex((message) => String(message._id) === String(req.body.replaceFrom) && message.role === "user") : -1
      if (at === -1) {
        sendError(res, 404, "That question was not found.")
        return
      }
      const fileIds = (thread.messages[at].attachments || []).map((item) => item.fileId).filter(Boolean)
      if (!files.length && fileIds.length) carried = await DocumentFile.find({ _id: { $in: fileIds }, kind: "agent", uploadedBy: req.user._id })
      thread.messages.splice(at)
    }
    if (!prompt && !files.length && !carried.length) {
      sendError(res, 400, "Ask a question about the records you can see.")
      return
    }
    const attachments = files.length ? await saveAttachments(files, req.user) : carried
    const asked = prompt || `About ${attachments.map((file) => file.name).join(", ")}`
    if (!thread) {
      thread = new AgentThread({ userId: req.user._id, title: chatTitleFromPrompt(asked), messages: [], temporary: req.body.temporary === true || req.body.temporary === "true" })
    }
    // A temporary chat lives for a day after its last message and leaves no trace in Team Activity.
    if (thread.temporary) thread.expiresAt = new Date(Date.now() + TEMPORARY_CHAT_TTL_MS)
    thread.messages.push({ role: "user", content: prompt, attachments: attachments.map((file) => ({ fileId: file._id, name: file.name, mime: file.mime, size: file.size })) })
    await thread.save()
    if (!thread.temporary) await recordActivity({ user: req.user, title: "Asked the agent", detail: `${chatTitleFromPrompt(asked)}${attachments.length ? ` (${attachments.length} ${attachments.length === 1 ? "file" : "files"})` : ""}` })
    const settings = await agentSettings()
    res.setHeader("X-Chat-Id", String(thread._id))
    res.setHeader("Access-Control-Expose-Headers", "X-Chat-Id, X-Run-Id")
    await runAgent({ user: req.user, permissions: req.permissions, thread, prompt, attachments, res, settings })
  }),
)

// A change the Agent prepared: only the person it was prepared for can confirm or cancel it, once.
const CLOSED = {
  saved: "This change was already saved.",
  cancelled: "This change was cancelled. Ask the agent again.",
  outdated: "This change is out of date. Ask the agent again.",
  expired: "This change has expired. Ask the agent again.",
}

async function openProposal(req, res) {
  const proposal = await AgentProposal.findOne({ _id: req.params.id, userId: req.user._id }).catch(() => null)
  if (!proposal) {
    sendError(res, 404, "That change was not found.")
    return null
  }
  const { status } = presentProposal(proposal)
  if (status !== "pending") {
    sendError(res, 409, CLOSED[status] || CLOSED.outdated)
    return null
  }
  return proposal
}

agentRouter.post(
  "/proposals/:id/confirm",
  requirePermission("properties.write"),
  blockContractors,
  asyncHandler(async (req, res) => {
    const proposal = await openProposal(req, res)
    if (!proposal) return
    // A loan update applies to its loan (on a property this person can see), a property change to the property.
    const loan = proposal.kind === "loan" ? await Loan.findById(proposal.loanId) : null
    const property = await Property.findById(loan ? loan.propertyId : proposal.propertyId)
    if (!property || !ownsProperty(req.user, property) || (proposal.kind === "loan" && !loan)) {
      sendError(res, 404, proposal.kind === "loan" ? "That loan is not available." : "That property is not available.")
      return
    }
    const moved = changedSince(proposal, loan || property)
    if (moved) {
      await AgentProposal.updateOne({ _id: proposal._id, status: "pending" }, { status: "outdated", decidedAt: new Date() })
      sendError(res, 409, moved)
      return
    }
    // Taken first, so a second tap can't save it twice.
    const taken = await AgentProposal.findOneAndUpdate({ _id: proposal._id, status: "pending" }, { status: "saved", decidedAt: new Date() }, { new: true })
    if (!taken) {
      sendError(res, 409, CLOSED.saved)
      return
    }
    try {
      if (loan) await applyLoanProposal(taken, loan, req.user)
      else await applyProposal(taken, property, req.user)
    } catch (error) {
      await AgentProposal.updateOne({ _id: taken._id }, { status: "pending", $unset: { decidedAt: 1 } })
      throw error
    }
    res.json({ proposal: presentProposal(taken), property: presentProperty(property, req.user) })
  }),
)

agentRouter.post(
  "/proposals/:id/cancel",
  asyncHandler(async (req, res) => {
    const proposal = await openProposal(req, res)
    if (!proposal) return
    const taken = await AgentProposal.findOneAndUpdate({ _id: proposal._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() }, { new: true })
    if (!taken) {
      sendError(res, 409, CLOSED.cancelled)
      return
    }
    res.json({ proposal: presentProposal(taken) })
  }),
)

// A rename the Agent prepared: Confirm renames the file (as renaming it in Documents would), Cancel drops it.
const RENAME_CLOSED = {
  saved: "This file was already renamed.",
  cancelled: "This rename was cancelled. Ask the agent again.",
  outdated: "This rename is out of date. Ask the agent again.",
  expired: "This rename has expired. Ask the agent again.",
}

async function openRename(req, res) {
  const rename = await AgentRename.findOne({ _id: req.params.id, userId: req.user._id }).catch(() => null)
  if (!rename) {
    sendError(res, 404, "That rename was not found.")
    return null
  }
  const { status } = presentRename(rename)
  if (status !== "pending") {
    sendError(res, 409, RENAME_CLOSED[status] || RENAME_CLOSED.outdated)
    return null
  }
  return rename
}

agentRouter.post(
  "/renames/:id/confirm",
  requirePermission("documents.write"),
  asyncHandler(async (req, res) => {
    const rename = await openRename(req, res)
    if (!rename) return
    const file = await DocumentFile.findById(rename.documentId)
    const contractor = req.user.role === "contractor"
    // As when it was prepared: a contractor renames only their own uploads, on a property they can still see.
    const property = contractor && file?.propertyId ? await Property.findById(file.propertyId) : null
    if (!file || HIDDEN_KINDS.includes(file.kind) || (contractor && (String(file.uploadedBy || "") !== String(req.user._id) || !property || !ownsProperty(req.user, property)))) {
      sendError(res, 404, "That file is not available.")
      return
    }
    // Renamed since the card was made: the person agreed to old → new, and old is no longer its name.
    if (file.name !== rename.from) {
      await AgentRename.updateOne({ _id: rename._id, status: "pending" }, { status: "outdated", decidedAt: new Date() })
      sendError(res, 409, `Not renamed: the file is called ${file.name} now, not ${rename.from}. Ask the agent again.`)
      return
    }
    // Taken first, so a second tap can't rename it twice.
    const taken = await AgentRename.findOneAndUpdate({ _id: rename._id, status: "pending" }, { status: "saved", decidedAt: new Date() }, { new: true })
    if (!taken) {
      sendError(res, 409, RENAME_CLOSED.saved)
      return
    }
    try {
      await applyRename(taken, file, req.user)
    } catch (error) {
      await AgentRename.updateOne({ _id: taken._id }, { status: "pending", $unset: { decidedAt: 1 } })
      throw error
    }
    res.json({ rename: presentRename(taken), file: { id: String(file._id), name: file.name } })
  }),
)

agentRouter.post(
  "/renames/:id/cancel",
  asyncHandler(async (req, res) => {
    const rename = await openRename(req, res)
    if (!rename) return
    const taken = await AgentRename.findOneAndUpdate({ _id: rename._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() }, { new: true })
    if (!taken) {
      sendError(res, 409, RENAME_CLOSED.cancelled)
      return
    }
    res.json({ rename: presentRename(taken) })
  }),
)

agentRouter.get("/stream/:runId", resumeRun)
