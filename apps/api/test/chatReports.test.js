import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// Reported messages: admins see each report (even from a direct message they aren't in) and can remove the message or
// keep it; nobody else sees the list.
testEnv()
process.env.JWT_SECRET = "chat-reports-test"
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { ChatMessage, ChatReport, Notification, User } = await import("../src/models/index.js")
const { chatRouter } = await import("../src/routes/chat.js")

let server
let base
const people = {}

before(async () => {
  await mongoose.connect(mongo.uri)
  for (const [key, role] of [["ann", "admin"], ["mel", "member"], ["bo", "member"]]) {
    people[key] = await User.create({ name: key[0].toUpperCase() + key.slice(1), email: `${key}@t.test`, passwordHash: "x", role })
  }
  const app = express()
  app.use(express.json())
  app.use("/chat", async (req, res, next) => {
    req.user = await User.findById(people[req.headers["x-as"] || "ann"]._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  }, chatRouter)
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  server.close()
  await mongoose.disconnect()
  await mongo.stop()
})

const call = (as, method, path, body) => fetch(`${base}/chat${path}`, { method, headers: { "Content-Type": "application/json", "x-as": as }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (response) => ({ status: response.status, body: await response.json() }))

test("a report from a direct message the admin isn't in can be removed by the admin, for everyone", async () => {
  const dm = await call("mel", "POST", "/direct", { userIds: [String(people.bo._id)] })
  assert.equal(dm.status, 200)
  const channelId = dm.body.channel.id
  const sent = await call("mel", "POST", `/channels/${channelId}/messages`, { text: "Something nasty" })
  const messageId = sent.body.message.id
  // The admin can't open the conversation itself.
  assert.equal((await call("ann", "GET", `/channels/${channelId}/messages`)).status, 404)
  assert.equal((await call("bo", "POST", `/messages/${messageId}/report`, { reason: "Abusive" })).status, 201)
  const alert = await Notification.findOne({ userId: people.ann._id, event: "chat.reported" })
  assert.equal(alert.href, "/chat/reports")
  const boot = await call("ann", "GET", "/bootstrap")
  assert.equal(boot.body.reports, 1)
  assert.equal((await call("mel", "GET", "/bootstrap")).body.reports, undefined)

  const list = await call("ann", "GET", "/reports")
  assert.equal(list.status, 200)
  assert.equal(list.body.open, 1)
  const [report] = list.body.items
  assert.equal(report.text, "Something nasty")
  assert.equal(report.reason, "Abusive")
  assert.equal(report.authorName, "Mel")
  assert.equal(report.reporterName, "Bo")
  assert.match(report.where, /^Direct message: (Mel, Bo|Bo, Mel)$/)
  assert.equal(report.href, "")
  assert.equal(report.messageDeleted, false)

  assert.equal((await call("mel", "GET", "/reports")).status, 403)
  assert.equal((await call("mel", "POST", `/reports/${report.id}/remove`)).status, 403)
  const removed = await call("ann", "POST", `/reports/${report.id}/remove`)
  assert.equal(removed.status, 200)
  assert.ok((await ChatMessage.findById(messageId)).deletedAt)
  const after = (await call("ann", "GET", "/reports")).body
  assert.equal(after.open, 0)
  assert.equal(after.items[0].status, "Removed")
  assert.equal(after.items[0].resolvedByName, "Ann")
  assert.equal((await call("ann", "GET", "/bootstrap")).body.reports, 0)
})

test("Keep closes every open report of the same message and leaves the message", async () => {
  const dm = await call("bo", "POST", "/direct", { userIds: [String(people.mel._id), String(people.ann._id)] })
  const channelId = dm.body.channel.id
  const sent = await call("bo", "POST", `/channels/${channelId}/messages`, { text: "A borderline joke" })
  const messageId = sent.body.message.id
  await call("mel", "POST", `/messages/${messageId}/report`, {})
  const list = (await call("ann", "GET", "/reports")).body
  const report = list.items.find((item) => item.status === "Open")
  // The admin is in this conversation, so the report links to it.
  assert.match(report.href, new RegExp(`^/messages\\?c=${channelId}`))
  const kept = await call("ann", "POST", `/reports/${report.id}/dismiss`)
  assert.equal(kept.body.status, "Dismissed")
  assert.ok(!(await ChatMessage.findById(messageId)).deletedAt)
  assert.equal(await ChatReport.countDocuments({ messageId, status: "Open" }), 0)
  assert.equal((await call("ann", "POST", `/reports/${new mongoose.Types.ObjectId()}/dismiss`)).status, 404)
})
