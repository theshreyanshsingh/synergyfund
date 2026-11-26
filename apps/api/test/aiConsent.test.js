import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// The AI notice: nobody's question, spoken turn or receipt goes to an outside AI model until they have agreed, once, for
// their account (Apple's rule on sharing personal data with a third-party AI).
testEnv()
process.env.JWT_SECRET = "ai-consent-test"
// A made-up key, so receipt reading counts as available; nothing here reaches OpenRouter.
process.env.OPENROUTER_API_KEY = "test-not-a-key"
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { Receipt, User } = await import("../src/models/index.js")
const { agentRouter } = await import("../src/routes/agent.js")
const { authRouter } = await import("../src/routes/auth.js")
const { callsRouter } = await import("../src/routes/calls.js")
const { receiptsRouter } = await import("../src/routes/receipts.js")
const { voiceRouter } = await import("../src/routes/voice.js")
const { signSession } = await import("../src/middleware/auth.js")

let server
let base
let rae

before(async () => {
  await mongoose.connect(mongo.uri)
  rae = await User.create({ name: "Rae", email: "rae@t.test", passwordHash: "x", role: "admin" })
  const app = express()
  app.use(express.json())
  app.use("/auth", authRouter)
  const signedIn = async (req, res, next) => {
    req.user = await User.findById(rae._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  }
  app.use("/agent/voice", signedIn, voiceRouter)
  app.use("/agent", signedIn, agentRouter)
  app.use("/receipts", signedIn, receiptsRouter)
  app.use("/calls", signedIn, callsRouter)
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

const token = () => signSession(rae)
const post = (path, body, auth = false) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token()}` } : {}) }, body: JSON.stringify(body ?? {}) })

test("before agreeing, the Agent, Talk, receipt reading and call notes refuse, and the account says it hasn't agreed", async () => {
  const run = await post("/agent/run", { prompt: "What's on my plate?" })
  assert.equal(run.status, 403)
  assert.match((await run.json()).error, /AI notice/)
  const talk = await post("/agent/voice/greet", {})
  assert.equal(talk.status, 403)
  assert.match((await talk.json()).error, /AI notice/)
  const draft = await Receipt.create({ createdBy: rae._id, boughtBy: rae._id })
  const read = await post(`/receipts/${draft._id}/read`, {})
  assert.equal(read.status, 403)
  assert.match((await read.json()).error, /AI notice/)
  assert.notEqual((await Receipt.findById(draft._id)).read?.status, "reading")
  // Their speech isn't sent for AI call notes either.
  const piece = new FormData()
  piece.append("audio", new Blob([Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(40)])], { type: "audio/wav" }), "piece.wav")
  const notes = await fetch(`${base}/calls/notes/${new mongoose.Types.ObjectId()}/audio`, { method: "POST", body: piece })
  assert.equal(notes.status, 403)
  assert.match((await notes.json()).error, /AI notice/)
  const me = await (await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token()}` } })).json()
  assert.equal(me.user.aiConsent, false)
})

test("agreeing needs an explicit yes, is kept on the account, and isn't moved by agreeing again", async () => {
  assert.equal((await post("/auth/me/ai-consent", {}, true)).status, 400)
  assert.equal((await post("/auth/me/ai-consent", { agree: "yes" }, true)).status, 400)
  const agreed = await post("/auth/me/ai-consent", { agree: true }, true)
  assert.equal(agreed.status, 200)
  assert.equal((await agreed.json()).user.aiConsent, true)
  const first = (await User.findById(rae._id)).aiConsentAt
  assert.ok(first)
  await post("/auth/me/ai-consent", { agree: true }, true)
  assert.equal((await User.findById(rae._id)).aiConsentAt.getTime(), first.getTime())
})

test("after agreeing, the Agent takes the question (it gets past the notice to its own checks)", async () => {
  const run = await post("/agent/run", {})
  assert.equal(run.status, 400)
  assert.match((await run.json()).error, /Ask a question/)
})
