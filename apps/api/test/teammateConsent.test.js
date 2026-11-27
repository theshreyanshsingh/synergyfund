import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// The AI teammate sends the AI model only what people who agreed to the AI notice wrote or shared. Someone who hasn't
// agreed and asks it something is told how to agree, and nothing is sent.
testEnv()
process.env.JWT_SECRET = "teammate-consent-test"
process.env.OPENROUTER_API_KEY = "test-not-a-key"
const sent = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (String(url).includes("/chat/completions")) {
    sent.push(JSON.parse(options.body))
    const content = JSON.stringify({ lineItems: [], draw: { needed: false }, message: "", memory: "" })
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  return realFetch(url, options)
}
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { AgentSetting, ChatChannel, ChatMessage, PhotoSet, Property, User } = await import("../src/models/index.js")
const { reviewProperty, teammateSettings, ensureTeammate } = await import("../src/services/siteAgent.js")

let house
let channel
const people = {}

before(async () => {
  await mongoose.connect(mongo.uri)
  await AgentSetting.create({ key: "org", teammateOn: true })
  people.ann = await User.create({ name: "Ann Admin", email: "ann@t.test", passwordHash: "x", role: "admin", aiConsentAt: new Date() })
  people.rae = await User.create({ name: "Rae Builder", email: "rae@t.test", passwordHash: "x", role: "contractor" })
  people.cy = await User.create({ name: "Cy Tiler", email: "cy@t.test", passwordHash: "x", role: "contractor", aiConsentAt: new Date() })
  house = await Property.create({ address: "88 Demo Rd", assignedUserIds: [people.rae._id, people.cy._id], scopeLines: [{ title: "Tile", budget: 1000 }] })
  channel = await ChatChannel.create({ kind: "property", name: "88 Demo Rd", propertyId: house._id, createdBy: people.ann._id })
  const at = (minutes) => new Date(Date.now() - minutes * 60000)
  await ChatMessage.create([
    { channelId: channel._id, userId: people.ann._id, userName: "Ann Admin", text: "How is the tile going?", createdAt: at(30) },
    { channelId: channel._id, userId: people.rae._id, userName: "Rae Builder", text: "Rae's private words about the tile", createdAt: at(20) },
    { channelId: channel._id, userId: people.cy._id, userName: "Cy Tiler", text: "Cy says the bathroom tile is half done", createdAt: at(10) },
  ])
  await PhotoSet.create([
    { propertyId: house._id, weekOf: "2026-11-23", fileIds: [], uploadedBy: people.rae._id, note: "Rae's photo note" },
    { propertyId: house._id, weekOf: "2026-11-23", fileIds: [], uploadedBy: people.cy._id, note: "Cy's photo note" },
  ])
})

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  globalThis.fetch = realFetch
  await mongoose.disconnect()
  await mongo.stop()
})

const sentText = (request) => JSON.stringify(request.messages)

test("a review sends what people who agreed said and shared, and leaves out the rest", async () => {
  const result = await reviewProperty(String(house._id), { force: true })
  assert.notEqual(result.skipped, "off")
  assert.equal(sent.length, 1)
  const text = sentText(sent[0])
  assert.match(text, /How is the tile going\?/)
  assert.match(text, /Cy says the bathroom tile is half done/)
  assert.match(text, /Cy's photo note/)
  assert.doesNotMatch(text, /Rae's private words/)
  assert.doesNotMatch(text, /Rae's photo note/)
})

test("asked by someone who hasn't agreed, the teammate says how to agree and sends nothing", async () => {
  const settings = await teammateSettings({ fresh: true })
  const bot = await ensureTeammate(settings)
  const before = sent.length
  await ChatMessage.create({ channelId: channel._id, userId: people.rae._id, userName: "Rae Builder", text: `<@${bot._id}> is the tile order in?`, mentionIds: [bot._id] })
  const result = await reviewProperty(String(house._id), { reply: true })
  assert.equal(result.skipped, "not agreed")
  assert.equal(sent.length, before)
  const answer = await ChatMessage.findOne({ channelId: channel._id, userId: bot._id }).sort({ createdAt: -1 })
  assert.match(answer.text, new RegExp(`^<@${people.rae._id}> I can't read your messages yet`))
  // Once Rae agrees, the next question goes through.
  await User.updateOne({ _id: people.rae._id }, { $set: { aiConsentAt: new Date() } })
  await ChatMessage.create({ channelId: channel._id, userId: people.rae._id, userName: "Rae Builder", text: `<@${bot._id}> is the tile order in now?`, mentionIds: [bot._id] })
  await reviewProperty(String(house._id), { reply: true, force: true })
  assert.equal(sent.length, before + 1)
  assert.match(sentText(sent.at(-1)), /is the tile order in now\?/)
})
