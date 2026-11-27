import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// The morning reminder: one notification per person with their tasks due today or overdue, and, for the people who
// handle money, payments and deadlines coming up. Once a day, and nothing for people with nothing due.
testEnv()
process.env.JWT_SECRET = "reminders-test"
process.env.REMINDERS = "off"
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { Bill, Loan, Notification, Property, Task, User } = await import("../src/models/index.js")
const { teamToday } = await import("../src/lib/dates.js")
const { attentionItems } = await import("../src/routes/workspace.js")
const { buildReminders, sendDailyReminders } = await import("../src/services/reminders.js")

const today = teamToday()
const day = (offset) => {
  const [year, month, date] = today.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10)
}
const people = {}
let house

before(async () => {
  await mongoose.connect(mongo.uri)
  for (const [key, role] of [["ann", "admin"], ["fin", "finance"], ["mel", "member"], ["rae", "contractor"], ["bo", "member"]]) {
    people[key] = await User.create({ name: key[0].toUpperCase() + key.slice(1), email: `${key}@t.test`, passwordHash: "x", role })
  }
  await User.create({ name: "AI teammate", email: "bot@t.test", passwordHash: "x", role: "member", bot: true })
  house = await Property.create({ address: "88 Demo Rd", stage: "Renovation" })
  await Task.create([
    { title: "Order windows", due: day(-2), assigneeId: people.mel._id, propertyId: house._id },
    { title: "Call the plumber", due: today, assigneeId: people.mel._id },
    { title: "Tomorrow's job", due: day(1), assigneeId: people.mel._id },
    { title: "Already done", due: day(-3), assigneeId: people.mel._id, done: true, status: "Completed" },
    { title: "Walk the house", due: today, assigneeId: people.rae._id, propertyId: house._id },
    { title: "No date", due: "", assigneeId: people.bo._id },
  ])
  await Bill.create([
    { title: "Property taxes 2026", category: "Property taxes", amount: 2400, due: day(-1), status: "Scheduled", propertyId: house._id },
    { title: "Water", category: "Utilities", amount: 80, due: day(10), status: "Scheduled", propertyId: house._id },
    { title: "Kiavi mortgage", category: "Mortgage", amount: 1200, due: day(2), status: "Scheduled", propertyId: house._id },
    { title: "Paid HOA", category: "HOA", amount: 300, due: day(-5), status: "Paid", propertyId: house._id },
  ])
  await Loan.create([
    { propertyId: house._id, lender: "Kiavi", amount: 100000, balance: 95000, maturity: day(10) },
    { propertyId: house._id, lender: "Later Lender", amount: 50000, maturity: day(45) },
  ])
})

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  await mongoose.disconnect()
  await mongo.stop()
})

test("Needs attention now lists overdue taxes and other payments, not only mortgages", async () => {
  const bills = await Bill.find()
  const items = attentionItems({ properties: [house], budgetsByProperty: new Map(), draws: [], drawsByProperty: new Map(), loans: [], bills, tasks: [], names: new Map([[String(house._id), house.address]]) })
  const titles = items.map((item) => item.title)
  assert.ok(titles.includes("Property taxes 2026"))
  assert.equal(items.find((item) => item.title === "Property taxes 2026").kind, "Payment")
  assert.equal(items.find((item) => item.title === "Property taxes 2026").tone, "bad")
  assert.ok(titles.includes("Kiavi mortgage"))
  // A monthly bill more than a week out, and a paid one, stay off the list.
  assert.ok(!titles.includes("Water"))
  assert.ok(!titles.includes("Paid HOA"))
})

test("each person gets what's due for them; nobody with nothing due gets anything", async () => {
  const reminders = await buildReminders(today)
  const by = new Map(reminders.map((item) => [item.user.email, item]))
  assert.deepEqual([...by.keys()].sort(), ["ann@t.test", "fin@t.test", "mel@t.test", "rae@t.test"])

  const mel = by.get("mel@t.test")
  assert.equal(mel.title, "Today: 2 tasks due (1 overdue)")
  assert.match(mel.body, /• Order windows · 88 Demo Rd \(overdue since /)
  assert.match(mel.body, /• Call the plumber \(due today\)/)
  assert.doesNotMatch(mel.body, /Tomorrow's job|Already done/)
  assert.equal(mel.href, "/tasks")

  const rae = by.get("rae@t.test")
  assert.equal(rae.title, "Today: 1 task due")
  assert.doesNotMatch(rae.body, /Payments/)

  const ann = by.get("ann@t.test")
  assert.match(ann.title, /^Today: 3 payments and deadlines$/)
  assert.match(ann.body, /Property taxes 2026 · 88 Demo Rd · \$2,400 \(Payment overdue, was due /)
  assert.match(ann.body, /Kiavi mortgage · 88 Demo Rd · \$1,200/)
  assert.match(ann.body, /Kiavi · matures · 88 Demo Rd/)
  assert.doesNotMatch(ann.body, /Water|Paid HOA|Later Lender/)
  assert.equal(ann.href, "/overview")
  assert.equal(by.get("fin@t.test").body, ann.body)
})

test("it sends once a day, after the morning hour", async () => {
  // 3 AM on the team's clock (Eastern): too early.
  const early = new Date(`${today}T08:00:00Z`)
  assert.deepEqual(await sendDailyReminders({ now: early }), { skipped: "too early" })
  const sent = await sendDailyReminders({ force: true })
  assert.equal(sent.sent, 4)
  const notices = await Notification.find({ event: "reminder.daily" })
  assert.equal(notices.length, 4)
  assert.ok(notices.every((notice) => notice.title.startsWith("Today: ")))
  assert.deepEqual(await sendDailyReminders({ force: true }), { skipped: "already sent today" })
  assert.equal(await Notification.countDocuments({ event: "reminder.daily" }), 4)
})
