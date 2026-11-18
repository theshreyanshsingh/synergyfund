import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// Property Info › Title company: saved per property, checked, logged, offered on other properties, hidden from
// contractors.
testEnv()
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { Activity, Property, User } = await import("../src/models/index.js")
const { propertiesRouter } = await import("../src/routes/properties.js")
const { readTitleCompany, titleCompanyChange, titleCompanyChoices } = await import("../src/services/titleCompany.js")

let server
let base
let ann
let cy
let as = null
let first
let second

before(async () => {
  await mongoose.connect(mongo.uri)
  ;[ann, cy] = await User.create([
    { name: "Ann", email: "ann@t.test", passwordHash: "x", role: "admin" },
    { name: "Cy", email: "cy@t.test", passwordHash: "x", role: "contractor" },
  ])
  ;[first, second] = await Property.create([
    { address: "12 Demo St", city: "Testville", state: "FL", zip: "32206", assignedUserIds: [cy._id] },
    { address: "48 Sample Ave", city: "Testville", state: "FL", zip: "32206" },
  ])
  as = ann
  const app = express()
  app.use(express.json())
  app.use(async (req, res, next) => {
    req.user = await User.findById(as._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  })
  app.use("/properties", propertiesRouter)
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

const firstCoast = { name: "  First   Coast Title ", contactName: "Dana Reyes", phone: "(904) 555-0142", email: "closings@firstcoast.test", address: "100 Main St, Testville, FL 32206", fileNumber: "FC-2291", notes: "Confirm wires by phone.\nClosing Friday." }

test("the title company is saved on the property, trimmed, and shown with the property", async () => {
  const saved = await send(`/properties/${first._id}`, { method: "PATCH", body: { titleCompany: firstCoast } })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.property.titleCompany, { ...firstCoast, name: "First Coast Title" })
  const read = await send(`/properties/${first._id}`)
  assert.equal(read.body.property.titleCompany.phone, "(904) 555-0142")
  assert.equal(read.body.property.titleCompany.notes, "Confirm wires by phone.\nClosing Friday.")
  const log = await Activity.findOne({ propertyId: first._id }).sort({ createdAt: -1 })
  assert.match(log.detail, /Title company none → First Coast Title/)
  // A property without one shows every field empty.
  const other = await send(`/properties/${second._id}`)
  assert.deepEqual(Object.values(other.body.property.titleCompany), ["", "", "", "", "", "", ""])
})

test("a bad email, a name left out, or a field that is too long is refused", async () => {
  assert.match((await send(`/properties/${second._id}`, { method: "PATCH", body: { titleCompany: { name: "Coastal Title", email: "not an email" } } })).body.error, /email/)
  assert.match((await send(`/properties/${second._id}`, { method: "PATCH", body: { titleCompany: { phone: "904 555 0100" } } })).body.error, /name/)
  assert.equal((await send(`/properties/${second._id}`, { method: "PATCH", body: { titleCompany: { name: "x".repeat(161) } } })).status, 400)
  assert.equal((await send(`/properties/${second._id}`, { method: "PATCH", body: { titleCompany: "First Coast" } })).status, 400)
  assert.equal((await Property.findById(second._id)).titleCompany?.name, undefined)
})

test("title companies on other properties are offered with their contact details, once each", async () => {
  await send(`/properties/${second._id}`, { method: "PATCH", body: { titleCompany: { name: "first coast title", fileNumber: "FC-3001" } } })
  const { status, body } = await send("/properties/title-companies")
  assert.equal(status, 200)
  assert.equal(body.items.length, 1)
  assert.equal(body.items[0].properties, 2)
  // The details come from whichever property has them, and the file number (this closing's) is never offered.
  assert.equal(body.items[0].phone, "(904) 555-0142")
  assert.equal(body.items[0].contactName, "Dana Reyes")
  assert.equal(body.items[0].fileNumber, undefined)
  const log = await Activity.findOne({ propertyId: second._id }).sort({ createdAt: -1 })
  assert.match(log.detail, /Title company none → first coast title/)
})

test("removing it clears every field; changing only details is logged as an update", async () => {
  await send(`/properties/${second._id}`, { method: "PATCH", body: { titleCompany: { name: "first coast title", fileNumber: "FC-3002" } } })
  assert.match((await Activity.findOne({ propertyId: second._id }).sort({ createdAt: -1 })).detail, /Title company first coast title details updated/)
  const cleared = await send(`/properties/${second._id}`, { method: "PATCH", body: { titleCompany: { name: "", contactName: "", phone: "", email: "", address: "", fileNumber: "", notes: "" } } })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.property.titleCompany.name, "")
  assert.match((await Activity.findOne({ propertyId: second._id }).sort({ createdAt: -1 })).detail, /Title company first coast title → none/)
})

test("contractors neither see the title company nor the list of them", async () => {
  as = cy
  try {
    const read = await send(`/properties/${first._id}`)
    assert.equal(read.status, 200)
    assert.equal(read.body.property.titleCompany, undefined)
    assert.equal((await send("/properties/title-companies")).status, 403)
  } finally {
    as = ann
  }
})

test("the helpers: reading, the log line and the choices", () => {
  assert.deepEqual(readTitleCompany({ name: " A  B ", notes: " one\r\ntwo " }).value, { name: "A B", contactName: "", phone: "", email: "", address: "", fileNumber: "", notes: "one\ntwo" })
  assert.ok(readTitleCompany(null).error)
  assert.equal(titleCompanyChange({}, {}), "")
  assert.equal(titleCompanyChange({ titleCompany: { name: "A" } }, { titleCompany: { name: "a" } }), "Title company a details updated")
  const choices = titleCompanyChoices([
    { titleCompany: { name: "Beta Title" }, updatedAt: new Date(1) },
    { titleCompany: { name: "Alpha Title", phone: "1" }, updatedAt: new Date(2) },
    { titleCompany: { name: "alpha title", phone: "2" }, updatedAt: new Date(3) },
    { titleCompany: { name: "" }, updatedAt: new Date(4) },
  ])
  assert.deepEqual(choices.map((item) => [item.name, item.properties, item.phone]), [["alpha title", 2, "2"], ["Beta Title", 1, ""]])
})
