import { Router } from "express"
import { AGENT_DEFAULTS, chatTitleFromPrompt } from "@synergifund/shared"
import { AgentSetting, AgentThread } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { modelKey } from "../services/agent/llm.js"
import { runAgent } from "../services/agent/run.js"
import { resumeRun } from "../services/agent/stream.js"
import { recordActivity } from "../services/notify.js"

export const agentRouter = Router()

const MAX_PROMPT = 10000
const MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i
const CATALOG_TTL_MS = 60 * 60 * 1000
let catalog = { at: 0, models: null }

export async function agentSettings() {
  const stored = await AgentSetting.findOne({ key: "org" })
  return {
    taskModel: stored?.taskModel || AGENT_DEFAULTS.taskModel,
    decisionModel: stored?.decisionModel || AGENT_DEFAULTS.decisionModel,
  }
}

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
    createdAt: message.at,
  }
}

function presentThread(thread) {
  return { id: String(thread._id), title: thread.title || "New chat", updatedAt: thread.updatedAt }
}

agentRouter.use(requirePermission("agent.ask"))

agentRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    res.json({ settings: presentSettings(await agentSettings(), req.user) })
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
    await AgentSetting.findOneAndUpdate({ key: "org" }, { ...next, key: "org", updatedBy: req.user.email }, { upsert: true, new: true, setDefaultsOnInsert: true })
    const changes = [
      before.taskModel !== next.taskModel ? `Task model ${before.taskModel} → ${next.taskModel}` : "",
      before.decisionModel !== next.decisionModel ? `Decision model ${before.decisionModel} → ${next.decisionModel}` : "",
    ].filter(Boolean).join(" · ")
    await recordActivity({ user: req.user, title: "Agent models changed", detail: changes || "Saved with no changes" })
    res.json({ settings: presentSettings(next, req.user) })
  }),
)

agentRouter.get(
  "/threads",
  asyncHandler(async (req, res) => {
    const threads = await AgentThread.find({ userId: req.user._id }).select("title updatedAt").sort({ updatedAt: -1 }).limit(100)
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
    res.json({ thread: { ...presentThread(thread), messages: thread.messages.map(presentMessage) } })
  }),
)

agentRouter.delete(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const thread = await AgentThread.findOne({ _id: req.params.id, userId: req.user._id }).select("title").catch(() => null)
    const result = thread ? await AgentThread.deleteOne({ _id: thread._id }) : null
    if (!result?.deletedCount) {
      sendError(res, 404, "That conversation was not found.")
      return
    }
    await recordActivity({ user: req.user, title: "Agent chat deleted", detail: thread.title || "" })
    res.json({ ok: true })
  }),
)

agentRouter.post(
  "/run",
  asyncHandler(async (req, res) => {
    const prompt = String(req.body.prompt || "").trim()
    if (!prompt) {
      sendError(res, 400, "Ask a question about the records you can see.")
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
    if (!thread) thread = new AgentThread({ userId: req.user._id, title: chatTitleFromPrompt(prompt), messages: [] })
    thread.messages.push({ role: "user", content: prompt })
    await thread.save()
    await recordActivity({ user: req.user, title: "Asked the agent", detail: chatTitleFromPrompt(prompt) })
    const settings = await agentSettings()
    res.setHeader("X-Chat-Id", String(thread._id))
    res.setHeader("Access-Control-Expose-Headers", "X-Chat-Id, X-Run-Id")
    await runAgent({ user: req.user, permissions: req.permissions, thread, prompt, res, settings })
  }),
)

agentRouter.get("/stream/:runId", resumeRun)
