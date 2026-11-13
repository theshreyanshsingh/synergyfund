import { Router } from "express"
import mongoose from "mongoose"
import multer from "multer"
import { AGENT_ACCENTS, AGENT_VOICES } from "@synergifund/shared"
import { AgentSetting, AgentThread } from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { budgetMessage, budgetState } from "../services/agent/llm.js"
import { SSE_HEADERS } from "../services/agent/stream.js"
import { MAX_TURN_BYTES, greet, problemText, readTurn, voiceAvailable, voiceSettings, voiceStream, voiceTurn } from "../services/agent/voice.js"
import { TEMPORARY_CHAT_TTL_MS } from "./agent.js"

// Talking with the Agent (services/agent/voice.js). The page sends each spoken turn as a recording and plays the
// speech that streams back; the conversation is saved in the person's Agent chats like a typed one.
export const voiceRouter = Router()

voiceRouter.use(requirePermission("agent.ask"))

const turnUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_TURN_BYTES, files: 1 } })

async function presentVoice(req) {
  return { available: voiceAvailable(), ...(await voiceSettings()), voices: AGENT_VOICES, accents: AGENT_ACCENTS, canEdit: req.user.role === "admin" }
}

voiceRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await presentVoice(req))
  }),
)

// The voice and accent are the team's, chosen by an admin (Settings → Agent).
voiceRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") {
      sendError(res, 403, "Only an admin can change the Agent's voice.")
      return
    }
    const changes = {}
    if (req.body.voice !== undefined) {
      if (!AGENT_VOICES[req.body.voice]) {
        sendError(res, 400, "Choose one of the listed voices.")
        return
      }
      changes.voiceName = req.body.voice
    }
    if (req.body.accent !== undefined) {
      if (!AGENT_ACCENTS[req.body.accent]) {
        sendError(res, 400, "Choose one of the listed accents.")
        return
      }
      changes.voiceAccent = req.body.accent
    }
    if (Object.keys(changes).length) await AgentSetting.findOneAndUpdate({ key: "org" }, { $set: { ...changes, updatedBy: req.user.name } }, { upsert: true, setDefaultsOnInsert: true })
    res.json(await presentVoice(req))
  }),
)

// Whether a spoken turn can be taken at all, before any of it streams: false once the reason has been sent.
async function ready(res) {
  if (!voiceAvailable()) {
    sendError(res, 503, "The Agent is not connected to a model yet.")
    return false
  }
  const budget = await budgetState()
  if (budget.reached) {
    sendError(res, 402, budgetMessage(budget))
    return false
  }
  return true
}

// Starts the stream and runs `work` on it. A person who stops listening (closes the page, or talks over the Agent)
// stops the speech being made for them.
async function streamed(req, res, work) {
  const gone = new AbortController()
  res.on("close", () => {
    if (!res.writableEnded) gone.abort()
  })
  res.writeHead(200, SSE_HEADERS)
  res.flushHeaders?.()
  const out = voiceStream(res)
  try {
    await work(out, gone.signal)
  } catch (error) {
    if (!gone.signal.aborted) {
      if (!error.voiceProblem && !error.budgetReached && !error.notAnswered) console.error("Agent voice turn failed", error)
      out.send({ t: "error", message: problemText(error) })
    }
  } finally {
    out.end()
  }
}

voiceRouter.post(
  "/greet",
  asyncHandler(async (req, res) => {
    if (!(await ready(res))) return
    await streamed(req, res, (out, signal) => greet({ user: req.user, out, signal }))
  }),
)

function receiveTurn(req, res, next) {
  turnUpload.single("audio")(req, res, (error) => {
    if (!error) return next()
    sendError(res, 400, error.code === "LIMIT_FILE_SIZE" ? "Keep each turn under a minute." : "That recording could not be read. Try saying it again.")
  })
}

voiceRouter.post(
  "/turn",
  receiveTurn,
  asyncHandler(async (req, res) => {
    let turn
    try {
      turn = readTurn(req.file?.buffer)
    } catch (error) {
      sendError(res, error.status || 400, problemText(error))
      return
    }
    if (!(await ready(res))) return
    let thread = null
    if (req.body.threadId) {
      thread = mongoose.isValidObjectId(req.body.threadId) ? await AgentThread.findOne({ _id: req.body.threadId, userId: req.user._id }) : null
      if (!thread) {
        sendError(res, 404, "That conversation was not found.")
        return
      }
    }
    // A new chat is saved with its first exchange (the stream says so then), never empty.
    if (!thread) thread = new AgentThread({ userId: req.user._id, messages: [], temporary: req.body.temporary === true || req.body.temporary === "true" })
    else res.setHeader("X-Chat-Id", String(thread._id))
    await streamed(req, res, (out, signal) => voiceTurn({ user: req.user, permissions: req.permissions, thread, wav: turn.wav, out, signal, temporaryFor: TEMPORARY_CHAT_TTL_MS }))
  }),
)
