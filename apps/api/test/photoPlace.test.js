import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// Site photos keep when and where the phone took them: staff see it on the property's photos, contractors never do.
testEnv()
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { DocumentFile, Property, User } = await import("../src/models/index.js")
const { propertiesRouter } = await import("../src/routes/properties.js")
const { workspaceRouter } = await import("../src/routes/workspace.js")
const { cleanCapture, presentCapture, readCaptures } = await import("../src/services/photoPlace.js")

let server
let base
let ann
let rae
let as = null
let house

before(async () => {
  await mongoose.connect(mongo.uri)
  ;[ann, rae] = await User.create([
    { name: "Ann", email: "ann@t.test", passwordHash: "x", role: "admin" },
    { name: "Rae", email: "rae@t.test", passwordHash: "x", role: "contractor" },
  ])
  house = await Property.create({ address: "88 Sample Ave", city: "Testville", state: "FL", zip: "32206", lat: 30.34, lng: -81.66, assignedUserIds: [rae._id] })
  const app = express()
  app.use(express.json())
  app.use(async (req, res, next) => {
    req.user = await User.findById(as._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  })
  app.use("/properties", propertiesRouter)
  app.use("/", workspaceRouter)
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  // (The admins' "Photos added" alert is gathered for 1.5 seconds, then sent; let it finish first.)
  await new Promise((resolve) => setTimeout(resolve, 1800))
  server.close()
  await mongoose.disconnect()
  await mongo.stop()
})

// A tiny JPEG-typed file is enough: the server stores it as it is.
const photo = (name) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, { type: "image/jpeg" })
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()

async function fileWeek(places, names = ["one.jpg", "two.jpg", "three.jpg"]) {
  const form = new FormData()
  form.set("propertyId", String(house._id))
  form.set("weekOf", "2026-11-16")
  for (const name of names) form.append("photos", photo(name))
  if (places !== undefined) form.set("places", typeof places === "string" ? places : JSON.stringify(places))
  const response = await fetch(`${base}/photo-sets`, { method: "POST", body: form })
  return { status: response.status, body: await response.json() }
}

const readHouse = async () => (await (await fetch(`${base}/properties/${house._id}`)).json())

test("a contractor's photos keep where and when each was taken, and staff see it with who took them", async () => {
  as = rae
  const filed = await fileWeek([
    { status: "shared", takenAt: minutesAgo(3), lat: 30.3401234567, lng: -81.6602, accuracy: 12.4, fixedAt: minutesAgo(3) },
    { status: "denied", takenAt: minutesAgo(2) },
    { status: "unavailable", takenAt: minutesAgo(1) },
  ])
  assert.equal(filed.status, 201)
  assert.equal(filed.body.count, 3)
  as = ann
  const { photos } = await readHouse()
  const byName = new Map(photos.map((item) => [item.name, item]))
  const one = byName.get("one.jpg")
  assert.equal(one.takenBy, "Rae")
  assert.equal(one.capture.status, "shared")
  assert.equal(one.capture.lat, 30.340123)
  assert.equal(one.capture.lng, -81.6602)
  assert.equal(one.capture.accuracy, 12)
  assert.ok(one.capture.takenAt)
  assert.equal(byName.get("two.jpg").capture.status, "denied")
  assert.equal(byName.get("two.jpg").capture.lat, undefined)
  assert.equal(byName.get("three.jpg").capture.status, "unavailable")
})

test("contractors never get the place back, not even for their own photos", async () => {
  as = rae
  const { photos } = await readHouse()
  assert.ok(photos.length >= 3)
  for (const item of photos) {
    assert.equal("capture" in item, false)
    assert.equal("takenBy" in item, false)
  }
})

test("photos are filed whatever the place says: none sent, nonsense, or a bad position", async () => {
  as = rae
  assert.equal((await fileWeek(undefined, ["a.jpg"])).status, 201)
  assert.equal((await fileWeek("not json", ["b.jpg"])).status, 201)
  assert.equal((await fileWeek([{ status: "shared", lat: 999, lng: 0, takenAt: minutesAgo(1) }], ["c.jpg"])).status, 201)
  as = ann
  const byName = new Map((await readHouse()).photos.map((item) => [item.name, item]))
  // No place: like a photo from before places were kept.
  assert.equal(byName.get("a.jpg").capture, null)
  assert.equal(byName.get("b.jpg").capture, null)
  // A position that can't be right counts as unavailable.
  assert.equal(byName.get("c.jpg").capture.status, "unavailable")
  // It is kept on the file as one field (sealed when encryption is on).
  const stored = await DocumentFile.findOne({ name: "one.jpg" }).lean()
  assert.equal(typeof stored.capture, "string")
})

test("the place is checked: statuses, ranges, accuracy and times", () => {
  const now = Date.parse("2026-11-25T12:00:00Z")
  assert.equal(cleanCapture({ status: "somewhere" }, now), null)
  assert.equal(cleanCapture(null, now), null)
  // A time in the future or months ago becomes the upload's time.
  assert.equal(cleanCapture({ status: "denied", takenAt: "2030-01-01T00:00:00Z" }, now).takenAt.toISOString(), "2026-11-25T12:00:00.000Z")
  assert.equal(cleanCapture({ status: "denied", takenAt: "2025-01-01T00:00:00Z" }, now).takenAt.toISOString(), "2026-11-25T12:00:00.000Z")
  const shared = cleanCapture({ status: "shared", takenAt: "2026-11-25T11:59:00Z", lat: "30.5", lng: -81, accuracy: -4 }, now)
  assert.deepEqual([shared.status, shared.lat, shared.lng, shared.accuracy], ["shared", 30.5, -81, null])
  assert.equal(cleanCapture({ status: "shared", lat: 10, lng: 200 }, now).status, "unavailable")
  assert.deepEqual(readCaptures(JSON.stringify([{ status: "denied" }]), 3, now).map((item) => item?.status ?? null), ["denied", null, null])
  assert.deepEqual(readCaptures("{}", 2, now), [null, null])
  assert.equal(presentCapture("not json"), null)
  assert.equal(presentCapture(undefined), null)
})
