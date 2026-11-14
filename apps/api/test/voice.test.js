import assert from "node:assert/strict"
import http from "node:http"
import { after, before, beforeEach, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// Talking with the Agent (src/services/agent/voice.js and src/routes/voice.js). The model service is faked: it
// answers the way OpenRouter was seen to answer the voice agent this was ported from (a streamed answer whose chunks
// carry `audio.transcript` and `audio.data`, a transcription as {text}, everything else in one piece).

// What the Agent writes for a question about the records, and what is said of it.
const WRITTEN = "You have **3 houses**.\n\n| Address | Status |\n|---|---|\n| 88 Demo Rd | Rehab |"
const SPOKEN = "You have three houses. The table is on your screen."

testEnv()
const mongo = await startMongo()
const model = await startFakeModelService()
Object.assign(process.env, { OPENROUTER_API_KEY: "test-key", OPENROUTER_BASE_URL: model.url, FIRECRAWL_API_KEY: "", JWT_SECRET: "test" })

const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { permissionsFor } = await import("@synergifund/shared")
const { AgentSetting, AgentThread, AiMonth, AiUsage } = await import("../src/models/index.js")
const voice = await import("../src/services/agent/voice.js")
const { voiceRouter } = await import("../src/routes/voice.js")
const { ABOUT_LINE, GREETING_LINE, HOLD_LINE, STILL_LINE, ON_SCREEN_LINE, FAILED_LINE, PATIENCE } = voice

const sam = { _id: new mongoose.Types.ObjectId(), name: "Sam Taylor", role: "admin" }
const SETTINGS = { voice: "cedar", accent: "australian" }
const TURN = voice.wavFile(Buffer.alloc(16000 * 2, 1), 16000) // one second

let server
let base

before(async () => {
  await mongoose.connect(mongo.uri)
  const app = express()
  app.use(express.json())
  // Signed in as whoever the test says (the real app's requireAuth does this from the session cookie).
  app.use((req, res, next) => {
    const role = req.headers["x-role"] || "admin"
    req.user = role === "admin" ? sam : { _id: new mongoose.Types.ObjectId(), name: "Roman Diaz", role }
    req.permissions = req.headers["x-no-agent"] ? [] : permissionsFor({ role })
    next()
  })
  app.use("/agent/voice", voiceRouter)
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.close()
  await mongoose.disconnect()
  await mongo.stop()
  await model.stop()
})

beforeEach(async () => {
  model.reset()
  voice.forgetRecordedLines()
  Object.assign(PATIENCE, { decision: 2000, heard: 3000, stillWorking: 14000, takeBack: 20 })
  await Promise.all([AgentThread.deleteMany({}), AgentSetting.deleteMany({}), AiUsage.deleteMany({}), AiMonth.deleteMany({})])
})

/* ---------- a stand-in for the model service ---------- */

function sse(delta, extra = {}) {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta }], ...extra })}\n\n`
}

// What the speech model was asked to say word for word, if this is such a request.
function lineAsked(body) {
  const last = body.messages[body.messages.length - 1].content
  if (typeof last !== "string") return null
  const match = /^\[Say exactly this to the caller, and nothing else: "(.*)"\]$/s.exec(last)
  return match ? match[1] : null
}

async function startFakeModelService() {
  const state = {}
  const reset = () => Object.assign(state, {
    requests: [], // { path, body }
    heard: "Hi there.",
    verdict: "NO",
    reply: "Hello! What can I do for you?",
    written: WRITTEN,
    spoken: SPOKEN,
    decideAfter: 0,
    heardAfter: 0,
    replyAfter: 0,
    planAfter: 0,
    speechFailures: [], // for the next spoken answers, in order: a status code, "early" or "cut"
    saysInstead: null, // (line) => what the model says when handed a line
    writerFails: false,
    planFails: false,
  })
  reset()
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const whole = (res, content) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }))
  }
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const path = new URL(req.url, "http://localhost").pathname
    if (path.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ data: [] }))
      return
    }
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
    state.requests.push({ path, body })
    if (req.headers.authorization !== "Bearer test-key") {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: { message: "No auth credentials found" } }))
      return
    }
    if (path.endsWith("/audio/transcriptions")) {
      await wait(state.heardAfter)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ text: state.heard, usage: { seconds: 1, cost: 0.0001 } }))
      return
    }
    const system = typeof body.messages[0].content === "string" ? body.messages[0].content : ""
    if (!body.stream) {
      if (body.modalities?.length === 1 && body.modalities[0] === "text") {
        await wait(state.decideAfter)
        return whole(res, state.verdict)
      }
      if (system.startsWith("You write what the SynergiFund Agent says aloud")) {
        if (state.writerFails) {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: { message: "writer down" } }))
          return
        }
        return whole(res, state.spoken)
      }
      if (system.startsWith("You keep the SynergiFund Agent's memory")) return whole(res, '{"add": [], "update": [], "remove": []}')
      if (system.includes("creates descriptive chat names")) return whole(res, "Counting the houses")
      // The Agent's plan step: answering without a tool call is its answer.
      await wait(state.planAfter)
      if (state.planFails) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: { message: "The model refused the request" } }))
        return
      }
      return whole(res, state.written)
    }
    // A spoken answer.
    const failure = state.speechFailures.shift()
    if (typeof failure === "number") {
      res.writeHead(failure, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: { message: failure === 401 ? "No auth credentials found" : "Provider returned error" } }))
      return
    }
    const line = lineAsked(body)
    const text = line == null ? state.reply : state.saysInstead ? state.saysInstead(line) : line
    if (line == null) await wait(state.replyAfter)
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    const words = text.split(" ")
    for (const [index, word] of words.entries()) res.write(sse({ audio: { transcript: word + (index < words.length - 1 ? " " : "") } }))
    if (failure === "early") {
      res.end('data: {"error": {"message": "Provider returned error", "code": 502}}\n\n')
      return
    }
    // Speech in pieces that split a sample in two, as the real service's can.
    res.write(sse({ audio: { data: Buffer.alloc(4801, 2).toString("base64") } }))
    if (failure === "cut") {
      res.end('data: {"error": {"message": "Provider returned error", "code": 502}}\n\n')
      return
    }
    res.write(sse({ audio: { data: Buffer.alloc(4799, 2).toString("base64") } }))
    res.write(sse({}, { usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.02 } }))
    res.end("data: [DONE]\n\n")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/api/v1`,
    state,
    reset,
    stop: () => new Promise((resolve) => server.close(resolve)),
    // What was asked of the speech model aloud, of the deciding model, and so on.
    spoken: () => state.requests.filter((request) => request.body.stream).map((request) => request.body),
    decisions: () => state.requests.filter((request) => !request.body.stream && request.body.modalities).map((request) => request.body),
    written: () => state.requests.filter((request) => request.path.endsWith("/chat/completions") && !request.body.stream && !request.body.modalities).map((request) => request.body),
  }
}

// Collects what a turn sends to the page.
function listener() {
  const events = []
  return {
    events,
    send: (event) => events.push(event),
    audio: (pcm) => events.push({ t: "audio", bytes: pcm.length }),
    kinds: () => events.map((event) => event.t),
    said: () => events.filter((event) => event.t === "say").map((event) => event.text).join(""),
    audioBytes: () => events.filter((event) => event.t === "audio").reduce((total, event) => total + event.bytes, 0),
    of: (kind) => events.filter((event) => event.t === kind),
  }
}

function newChat(messages = []) {
  return new AgentThread({ userId: sam._id, messages })
}

async function takeTurn(thread = newChat(), { signal } = {}) {
  const out = listener()
  await voice.voiceTurn({ user: sam, permissions: permissionsFor(sam), thread, wav: TURN, out, signal, temporaryFor: 60000 })
  return { out, thread: await AgentThread.findById(thread._id) }
}

/* ---------- the turn's audio ---------- */

test("a turn is read from a WAV file and passed on as a clean one", () => {
  // With a chunk before the sound, as some recorders write.
  const pcm = Buffer.alloc(8000 * 2, 3)
  const plain = voice.wavFile(pcm, 8000)
  const extra = Buffer.concat([plain.subarray(0, 12), Buffer.from("LIST"), Buffer.from([4, 0, 0, 0]), Buffer.from("abcd"), plain.subarray(12)])
  const turn = voice.readTurn(extra)
  assert.equal(turn.seconds, 1)
  assert.equal(turn.sampleRate, 8000)
  assert.deepEqual(turn.wav, plain)
})

test("a recording that is not a turn is refused in words for the person", () => {
  const stereo = voice.wavFile(Buffer.alloc(32000), 16000)
  stereo.writeUInt16LE(2, 22)
  const eightBit = voice.wavFile(Buffer.alloc(32000), 16000)
  eightBit.writeUInt16LE(8, 34)
  for (const bad of [undefined, Buffer.from("not a recording"), Buffer.alloc(100), stereo, eightBit, voice.wavFile(Buffer.alloc(32000), 96000)]) {
    assert.throws(() => voice.readTurn(bad), { message: "That recording could not be read. Try saying it again." })
  }
  assert.throws(() => voice.readTurn(voice.wavFile(Buffer.alloc(16000 * 2 * 0.05), 16000)), { message: "Nothing was heard. Try saying it again." })
  assert.throws(() => voice.readTurn(voice.wavFile(Buffer.alloc(16000 * 2 * 62), 16000)), { message: "Keep each turn under 60 seconds." })
  assert.equal(voice.readTurn(voice.wavFile(Buffer.alloc(16000 * 2 * 60), 16000)).seconds, 60)
})

/* ---------- what the models are told ---------- */

test("the speech model is told who it is, how it sounds and that it looks nothing up itself", () => {
  const told = voice.voiceInstructions({ settings: SETTINGS })
  const parts = told.split("\n\n")
  // The shape the accent was measured under: name, accent, how to speak, what it does not know, the date, look-ups.
  assert.equal(parts[0], "Your name is the SynergiFund Agent.")
  assert.equal(parts[1], voice.accentNote("australian"))
  assert.match(parts[1], /^You speak English with a clear, natural Australian accent, like someone who grew up there\./)
  assert.match(parts[2], /^You are a friendly and helpful voice assistant on a live call\./)
  assert.match(parts[3], /^Apart from anything said above, you know nothing about the company's houses, loans, payments, documents or people\./)
  assert.match(parts[4], /^Today's date is \w+ \d+ \w+ \d{4}\.$/)
  assert.match(parts[5], /^Questions that need the company's records or the internet are looked up by another part of the system/)
  assert.match(parts[5], /never say you are checking or searching for something, and never make up live or current information/)
  assert.equal(parts.length, 6)
  // Neither the person's name, the records, the team's notes nor the houses are put in front of it.
  assert.doesNotMatch(told, /Sam|Team knowledge|houses .* can see/)
})

test("a line to say comes under instructions that say nothing of looking things up", () => {
  const told = voice.lineInstructions(SETTINGS)
  assert.equal(told.split("\n\n").length, 3)
  assert.doesNotMatch(told, /looked up|looking something up/)
  assert.equal(voice.sayRequest("Hi."), '[Say exactly this to the caller, and nothing else: "Hi."]')
})

test("the accent is asked for in the instructions and again before the turn, or not at all", () => {
  assert.deepEqual(voice.accentReminder("british"), [{ role: "system", content: "(You are speaking in your British accent.)" }])
  for (const none of ["none", "martian", undefined]) {
    assert.equal(voice.accentNote(none), "")
    assert.deepEqual(voice.accentReminder(none), [])
  }
  assert.equal(voice.voiceInstructions({ settings: { voice: "cedar", accent: "none" } }).split("\n\n").length, 5)
})

test("the deciding model's reply is a request for the records, or nothing", () => {
  assert.deepEqual(voice.parseVerdict("ASK\nWho is the lender on 876 Fields Rd?"), { question: "Who is the lender on 876 Fields Rd?" })
  assert.deepEqual(voice.parseVerdict("ask\n<What do we owe Kiavi?>\n"), { question: "What do we owe Kiavi?" })
  assert.deepEqual(voice.parseVerdict("ASK\nList the houses\nin Jacksonville"), { question: "List the houses in Jacksonville" })
  for (const about of ["ABOUT", "about.", " ABOUT \n"]) assert.deepEqual(voice.parseVerdict(about), { about: true })
  for (const none of ["NO", "", null, "ASK", "SEARCH\nsomething", "Sure, here you go.", "ABOUT\nthe houses", "WAIT"]) assert.equal(voice.parseVerdict(none), null)
  const told = voice.routerInstructions({ user: sam })
  assert.match(told, /You never answer Sam yourself\./)
  assert.match(told, /^ASK$/m)
  assert.match(told, /^ABOUT$/m)
  assert.match(told, /with whatever "it", "they" or "that one" stands for written out/)
})

test("what is said of an answer is one plain line of a sayable length", () => {
  assert.equal(voice.spokenLine(' **About** "four hundred" thousand.\n\nIt is on the `screen`. '), "About four hundred thousand. It is on the screen.")
  const long = voice.spokenLine(`${"word ".repeat(150)}. Second sentence that runs past the end ${"x".repeat(200)}`)
  assert.ok(long.length <= 700)
  assert.equal(voice.spokenLine(null), "")
})

test("a line counts as said when its words are the same", () => {
  assert.equal(voice.sameWords("One moment — let me look that up!", HOLD_LINE), true)
  assert.equal(voice.sameWords("One moment, let me check that.", HOLD_LINE), false)
  assert.equal(voice.sameWords("", HOLD_LINE), false)
})

test("earlier turns go to the speech model as text, an answer by what was said aloud", () => {
  const thread = newChat([
    { role: "user", content: "How many houses do we have?", voice: true },
    { role: "assistant", content: WRITTEN, spoken: SPOKEN, voice: true },
    { role: "user", content: "Typed: list the **loans** on [88 Demo Rd](/properties/1)" },
    { role: "assistant", content: "| Lender | Balance |\n|---|---|\n| Kiavi | $100,000 |\n\n```email\nTo: a@b.c\n```" },
    { role: "assistant", content: "Error: the model failed", error: true },
    { role: "assistant", content: "" },
  ])
  assert.deepEqual(voice.historyFor(thread), [
    { role: "user", content: "How many houses do we have?" },
    { role: "assistant", content: SPOKEN },
    { role: "user", content: "Typed: list the loans on 88 Demo Rd" },
    { role: "assistant", content: "Lender Balance --- --- Kiavi $100,000" },
  ])
  const many = newChat(Array.from({ length: 30 }, (unused, index) => ({ role: "user", content: `Turn ${index}` })))
  assert.deepEqual(voice.historyFor(many).map((message) => message.content), Array.from({ length: 12 }, (unused, index) => `Turn ${index + 18}`))
  assert.deepEqual(voice.historyFor(null), [])
})

/* ---------- the speech model ---------- */

test("speech arrives in whole samples with its words, and is counted as voice spending", async () => {
  const pieces = []
  let words = ""
  const meter = { feature: "voice", userId: sam._id, cleared: false }
  const reply = await voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar", meter, onAudio: (pcm) => pieces.push(pcm.length), onText: (text) => { words += text } })
  assert.deepEqual(reply, { text: "Hello! What can I do for you?", spoke: true, problem: "" })
  assert.equal(words, reply.text)
  assert.deepEqual(pieces, [4800, 4800]) // 4801 + 4799 bytes came: the odd byte waited for its other half
  const [asked] = model.spoken()
  assert.deepEqual({ ...asked, messages: undefined }, { model: "openai/gpt-audio", stream: true, modalities: ["text", "audio"], audio: { voice: "cedar", format: "pcm16" }, usage: { include: true }, messages: undefined })
  const [usage] = await AiUsage.find().lean()
  assert.deepEqual([usage.feature, String(usage.userId), usage.model, usage.cost, usage.promptTokens], ["voice", String(sam._id), "openai/gpt-audio", 0.02, 100])
  assert.equal((await AiMonth.findOne().lean()).cost, 0.02)
})

for (const [failure, name] of [[503, "the provider refuses the request"], [500, "the service fails"], ["early", "the provider gives up as the answer starts"]]) {
  test(`speech is asked for once more when ${name}`, async () => {
    model.state.speechFailures = [failure]
    let words = ""
    const reply = await voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar", onText: (text) => { words += text } })
    assert.equal(reply.text, "Hello! What can I do for you?")
    // The words that came before the first try failed are not said twice.
    assert.equal(words, reply.text)
    const [first, second] = model.spoken()
    assert.deepEqual(first, second)
    assert.equal(model.spoken().length, 2)
  })
}

test("speech that fails twice, or in a way a second try cannot get past, is not asked for again", async () => {
  model.state.speechFailures = [503, 503]
  await assert.rejects(voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar" }), { message: "Provider returned error", notAnswered: true })
  assert.equal(model.spoken().length, 2)
  model.reset()
  model.state.speechFailures = [401]
  await assert.rejects(voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar" }), { message: "No auth credentials found" })
  assert.equal(model.spoken().length, 1)
  model.reset()
  model.state.speechFailures = [429]
  await assert.rejects(voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar" }), { notAnswered: true })
  assert.equal(model.spoken().length, 1)
})

test("speech cut off part-way stands as far as it got and is not said over again", async () => {
  model.state.speechFailures = ["cut"]
  const reply = await voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar" })
  assert.deepEqual([reply.spoke, reply.problem, reply.text], [true, "Provider returned error", "Hello! What can I do for you?"])
  assert.equal(model.spoken().length, 1)
})

test("speech stops being made when the person stops listening", async () => {
  model.state.replyAfter = 300
  const gone = new AbortController()
  const speaking = voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar", signal: gone.signal })
  setTimeout(() => gone.abort(), 50)
  await assert.rejects(speaking, { name: "AbortError" })
  assert.equal(model.spoken().length, 1) // and it is not asked for again
})

test("a spent budget stops speech before it is asked for", async () => {
  await AgentSetting.create({ key: "org", monthlyLimit: 5 })
  const { teamMonth } = await import("../src/services/agent/llm.js")
  await AiMonth.create({ month: teamMonth(), cost: 5 })
  await assert.rejects(voice.speak({ messages: [{ role: "user", content: "hello" }], voice: "cedar", meter: { feature: "voice", userId: sam._id, cleared: false } }), { budgetReached: true })
  assert.equal(model.state.requests.length, 0)
})

test("a line said while the Agent works is recorded once and kept", async () => {
  const first = await voice.recordedLine(HOLD_LINE, SETTINGS)
  const again = await voice.recordedLine(HOLD_LINE, SETTINGS)
  assert.equal(first.length, 9600)
  assert.equal(again, first)
  assert.equal(model.spoken().length, 1)
  const [asked] = model.spoken()
  assert.deepEqual(asked.messages, [
    { role: "system", content: voice.lineInstructions(SETTINGS) },
    { role: "system", content: "(You are speaking in your Australian accent.)" },
    { role: "user", content: voice.sayRequest(HOLD_LINE) },
  ])
  // Another voice is another recording.
  await voice.recordedLine(HOLD_LINE, { voice: "marin", accent: "indian" })
  assert.equal(model.spoken().length, 2)
})

test("a line the model will not say as written is asked for twice, then left to be said when needed", async () => {
  model.state.saysInstead = () => "I'm sorry, I can't look things up."
  assert.equal(await voice.recordedLine(HOLD_LINE, SETTINGS), null)
  assert.equal(model.spoken().length, 2)
  // Nothing wrong was kept: the next turn asks afresh.
  model.state.saysInstead = null
  assert.equal((await voice.recordedLine(HOLD_LINE, SETTINGS)).length, 9600)
})

/* ---------- a turn the Agent answers by itself ---------- */

test("small talk is answered aloud in one go and kept in the chat", async () => {
  const { out, thread } = await takeTurn()
  assert.deepEqual([...new Set(out.kinds())].sort(), ["audio", "done", "heard", "route", "say", "thread"])
  assert.deepEqual(out.of("route"), [{ t: "route", ask: false }])
  assert.deepEqual(out.of("heard"), [{ t: "heard", text: "Hi there." }])
  assert.equal(out.said(), "Hello! What can I do for you?")
  assert.equal(out.audioBytes(), 9600)
  assert.deepEqual(out.events[out.events.length - 1], { t: "done", threadId: String(thread._id), asked: false, spoken: "Hello! What can I do for you?" })
  assert.deepEqual(out.of("thread"), [{ t: "thread", id: String(thread._id) }])
  // Nothing reached the page before it was known that the reply was wanted.
  assert.ok(out.kinds().indexOf("route") < out.kinds().indexOf("audio"))

  assert.deepEqual(thread.messages.map((message) => [message.role, message.content, message.voice, message.spoken]), [
    ["user", "Hi there.", true, undefined],
    ["assistant", "Hello! What can I do for you?", true, "Hello! What can I do for you?"],
  ])
  assert.equal(thread.title, "Hi there.")

  // One request heard the turn and answered it: the instructions, the reminder, then the audio.
  const [reply] = model.spoken()
  assert.deepEqual(reply.messages.slice(0, -1), [
    { role: "system", content: voice.voiceInstructions({ settings: SETTINGS }) },
    { role: "system", content: "(You are speaking in your Australian accent.)" },
  ])
  const heardAs = reply.messages[reply.messages.length - 1]
  assert.equal(heardAs.role, "user")
  assert.deepEqual(heardAs.content, [{ type: "input_audio", input_audio: { data: TURN.toString("base64"), format: "wav" } }])
  // The deciding request heard the same audio, asked for text only, with instructions of its own.
  const [decision] = model.decisions()
  assert.deepEqual([decision.model, decision.modalities, decision.temperature], ["openai/gpt-audio", ["text"], 0])
  assert.deepEqual(decision.messages, [{ role: "system", content: voice.routerInstructions({ user: sam }) }, heardAs])
  // The transcriber took several languages.
  const transcription = model.state.requests.find((request) => request.path.endsWith("/audio/transcriptions")).body
  assert.deepEqual([transcription.model, transcription.language, transcription.input_audio.format], ["deepgram/nova-3", "multi", "wav"])
  // The records Agent was never asked, and everything was counted as voice.
  assert.deepEqual(model.written(), [])
  assert.deepEqual([...new Set((await AiUsage.find().lean()).map((usage) => usage.feature))], ["voice"])
})

test("a later turn is answered knowing the chat so far", async () => {
  const thread = newChat([{ role: "user", content: "How many houses?", voice: true }, { role: "assistant", content: WRITTEN, spoken: SPOKEN, voice: true }])
  await thread.save()
  await takeTurn(thread)
  const [reply] = model.spoken()
  assert.deepEqual(reply.messages.slice(1, 4), [
    { role: "user", content: "How many houses?" },
    { role: "assistant", content: SPOKEN },
    { role: "system", content: "(You are speaking in your Australian accent.)" },
  ])
  assert.deepEqual(model.decisions()[0].messages.slice(1, 3), reply.messages.slice(1, 3))
  // The written answer, with its table, never went to the speech model.
  assert.doesNotMatch(JSON.stringify(model.spoken()), /88 Demo Rd/)
})

test("an exchange in which nothing was made out is not kept", async () => {
  model.state.heard = ""
  const thread = newChat()
  const out = listener()
  await voice.voiceTurn({ user: sam, permissions: permissionsFor(sam), thread, wav: TURN, out, temporaryFor: 60000 })
  assert.equal(await AgentThread.countDocuments(), 0)
  assert.deepEqual(out.of("thread"), [])
  assert.deepEqual(out.events[out.events.length - 1], { t: "done", threadId: "", asked: false, spoken: "Hello! What can I do for you?" })
})

test("what the Agent can do is said as a line of its own, not in the speech model's words", async () => {
  Object.assign(model.state, { verdict: "ABOUT", heard: "What can you help me with?" })
  const { out, thread } = await takeTurn()
  assert.equal(out.said(), ABOUT_LINE)
  assert.deepEqual(out.of("route"), [{ t: "route", ask: false }])
  assert.deepEqual(out.events[out.events.length - 1], { t: "done", threadId: String(thread._id), asked: false, spoken: ABOUT_LINE })
  assert.deepEqual(thread.messages.map((message) => [message.role, message.content, message.voice]), [["user", "What can you help me with?", true], ["assistant", ABOUT_LINE, true]])
  // The line was handed to the speech model to say (and is kept for the next time); the records Agent was not asked.
  assert.deepEqual(model.spoken().filter((body) => lineAsked(body) != null).map(lineAsked), [ABOUT_LINE])
  assert.deepEqual(model.written(), [])
  await takeTurn()
  assert.equal(model.spoken().filter((body) => lineAsked(body) === ABOUT_LINE).length, 1)
})

test("a reply does not wait long for a slow decision", async () => {
  Object.assign(PATIENCE, { decision: 60 })
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?", decideAfter: 500 })
  const { out } = await takeTurn()
  assert.deepEqual(out.of("route"), [{ t: "route", ask: false }])
  assert.equal(out.said(), "Hello! What can I do for you?")
  assert.deepEqual(model.written(), [])
})

/* ---------- a turn that goes to the records ---------- */

test("a question for the records is asked of the Agent, and its answer is said in short", async () => {
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?", heard: "how many houses we have" })
  const { out, thread } = await takeTurn()

  // The person hears the hold line at once, then what the writer made of the written answer.
  assert.deepEqual(out.of("route"), [{ t: "route", ask: true, question: "How many houses do we have?" }])
  assert.equal(out.said(), `${HOLD_LINE} ${SPOKEN}`)
  // The page is told the written answer is in the chat once the Agent is done, before it is said in short.
  const saved = out.kinds().indexOf("saved")
  assert.equal(out.of("saved").length, 1)
  assert.ok(saved > out.kinds().lastIndexOf("status"))
  assert.equal(out.events.slice(saved).filter((event) => event.t === "say").map((event) => event.text).join("").trim(), SPOKEN)
  assert.equal(out.audioBytes(), 9600 * 2)
  assert.ok(out.of("status").some((event) => event.title === "Understanding the question"))
  assert.deepEqual(out.events[out.events.length - 1], { t: "done", threadId: String(thread._id), asked: true, spoken: SPOKEN })
  assert.ok(out.kinds().indexOf("thread") < out.kinds().indexOf("status"))

  // The chat holds the question as the deciding model heard it and the Agent's whole written answer.
  const [question, answer] = thread.messages
  assert.deepEqual([question.role, question.content, question.voice], ["user", "How many houses do we have?", true])
  assert.deepEqual([answer.role, answer.content, answer.spoken, answer.voice, answer.error], ["assistant", WRITTEN, SPOKEN, true, false])
  assert.equal(thread.messages.length, 2)
  assert.equal(thread.title, "Counting the houses") // named by the Agent, as a typed chat is

  // The Agent's own steps ran as for a typed question (its plan step answered).
  const plan = model.written().find((body) => body.messages[0].content.startsWith("You are the SynergiFund agent"))
  assert.deepEqual(plan.messages[plan.messages.length - 1], { role: "user", content: "How many houses do we have?" })
  // The writer was shown the question and the written answer.
  const writer = model.written().find((body) => body.messages[0].content.startsWith("You write what the SynergiFund Agent says aloud"))
  assert.deepEqual([writer.model, writer.reasoning], ["anthropic/claude-haiku-5.5", { enabled: false }])
  assert.equal(writer.messages[1].content, `What Sam asked:\nHow many houses do we have?\n\nThe written answer on their screen:\n${WRITTEN}`)

  // The speech model was handed lines to say and nothing else: never the written answer or a tool.
  const lines = model.spoken().filter((body) => lineAsked(body) != null)
  assert.deepEqual(lines.map(lineAsked), [HOLD_LINE, SPOKEN])
  const saying = lines[1]
  assert.deepEqual(saying.messages, [
    { role: "system", content: voice.lineInstructions(SETTINGS) },
    { role: "user", content: "How many houses do we have?" },
    { role: "assistant", content: HOLD_LINE },
    { role: "system", content: "(You are speaking in your Australian accent.)" },
    { role: "user", content: voice.sayRequest(SPOKEN) },
  ])
  for (const body of model.spoken()) {
    assert.equal(body.tools, undefined)
    assert.doesNotMatch(JSON.stringify(body), /88 Demo Rd/)
  }
  // Its own reply to the turn was dropped, never played.
  assert.doesNotMatch(out.said(), /What can I do for you/)
  // The Agent's work is counted as the Agent's, the speaking as voice.
  const features = new Set((await AiUsage.find().lean()).map((usage) => usage.feature))
  assert.ok(features.has("agent") && features.has("voice"))
})

test("a long look-up is said to be still going, once", async () => {
  Object.assign(PATIENCE, { stillWorking: 80 })
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?", planAfter: 400 })
  const { out } = await takeTurn()
  assert.equal(out.said(), `${HOLD_LINE} ${STILL_LINE} ${SPOKEN}`)
  // The answer is asked for as if both lines had been said.
  const saying = model.spoken().find((body) => lineAsked(body) === SPOKEN)
  assert.deepEqual(saying.messages[2], { role: "assistant", content: `${HOLD_LINE} ${STILL_LINE}` })
})

test("when the short answer cannot be written, the person is pointed to the screen", async () => {
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?", writerFails: true })
  const { out, thread } = await takeTurn()
  assert.equal(out.said(), `${HOLD_LINE} ${ON_SCREEN_LINE}`)
  assert.equal(thread.messages[1].content, WRITTEN)
  assert.equal(thread.messages[1].spoken, ON_SCREEN_LINE)
})

test("an answer the Agent could not finish is said to have failed", async () => {
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?", planFails: true })
  const { out, thread } = await takeTurn()
  assert.equal(out.said(), `${HOLD_LINE} ${FAILED_LINE}`)
  const answer = thread.messages[1]
  assert.deepEqual([answer.role, answer.error, answer.spoken], ["assistant", true, undefined])
  // No short version is written of an answer that is not there.
  assert.equal(model.written().filter((body) => body.messages[0].content.startsWith("You write what the SynergiFund Agent says aloud")).length, 0)
  assert.equal(out.events[out.events.length - 1].asked, true)
})

test("a person who leaves while the Agent works still gets the answer in the chat, unspoken", async () => {
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?", planAfter: 200 })
  const gone = new AbortController()
  setTimeout(() => gone.abort(), 80)
  const { out, thread } = await takeTurn(newChat(), { signal: gone.signal })
  assert.equal(thread.messages[1].content, WRITTEN)
  assert.equal(thread.messages[1].spoken, undefined)
  assert.doesNotMatch(out.said(), /three houses/)
  assert.equal(model.spoken().filter((body) => lineAsked(body) === SPOKEN).length, 0)
  // Nor is a short version written for nobody to hear.
  assert.equal(model.written().filter((body) => body.messages[0].content.startsWith("You write what the SynergiFund Agent says aloud")).length, 0)
})

test("a turn taken back before the Agent has decided leaves nothing behind", async () => {
  // The person went on talking (or pressed Stop) while the turn was still being decided.
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?", decideAfter: 150 })
  const gone = new AbortController()
  setTimeout(() => gone.abort(), 40)
  const { out, thread } = await takeTurn(newChat(), { signal: gone.signal })
  assert.equal(thread, null)
  assert.equal(await AgentThread.countDocuments(), 0)
  assert.deepEqual(out.of("route"), [])
  assert.equal(out.audioBytes(), 0)
  // Nothing was looked up, and nothing was handed to the speech model to say.
  assert.equal(model.written().filter((body) => body.messages[0].content.startsWith("You are the SynergiFund agent")).length, 0)
  assert.equal(model.spoken().filter((body) => lineAsked(body) != null).length, 0)
})

test("a turn taken back just as the Agent starts on it is not kept or looked up", async () => {
  // The page's word that the person went on talking crossed with the hand-over to the records Agent.
  PATIENCE.takeBack = 150
  Object.assign(model.state, { verdict: "ASK\nHow many houses do we have?" })
  const gone = new AbortController()
  setTimeout(() => gone.abort(), 60)
  const { out, thread } = await takeTurn(newChat(), { signal: gone.signal })
  assert.deepEqual(out.of("route"), [{ t: "route", ask: true, question: "How many houses do we have?" }])
  assert.equal(thread, null)
  assert.deepEqual(out.of("thread"), [])
  assert.deepEqual(out.of("saved"), [])
  assert.equal(model.written().filter((body) => body.messages[0].content.startsWith("You are the SynergiFund agent")).length, 0)

  // Still there once that moment has passed: the question is the Agent's, and the chat is named to the page then.
  const stayed = await takeTurn()
  assert.equal(stayed.thread.messages[1].content, WRITTEN)
  assert.ok(stayed.out.kinds().indexOf("route") < stayed.out.kinds().indexOf("thread"))
})

test("a turn the Agent answers by itself, taken back just as it starts, is not kept either", async () => {
  // The words were written down and the answer was on its way before the page's word arrived.
  for (const [verdict, said] of [["ABOUT", ABOUT_LINE], ["NO", "Hello! What can I do for you?"]]) {
    PATIENCE.takeBack = 150
    Object.assign(model.state, { verdict, heard: "what can you" })
    const gone = new AbortController()
    setTimeout(() => gone.abort(), 70)
    const { out, thread } = await takeTurn(newChat(), { signal: gone.signal })
    assert.deepEqual(out.of("route"), [{ t: "route", ask: false }])
    assert.equal(out.said(), said)
    assert.equal(thread, null)
    assert.equal(await AgentThread.countDocuments(), 0)
  }
})

/* ---------- the routes ---------- */

function form(fields = {}, audio = TURN) {
  const body = new FormData()
  if (audio) body.set("audio", new Blob([audio], { type: "audio/wav" }), "turn.wav")
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  return body
}

async function eventsOf(response) {
  const text = await response.text()
  return text.split("\n\n").filter((block) => block.startsWith("data: ")).map((block) => JSON.parse(block.slice(6)))
}

test("the page is told the voice in use, and only an admin changes it", async () => {
  const asAdmin = await (await fetch(`${base}/agent/voice`)).json()
  assert.deepEqual([asAdmin.available, asAdmin.voice, asAdmin.accent, asAdmin.canEdit], [true, "cedar", "australian", true])
  assert.equal(asAdmin.voices.cedar, "Cedar (male)")
  assert.equal(asAdmin.accents.none, "The voice's own")
  const patch = (body, headers = {}) => fetch(`${base}/agent/voice`, { method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })

  const changed = await (await patch({ voice: "marin", accent: "british" })).json()
  assert.deepEqual([changed.voice, changed.accent], ["marin", "british"])
  assert.deepEqual(await voice.voiceSettings(), { voice: "marin", accent: "british" })
  // One at a time, and nothing that is not on the lists.
  assert.deepEqual((await (await patch({ accent: "none" })).json()).voice, "marin")
  for (const bad of [{ voice: "robot" }, { accent: "martian" }]) assert.equal((await patch(bad)).status, 400)
  assert.deepEqual(await voice.voiceSettings(), { voice: "marin", accent: "none" })

  const asMember = await fetch(`${base}/agent/voice`, { headers: { "x-role": "member" } })
  assert.equal((await asMember.json()).canEdit, false)
  const refused = await patch({ voice: "cedar" }, { "x-role": "member" })
  assert.deepEqual([refused.status, (await refused.json()).error], [403, "Only an admin can change the Agent's voice."])
  // Without the right to ask the Agent there is no talking to it either.
  assert.equal((await fetch(`${base}/agent/voice`, { headers: { "x-no-agent": "1" } })).status, 403)

  // An admin can turn talking with the Agent off for everyone, and on again; the voice and accent are kept.
  assert.deepEqual([asAdmin.on, asAdmin.connected], [true, true])
  const off = await (await patch({ on: false })).json()
  assert.deepEqual([off.available, off.on, off.connected, off.voice, off.accent], [false, false, true, "marin", "none"])
  assert.equal((await (await fetch(`${base}/agent/voice`, { headers: { "x-role": "member" } })).json()).available, false)
  for (const [path, body] of [["greet", undefined], ["turn", form()]]) {
    const response = await fetch(`${base}/agent/voice/${path}`, { method: "POST", body })
    assert.deepEqual([response.status, (await response.json()).error], [403, "Talking with the Agent is turned off."])
  }
  assert.equal(model.state.requests.length, 0)
  assert.equal(await AgentThread.countDocuments(), 0)
  assert.equal((await patch({ on: "no" })).status, 400)
  assert.equal((await patch({ on: false }, { "x-role": "member" })).status, 403)
  const on = await (await patch({ on: true })).json()
  assert.deepEqual([on.available, on.on], [true, true])
  const hello = await fetch(`${base}/agent/voice/greet`, { method: "POST" })
  assert.equal(hello.status, 200)
  await hello.text()
  assert.equal((await fetch(`${base}/agent/voice/turn`, { method: "POST", headers: { "x-no-agent": "1" }, body: form() })).status, 403)
})

test("starting to talk is answered with a spoken hello, recorded once for everyone", async () => {
  const hello = () => fetch(`${base}/agent/voice/greet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  const response = await hello()
  assert.equal(response.headers.get("content-type"), "text/event-stream")
  const events = await eventsOf(response)
  assert.equal(events.filter((event) => event.t === "say").map((event) => event.text).join(""), "Hi, how can I help you today?")
  const audio = events.filter((event) => event.t === "audio")
  assert.equal(audio.reduce((total, event) => total + Buffer.from(event.d, "base64").length, 0), 9600)
  assert.deepEqual(events[events.length - 1], { t: "done", threadId: "", asked: false, spoken: GREETING_LINE })
  // It is a line the speech model was handed to say, under the instructions for lines.
  assert.deepEqual(model.spoken()[0].messages, [
    { role: "system", content: voice.lineInstructions(SETTINGS) },
    { role: "system", content: "(You are speaking in your Australian accent.)" },
    { role: "user", content: voice.sayRequest(GREETING_LINE) },
  ])
  assert.deepEqual(await eventsOf(await hello()), events)
  assert.equal(model.spoken().length, 1)
  assert.equal(await AgentThread.countDocuments(), 0)
})

test("a hello that could not be recorded is said on the spot", async () => {
  model.state.saysInstead = (line) => (model.spoken().length <= 2 ? "Hello hello." : line)
  const events = await eventsOf(await fetch(`${base}/agent/voice/greet`, { method: "POST" }))
  // Twice it said something else, so nothing was kept; asked once more, it said the line.
  assert.equal(model.spoken().length, 3)
  assert.deepEqual(events[events.length - 1], { t: "done", threadId: "", asked: false, spoken: GREETING_LINE })
})

test("a spoken turn is taken as a recording and answered as a stream of events", async () => {
  const response = await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form() })
  assert.equal(response.status, 200)
  const events = await eventsOf(response)
  assert.deepEqual([...new Set(events.map((event) => event.t))].sort(), ["audio", "done", "heard", "route", "say", "thread"])
  const [thread] = await AgentThread.find()
  assert.equal(events[events.length - 1].threadId, String(thread._id))
  assert.equal(String(thread.userId), String(sam._id))
  // Speech reaches the page in pieces of at most half a second, each of whole samples.
  for (const event of events.filter((item) => item.t === "audio")) {
    const bytes = Buffer.from(event.d, "base64").length
    assert.ok(bytes <= 24000 && bytes % 2 === 0)
  }

  // The next turn of the same conversation goes into the same chat.
  const next = await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form({ threadId: String(thread._id) }) })
  assert.equal(next.headers.get("x-chat-id"), String(thread._id))
  await next.text()
  assert.equal((await AgentThread.findById(thread._id)).messages.length, 4)
  assert.equal(await AgentThread.countDocuments(), 1)
})

test("a temporary chat stays temporary when it is spoken", async () => {
  await (await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form({ temporary: "true" }) })).text()
  const [thread] = await AgentThread.find()
  assert.equal(thread.temporary, true)
  assert.ok(thread.expiresAt > new Date(Date.now() + 23 * 3600 * 1000))
})

test("a turn that cannot be taken is refused before anything streams", async () => {
  const refused = async (response) => [response.status, (await response.json()).error]
  assert.deepEqual(await refused(await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form({}, null) })), [400, "That recording could not be read. Try saying it again."])
  assert.deepEqual(await refused(await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form({}, Buffer.from("not sound")) })), [400, "That recording could not be read. Try saying it again."])
  // Someone else's chat, or one that is not there.
  const theirs = await AgentThread.create({ userId: new mongoose.Types.ObjectId(), messages: [] })
  for (const id of [String(theirs._id), "nonsense", String(new mongoose.Types.ObjectId())]) {
    assert.deepEqual(await refused(await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form({ threadId: id }) })), [404, "That conversation was not found."])
  }
  // This month's budget is used up.
  const { teamMonth } = await import("../src/services/agent/llm.js")
  await AgentSetting.create({ key: "org", monthlyLimit: 5 })
  await AiMonth.create({ month: teamMonth(), cost: 5 })
  const spent = await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form() })
  assert.equal(spent.status, 402)
  assert.match((await spent.json()).error, /^This month's AI budget \(\$5\) is used up\./)
  assert.equal((await fetch(`${base}/agent/voice/greet`, { method: "POST" })).status, 402)
  assert.equal(model.state.requests.length, 0)
})

test("without a model key there is no voice, and the page is told so", async () => {
  const key = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = ""
  try {
    assert.equal((await (await fetch(`${base}/agent/voice`)).json()).available, false)
    const response = await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form() })
    assert.deepEqual([response.status, (await response.json()).error], [503, "The Agent is not connected to a model yet."])
  } finally {
    process.env.OPENROUTER_API_KEY = key
  }
})

test("a turn that fails part-way tells the page why and ends the stream", async () => {
  model.state.speechFailures = [401]
  const events = await eventsOf(await fetch(`${base}/agent/voice/turn`, { method: "POST", body: form() }))
  assert.deepEqual(events[events.length - 1], { t: "error", message: "The Agent could not speak: No auth credentials found" })
  assert.equal(await AgentThread.countDocuments(), 0)
})
