import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// The Agent's new look: a thumbs down with what was wrong and a note (the Feedback sheet), and the Agent's sounds
// turned on or off with the other sounds.
testEnv()
process.env.JWT_SECRET = "agent-feedback-test"
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { DEFAULT_SOUNDS, cleanSounds, permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { AgentThread, User } = await import("../src/models/index.js")
const { agentRouter } = await import("../src/routes/agent.js")
const { authRouter } = await import("../src/routes/auth.js")
const { signSession } = await import("../src/middleware/auth.js")

let server
let base
let ann
let thread
let answerId

before(async () => {
  await mongoose.connect(mongo.uri)
  ann = await User.create({ name: "Ann", email: "ann@t.test", passwordHash: "x", role: "admin" })
  thread = await AgentThread.create({ userId: ann._id, title: "Closings", messages: [{ role: "user", content: "What closes this week?" }, { role: "assistant", content: "Two houses close this week." }] })
  answerId = String(thread.messages[1]._id)
  const app = express()
  app.use(express.json())
  app.use("/auth", authRouter)
  app.use("/agent", async (req, res, next) => {
    req.user = await User.findById(ann._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  }, agentRouter)
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.close()
  await mongoose.disconnect()
  await mongo.stop()
})

async function send(path, { method = "GET", body, token } = {}) {
  const headers = { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const rate = (body) => send(`/agent/threads/${thread._id}/messages/${answerId}`, { method: "PATCH", body })
const saved = async () => (await AgentThread.findById(thread._id)).messages.id(answerId)

test("a thumbs down keeps what was wrong and the note, and shows them with the chat", async () => {
  assert.equal((await rate({ feedback: "down" })).status, 200)
  const told = await rate({ feedback: "down", reasons: ["short", "wrong", "short"], note: "  It missed the second closing.  " })
  assert.equal(told.status, 200)
  assert.deepEqual(told.body, { feedback: "down", feedbackReasons: ["short", "wrong"], feedbackNote: "It missed the second closing." })
  const message = await saved()
  assert.deepEqual([...message.feedbackReasons], ["short", "wrong"])
  const read = await send(`/agent/threads/${thread._id}`)
  const answer = read.body.thread.messages.find((item) => item.id === answerId)
  assert.equal(answer.feedback, "down")
  assert.deepEqual(answer.feedbackReasons, ["short", "wrong"])
  assert.equal(answer.feedbackNote, "It missed the second closing.")
})

test("reasons that aren't on the list, reasons with a thumbs up, or a long note are refused", async () => {
  assert.equal((await rate({ feedback: "down", reasons: ["rude"] })).status, 400)
  assert.equal((await rate({ feedback: "down", reasons: "short" })).status, 400)
  assert.equal((await rate({ feedback: "up", reasons: ["short"] })).status, 400)
  assert.equal((await rate({ feedback: "down", note: "x".repeat(1001) })).status, 400)
  assert.deepEqual([...(await saved()).feedbackReasons], ["short", "wrong"])
})

test("changing or taking back the thumb clears what was said with the old one", async () => {
  const up = await rate({ feedback: "up" })
  assert.deepEqual(up.body, { feedback: "up", feedbackReasons: [], feedbackNote: "" })
  await rate({ feedback: "down", reasons: ["missed"] })
  const back = await rate({ feedback: "" })
  assert.deepEqual(back.body, { feedback: "", feedbackReasons: [], feedbackNote: "" })
})

test("the Agent's sounds are on unless turned off, and only On and Off are taken", async () => {
  assert.equal(DEFAULT_SOUNDS.agent, "on")
  assert.deepEqual(cleanSounds({ ringtone: "bells" }), { ringtone: "bells", chime: "chime", agent: "on" })
  assert.equal(cleanSounds({ agent: "loud" }).agent, "on")
  const token = signSession(ann)
  const off = await send("/auth/me/sounds", { method: "PATCH", body: { agent: "off" }, token })
  assert.equal(off.status, 200)
  assert.deepEqual(off.body.user.sounds, { ringtone: "marimba", chime: "chime", agent: "off" })
  assert.equal((await send("/auth/me/sounds", { method: "PATCH", body: { agent: "loud" }, token })).status, 400)
  // Changing another sound leaves the Agent's as it was.
  const bells = await send("/auth/me/sounds", { method: "PATCH", body: { ringtone: "bells" }, token })
  assert.equal(bells.body.user.sounds.agent, "off")
})
