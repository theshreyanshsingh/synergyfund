import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { KEY1, KEY2, startMongo, testEnv } from "./helpers.js"

testEnv()
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { Company, Property } = await import("../src/models/index.js")

const BANK = { ein: "12-3456789", wireBankName: "First Bank", wireRoutingNumber: "021000021", wireAccountNumber: "000012345678", wireEntityName: "Oak Street LLC", wireAddress: "1 Main St" }
const raw = (Model, id) => Model.collection.findOne({ _id: id })

before(async () => {
  await mongoose.connect(mongo.uri)
})

after(async () => {
  await mongoose.disconnect()
  await mongo.stop()
})

test("bank details are ciphertext in the database and plain in the app", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const company = await Company.create({ name: "Oak Street LLC", ...BANK })
  assert.equal(company.wireAccountNumber, BANK.wireAccountNumber, "the saved record still reads plainly")
  const stored = await raw(Company, company._id)
  for (const [field, value] of Object.entries(BANK)) {
    assert.match(stored[field], /^enc1:k1:/, field)
    assert.ok(!stored[field].includes(value), field)
  }
  assert.equal(stored.name, "Oak Street LLC", "the name stays searchable")
  const found = await Company.findById(company._id)
  assert.equal(found.ein, BANK.ein)
  assert.equal(found.toObject().wireRoutingNumber, BANK.wireRoutingNumber)
  const lean = await Company.find({ _id: company._id }).lean()
  assert.equal(lean[0].wireAddress, BANK.wireAddress, "lean reads open them too")
  assert.equal((await Company.findOne({ _id: company._id }).lean()).ein, BANK.ein)
})

test("saving without changes leaves the ciphertext alone; a change re-encrypts only that field", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const company = await Company.create({ name: "Maple LLC", ...BANK })
  const first = await raw(Company, company._id)
  const loaded = await Company.findById(company._id)
  loaded.set({ ...BANK, notes: "Called the bank" })
  await loaded.save()
  const second = await raw(Company, company._id)
  assert.equal(second.ein, first.ein, "the same value is not written again")
  loaded.wireAccountNumber = "999988887777"
  await loaded.save()
  const third = await raw(Company, company._id)
  assert.notEqual(third.wireAccountNumber, first.wireAccountNumber)
  assert.equal(third.ein, first.ein)
  assert.equal((await Company.findById(company._id)).wireAccountNumber, "999988887777")
})

test("records saved before encryption still read, and blank values stay blank", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const { insertedId } = await Company.collection.insertOne({ name: "Old LLC", ...BANK, wireBankName: "" })
  const company = await Company.findById(insertedId)
  assert.equal(company.ein, BANK.ein)
  assert.equal(company.wireBankName, "")
  const stored = await raw(Company, insertedId)
  assert.equal(stored.ein, BANK.ein, "reading doesn't rewrite it (the encryption job does)")
})

test("a value copied to another record or field does not open", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const one = await Company.create({ name: "One LLC", ...BANK })
  const two = await Company.create({ name: "Two LLC" })
  const stored = await raw(Company, one._id)
  await Company.collection.updateOne({ _id: two._id }, { $set: { ein: stored.ein } })
  await assert.rejects(Company.findById(two._id))
  await Company.collection.updateOne({ _id: one._id }, { $set: { ein: stored.wireAccountNumber } })
  await assert.rejects(Company.findById(one._id))
})

test("update queries can't write these fields; other updates still work", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const company = await Company.create({ name: "Guarded LLC", ...BANK })
  await assert.rejects(Company.updateOne({ _id: company._id }, { $set: { ein: "98-7654321" } }), /encrypted/)
  await assert.rejects(Company.findOneAndUpdate({ _id: company._id }, { wireAccountNumber: "1234" }), /encrypted/)
  await assert.rejects(Company.insertMany([{ name: "Bulk LLC", ein: "11-1111111" }]), /encrypted/)
  await Company.updateOne({ _id: company._id }, { $set: { notes: "fine" } })
  assert.equal((await Company.findById(company._id)).notes, "fine")
})

test("property access info is encrypted; a rotated key still reads the old ones", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  const property = await Property.create({ address: "12 Elm St", accessInfo: "Lockbox 4821 on the back door" })
  const stored = await raw(Property, property._id)
  assert.match(stored.accessInfo, /^enc1:k1:/)
  assert.equal(stored.address, "12 Elm St")
  process.env.FIELD_ENCRYPTION_KEYS = `${KEY2},${KEY1}`
  const found = await Property.findById(property._id)
  assert.equal(found.accessInfo, "Lockbox 4821 on the back door")
  found.accessInfo = "Lockbox 1111"
  await found.save()
  assert.match((await raw(Property, property._id)).accessInfo, /^enc1:k2:/)
  process.env.FIELD_ENCRYPTION_KEYS = KEY1
  await assert.rejects(Property.findById(property._id), /k2 is not configured/)
})

test("with no key set, values are saved as before", async () => {
  process.env.FIELD_ENCRYPTION_KEYS = ""
  const property = await Property.create({ address: "9 Pine St", accessInfo: "Gate 1234" })
  assert.equal((await raw(Property, property._id)).accessInfo, "Gate 1234")
})
