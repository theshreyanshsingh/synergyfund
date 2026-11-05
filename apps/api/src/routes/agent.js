import { Router } from "express"
import { chatTitleFromPrompt } from "@synergifund/shared"
import mongoose from "mongoose"
import { AgentPrompt, AgentProposal, AgentRename, AgentSetting, AgentThread, DocumentFile, Loan, Property } from "../models/index.js"
import { asyncHandler, blockContractors, requirePermission, sendError } from "../lib/http.js"
import { presentProperty } from "../lib/serialize.js"
import { teamZoneName } from "../lib/dates.js"
import { ownsProperty } from "../services/access.js"
import { agentSettings, modelKey } from "../services/agent/llm.js"
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
const CATALOG_TTL_MS = 60 * 60 * 1000
const TEMPORARY_CHAT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TITLE = 80
const MAX_PROMPTS = 200
const FEEDBACK = ["up", "down", ""]
let catalog = { at: 0, models: null }

async function openRouterModels() {
  if (catalog.models && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.models
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`${(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/models`, { signal: controller.signal })
    const data = await response.json()
    if (!response.ok || !Array.isArray(data.data)) return null
    catalog = { at: Date.now(), models: new Map(data.data.map((model) => [model.id, model])) }
    return catalog.models
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

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

function presentSettings(settings, user) {
  const admin = user.role === "admin"
  return {
    canManage: admin,
    modelConnected: Boolean(modelKey()),
    webConnected: Boolean(String(process.env.FIRECRAWL_API_KEY || "").trim()),
    ...(admin ? settings : {}),
  }
}

function presentMessage(message) {
  return {
    id: String(message._id),
    role: message.role === "user" ? "user" : "assistant",
    content: message.content || "",
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
    const documents = req.user.role === "admin" && req.query.documents === "1" ? await documentReading() : null
    res.json({ settings: { ...presentSettings(await agentSettings(), req.user), ...(documents ? { documents } : {}) } })
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
    await AgentSetting.findOneAndUpdate({ key: "org" }, { ...next, ...(reading !== undefined ? { docsReadAll: reading } : {}), key: "org", updatedBy: req.user.email }, { upsert: true, new: true, setDefaultsOnInsert: true })
    if (reading !== undefined) {
      await recordActivity({ user: req.user, title: "Agent document reading changed", detail: reading ? "The Agent reads the documents that were already there, as well as new ones" : "The Agent reads new documents only" })
      if (reading) nudgeDocumentReader()
    }
    const changes = [
      before.taskModel !== next.taskModel ? `Task model ${before.taskModel} → ${next.taskModel}` : "",
      before.decisionModel !== next.decisionModel ? `Decision model ${before.decisionModel} → ${next.decisionModel}` : "",
    ].filter(Boolean).join(" · ")
    if (modelsGiven || reading === undefined) await recordActivity({ user: req.user, title: "Agent models changed", detail: changes || "Saved with no changes" })
    res.json({ settings: { ...presentSettings(next, req.user), documents: await documentReading() } })
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
    res.json({ thread: { ...presentThread(thread), messages } })
  }),
)

agentRouter.delete(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const thread = await AgentThread.findOne({ _id: req.params.id, userId: req.user._id }).select("title temporary messages.attachments").catch(() => null)
    const result = thread ? await AgentThread.deleteOne({ _id: thread._id }) : null
    if (!result?.deletedCount) {
      sendError(res, 404, "That conversation was not found.")
      return
    }
    await removeAttachments(threadFileIds([thread])).catch((error) => console.error("Agent attachment removal failed", error))
    await AgentProposal.deleteMany({ threadId: thread._id, status: "pending" })
    await AgentRename.deleteMany({ threadId: thread._id, status: "pending" })
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
