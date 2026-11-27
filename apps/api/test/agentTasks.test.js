import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// "Create a task" through the Agent: propose_task prepares a card (it saves nothing), and the person's Confirm creates
// the task with their own access, as the Tasks page does. People who can't create tasks don't get the tool.
testEnv()
process.env.JWT_SECRET = "agent-tasks-test"
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { AgentTaskDraft, Notification, Property, Task, User } = await import("../src/models/index.js")
const { agentRouter } = await import("../src/routes/agent.js")
const { tasksRouter } = await import("../src/routes/tasks.js")
const { clientResult, executeTool, toolsFor } = await import("../src/services/agent/tools.js")

let server
let base
const people = {}
let house

before(async () => {
  await mongoose.connect(mongo.uri)
  for (const [key, name, role] of [["ann", "Ann Admin", "admin"], ["mel", "Mel Jones", "member"], ["melody", "Melody Park", "member"], ["rae", "Rae Builder", "contractor"]]) {
    people[key] = await User.create({ name, email: `${key}@t.test`, passwordHash: "x", role, aiConsentAt: new Date() })
  }
  house = await Property.create({ address: "88 Demo Rd", city: "Jacksonville" })
  const app = express()
  app.use(express.json())
  const signedIn = async (req, res, next) => {
    req.user = await User.findById(people[req.headers["x-as"] || "ann"]._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  }
  app.use("/agent", signedIn, agentRouter)
  app.use("/tasks", signedIn, tasksRouter)
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

const contextFor = (user) => ({ user, permissions: permissionsFor(publicUser(user)), cache: {}, threadId: new mongoose.Types.ObjectId(), question: "" })
async function propose(user, args) {
  const context = contextFor(user)
  const tools = toolsFor(context)
  const call = { name: "propose_task", arguments: JSON.stringify(args) }
  const { result } = await executeTool(call, tools, context)
  return { result, shown: clientResult(tools.find((tool) => tool.name === "propose_task"), args, result) }
}
const post = (as, path) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-as": as }, body: "{}" }).then(async (response) => ({ status: response.status, body: await response.json() }))

test("only people who can create tasks get the tool", () => {
  assert.ok(toolsFor(contextFor(people.ann)).some((tool) => tool.name === "propose_task"))
  assert.ok(!toolsFor(contextFor(people.mel)).some((tool) => tool.name === "propose_task"))
  assert.ok(!toolsFor(contextFor(people.rae)).some((tool) => tool.name === "propose_task"))
})

test("the tool prepares a card with the property, person and date; nothing is created until Confirm", async () => {
  const { result, shown } = await propose(people.ann, { title: "Call the plumber about the leak", property: "88 demo", assignee: "Mel Jones", due: "2026-12-04", priority: "High" })
  assert.equal(result.success, true)
  assert.match(result.instructions, /Never say it was created/)
  const card = shown.task
  assert.equal(card.title, "Call the plumber about the leak")
  assert.equal(card.address, "88 Demo Rd")
  assert.equal(card.assigneeName, "Mel Jones")
  assert.equal(card.due, "2026-12-04")
  assert.equal(card.priority, "High")
  assert.equal(card.status, "pending")
  assert.equal(await Task.countDocuments(), 0)

  // Another person can't confirm Ann's card.
  assert.equal((await post("mel", `/agent/tasks/${card.id}/confirm`)).status, 403)
  const confirmed = await post("ann", `/agent/tasks/${card.id}/confirm`)
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.task.status, "saved")
  const task = await Task.findById(confirmed.body.task.taskId)
  assert.equal(task.title, "Call the plumber about the leak")
  assert.equal(String(task.propertyId), String(house._id))
  assert.equal(String(task.assigneeId), String(people.mel._id))
  assert.equal(task.due, "2026-12-04")
  assert.equal(task.priority, "High")
  // The person it's for is told, as from the Tasks page.
  assert.ok(await Notification.findOne({ userId: people.mel._id, event: "task.assigned" }))
  // Once only.
  assert.equal((await post("ann", `/agent/tasks/${card.id}/confirm`)).status, 409)
  assert.equal(await Task.countDocuments(), 1)
})

test("two taps at once add one task; Cancel drops a card", async () => {
  const { shown } = await propose(people.ann, { title: "Order the dumpster" })
  const both = await Promise.all([1, 2].map(() => post("ann", `/agent/tasks/${shown.task.id}/confirm`)))
  assert.deepEqual(both.map((item) => item.status).sort(), [200, 409])
  assert.equal(await Task.countDocuments({ title: "Order the dumpster" }), 1)
  const other = await propose(people.ann, { title: "Book the inspector" })
  const cancelled = await post("ann", `/agent/tasks/${other.shown.task.id}/cancel`)
  assert.equal(cancelled.body.task.status, "cancelled")
  assert.equal((await post("ann", `/agent/tasks/${other.shown.task.id}/confirm`)).status, 409)
  assert.equal(await Task.countDocuments({ title: "Book the inspector" }), 0)
})

test("unclear names, unknown houses and bad dates come back to the model to sort out", async () => {
  const twoMels = await propose(people.ann, { title: "Walk the house", assignee: "Mel" })
  assert.equal(twoMels.result.success, false)
  assert.match(twoMels.result.error, /matches 2 people/)
  const nobody = await propose(people.ann, { title: "Walk the house", assignee: "Zed" })
  assert.match(nobody.result.error, /Nobody on the team/)
  const nowhere = await propose(people.ann, { title: "Walk the house", property: "999 Nowhere Ln" })
  assert.equal(nowhere.result.success, false)
  const badDay = await propose(people.ann, { title: "Walk the house", due: "next Friday" })
  assert.match(badDay.result.error, /YYYY-MM-DD/)
  assert.equal(await AgentTaskDraft.countDocuments({ title: "Walk the house" }), 0)
})

test("the Tasks page still creates tasks the same way", async () => {
  const response = await fetch(`${base}/tasks`, { method: "POST", headers: { "Content-Type": "application/json", "x-as": "ann" }, body: JSON.stringify({ title: "From the Tasks page", due: "2026-02-31" }) })
  assert.equal(response.status, 400)
  const made = await fetch(`${base}/tasks`, { method: "POST", headers: { "Content-Type": "application/json", "x-as": "ann" }, body: JSON.stringify({ title: "From the Tasks page", assigneeId: String(people.rae._id), propertyId: String(house._id) }) })
  assert.equal(made.status, 201)
  assert.equal((await made.json()).task.title, "From the Tasks page")
  const refused = await fetch(`${base}/tasks`, { method: "POST", headers: { "Content-Type": "application/json", "x-as": "mel" }, body: JSON.stringify({ title: "Not allowed" }) })
  assert.equal(refused.status, 403)
})
