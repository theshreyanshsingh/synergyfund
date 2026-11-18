import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// The Calls page: who joined each call and who was rung, and Favourites (kept per person, only conversations they see).
testEnv()
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { Call, ChatChannel, User } = await import("../src/models/index.js")
const { callsRouter } = await import("../src/routes/calls.js")

let server
let base
let mel
let ann
let bo
let direct
let hidden

before(async () => {
  await mongoose.connect(mongo.uri)
  ;[ann, mel, bo] = await User.create([
    { name: "Ann", email: "ann@t.test", passwordHash: "x", role: "admin" },
    { name: "Mel", email: "mel@t.test", passwordHash: "x", role: "member" },
    { name: "Bo", email: "bo@t.test", passwordHash: "x", role: "member" },
  ])
  direct = await ChatChannel.create({ kind: "direct", memberIds: [ann._id, mel._id], directKey: `${ann._id}:${mel._id}` })
  // A private channel Mel is not in.
  hidden = await ChatChannel.create({ kind: "channel", name: "board", private: true, memberIds: [ann._id, bo._id] })
  const app = express()
  app.use(express.json())
  app.use(async (req, res, next) => {
    req.user = await User.findById(mel._id)
    next()
  })
  app.use("/calls", callsRouter)
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

async function send(path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

test("each call says who joined (once each, in order), who was rung and who declined", async () => {
  const at = new Date(Date.now() - 600000)
  await Call.create({
    channelId: direct._id, media: "audio", startedBy: ann._id, startedByName: "Ann", invitedIds: [mel._id], declinedIds: [],
    participants: [
      { userId: ann._id, name: "Ann", joinedAt: at },
      { userId: mel._id, name: "Mel", joinedAt: at },
      { userId: ann._id, name: "Ann", joinedAt: new Date(at.getTime() + 60000) },
    ],
    status: "ended", outcome: "completed", startedAt: at, answeredAt: at, endedAt: new Date(at.getTime() + 120000),
  })
  const { status, body } = await send("/calls")
  assert.equal(status, 200)
  const call = body.items[0]
  assert.deepEqual(call.joinedPeople, [{ id: String(ann._id), name: "Ann" }, { id: String(mel._id), name: "Mel" }])
  assert.deepEqual(call.invitedIds, [String(mel._id)])
  assert.deepEqual(call.declinedIds, [])
  assert.equal(call.direction, "incoming")
  assert.equal(call.seconds, 120)
  assert.deepEqual(body.favorites, [])
})

test("favourites keep only conversations the person can see, once each, in order", async () => {
  const junk = String(new mongoose.Types.ObjectId())
  const saved = await send("/calls/favorites", { method: "PUT", body: { channelIds: [String(direct._id), String(hidden._id), String(direct._id), junk, "not-an-id"] } })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.favorites, [String(direct._id)])
  assert.deepEqual((await User.findById(mel._id)).callFavorites.map(String), [String(direct._id)])
  assert.deepEqual((await send("/calls")).body.favorites, [String(direct._id)])

  // A favourite that later goes out of sight (archived) is left out of the page.
  await ChatChannel.updateOne({ _id: direct._id }, { $set: { archivedAt: new Date() } })
  assert.deepEqual((await send("/calls")).body.favorites, [])
  await ChatChannel.updateOne({ _id: direct._id }, { $unset: { archivedAt: 1 } })

  assert.deepEqual((await send("/calls/favorites", { method: "PUT", body: { channelIds: [] } })).body.favorites, [])
})

test("favourites must be a list, and there are at most 30", async () => {
  assert.equal((await send("/calls/favorites", { method: "PUT", body: { channelIds: "x" } })).status, 400)
  assert.equal((await send("/calls/favorites", { method: "PUT", body: {} })).status, 400)
  const many = await ChatChannel.create(Array.from({ length: 31 }, (_, index) => ({ kind: "channel", name: `room-${index}` })))
  const tooMany = await send("/calls/favorites", { method: "PUT", body: { channelIds: many.map((channel) => String(channel._id)) } })
  assert.equal(tooMany.status, 400)
  assert.match(tooMany.body.error, /30/)
  const thirty = await send("/calls/favorites", { method: "PUT", body: { channelIds: many.slice(0, 30).map((channel) => String(channel._id)) } })
  assert.equal(thirty.status, 200)
  assert.equal(thirty.body.favorites.length, 30)
})
