import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// Deleting a house: only an admin can; one with money records needs its address typed; the activity log keeps its
// history.
testEnv()
process.env.JWT_SECRET = "property-delete-test"
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { Activity, Expense, Loan, Property, User } = await import("../src/models/index.js")
const { propertiesRouter } = await import("../src/routes/properties.js")

let server
let base
const people = {}

before(async () => {
  await mongoose.connect(mongo.uri)
  people.ann = await User.create({ name: "Ann", email: "ann@t.test", passwordHash: "x", role: "admin" })
  people.dev = await User.create({ name: "Dev", email: "dev@t.test", passwordHash: "x", role: "developer" })
  const app = express()
  app.use(express.json())
  app.use("/properties", async (req, res, next) => {
    req.user = await User.findById(people[req.headers["x-as"] || "ann"]._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  }, propertiesRouter)
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

const call = (as, method, path, body) => fetch(`${base}/properties${path}`, { method, headers: { "Content-Type": "application/json", "x-as": as }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (response) => ({ status: response.status, body: await response.json() }))

test("someone who can edit houses but isn't an admin can't delete one", async () => {
  assert.ok(permissionsFor({ role: "developer" }).includes("properties.write"))
  const house = await Property.create({ address: "1 Test St" })
  const refused = await call("dev", "DELETE", `/${house._id}`, {})
  assert.equal(refused.status, 403)
  assert.match(refused.body.error, /Exit or Complete/)
  assert.ok(await Property.findById(house._id))
  assert.equal((await call("dev", "GET", `/${house._id}/delete-check`)).body.canDelete, false)
})

test("a house with nothing on it is deleted straight away", async () => {
  const house = await Property.create({ address: "2 Empty Ln" })
  const check = await call("ann", "GET", `/${house._id}/delete-check`)
  assert.equal(check.body.money, false)
  assert.equal(check.body.canDelete, true)
  assert.equal((await call("ann", "DELETE", `/${house._id}`, {})).status, 200)
  assert.equal(await Property.findById(house._id), null)
})

test("a house with loans and costs needs its address typed; its history stays in the activity log", async () => {
  const house = await Property.create({ address: "88 Demo Rd." })
  await Loan.create({ propertyId: house._id, lender: "Kiavi", amount: 100000 })
  await Expense.create([{ propertyId: house._id, title: "Lumber", amount: 1200.5 }, { propertyId: house._id, title: "Paint", amount: 300 }])
  await Activity.create({ actorName: "Ann", title: "Cost added", detail: "Lumber", propertyId: house._id })
  const check = (await call("ann", "GET", `/${house._id}/delete-check`)).body
  assert.equal(check.money, true)
  assert.equal(check.loans, 1)
  assert.equal(check.costs, 2)
  assert.equal(check.costTotal, 1500.5)

  const unconfirmed = await call("ann", "DELETE", `/${house._id}`, {})
  assert.equal(unconfirmed.status, 409)
  assert.match(unconfirmed.body.error, /Type the address \(88 Demo Rd\.\)/)
  assert.equal((await call("ann", "DELETE", `/${house._id}`, { confirm: "88 Demo Road" })).status, 409)
  assert.ok(await Property.findById(house._id))
  assert.equal(await Loan.countDocuments({ propertyId: house._id }), 1)

  // Case and punctuation don't matter.
  const deleted = await call("ann", "DELETE", `/${house._id}`, { confirm: "88 demo rd" })
  assert.equal(deleted.status, 200)
  assert.equal(await Property.findById(house._id), null)
  assert.equal(await Loan.countDocuments({ propertyId: house._id }), 0)
  assert.equal(await Expense.countDocuments({ propertyId: house._id }), 0)
  const history = await Activity.findOne({ title: "Cost added", propertyId: house._id })
  assert.equal(history.propertyName, "88 Demo Rd.")
  const record = await Activity.findOne({ title: "Property deleted" }).sort({ createdAt: -1 })
  assert.match(record.detail, /88 Demo Rd\. · with 1 loan, 2 costs \(\$1,500\.5\)/)
})
