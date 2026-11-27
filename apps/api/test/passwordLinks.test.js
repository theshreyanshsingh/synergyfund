import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// Passwords are never emailed: "Forgot password", invitations and an admin's reset send a one-time link to choose one.
testEnv()
process.env.JWT_SECRET = "password-links-test"
process.env.RESEND_API_KEY = ""
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { default: cookieParser } = await import("cookie-parser")
const { default: bcrypt } = await import("bcryptjs")
const { permissionsFor } = await import("@synergifund/shared")
const { publicUser } = await import("../src/lib/serialize.js")
const { MailMessage, PasswordLink, User } = await import("../src/models/index.js")
const { authRouter } = await import("../src/routes/auth.js")
const { workspaceRouter } = await import("../src/routes/workspace.js")
const { createPasswordLink } = await import("../src/services/passwordLinks.js")
const { signSession } = await import("../src/middleware/auth.js")

let server
let base
let ann

before(async () => {
  await mongoose.connect(mongo.uri)
  const passwordHash = await bcrypt.hash("old-password", 4)
  ann = await User.create({ name: "Ann", email: "ann@t.test", passwordHash, role: "admin" })
  await User.create({ name: "Mel", email: "mel@t.test", passwordHash, role: "member" })
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use("/auth", authRouter)
  app.use("/", async (req, res, next) => {
    req.user = await User.findById(ann._id)
    req.permissions = permissionsFor(publicUser(req.user))
    next()
  }, workspaceRouter)
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  // Activity alerts finish in the background.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  server.close()
  await mongoose.disconnect()
  await mongo.stop()
})

const json = (method, path, body, headers = {}) => fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (response) => ({ status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().join("; ") }))
const canSignIn = (email, password) => json("POST", "/auth/login", { email, password }, { "CF-Connecting-IP": `192.0.2.${Math.floor(Math.random() * 200)}` }).then((r) => r.status === 200)

test("Forgot password answers the same for any email, and makes a link only for a real account", async () => {
  const unknown = await json("POST", "/auth/forgot", { email: "nobody@t.test" }, { "CF-Connecting-IP": "192.0.2.10" })
  const known = await json("POST", "/auth/forgot", { email: "MEL@t.test" }, { "CF-Connecting-IP": "192.0.2.10" })
  assert.equal(unknown.status, 200)
  assert.equal(known.status, 200)
  assert.equal(unknown.body.message, known.body.message)
  const mel = await User.findOne({ email: "mel@t.test" })
  const links = await PasswordLink.find({ userId: mel._id })
  assert.equal(links.length, 1)
  assert.equal(links[0].purpose, "reset")
  assert.match(links[0].tokenHash, /^[a-f0-9]{64}$/)
  // The email log keeps the text, never the link's secret.
  const mail = await MailMessage.findOne({ event: "password.reset" })
  assert.ok(mail)
  assert.doesNotMatch(JSON.stringify(mail.toObject()), /set-password\?token=/)
  assert.equal(await PasswordLink.countDocuments({ userId: (await User.findOne({ email: "ann@t.test" }))._id }), 0)
  assert.equal((await json("POST", "/auth/forgot", { email: "not an email" })).status, 400)
})

test("a link shows whose it is, sets the password once, signs in, and signs out other sessions", async () => {
  const mel = await User.findOne({ email: "mel@t.test" })
  const oldSession = signSession(mel)
  const { token } = await createPasswordLink(mel, "reset")
  const shown = await json("GET", `/auth/password-link?token=${token}`)
  assert.equal(shown.status, 200)
  assert.deepEqual(shown.body, { email: "mel@t.test", name: "Mel", purpose: "reset" })
  assert.equal((await json("POST", "/auth/password-link", { token, password: "short" })).status, 400)
  const set = await json("POST", "/auth/password-link", { token, password: "brand-new-password" })
  assert.equal(set.status, 200)
  assert.match(set.cookie, /sf_session=/)
  assert.ok(await canSignIn("mel@t.test", "brand-new-password"))
  assert.equal(await canSignIn("mel@t.test", "old-password"), false)
  const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${oldSession}` } })
  assert.equal(me.status, 401)
  // Used once only.
  assert.equal((await json("POST", "/auth/password-link", { token, password: "another-password" })).status, 404)
  assert.equal((await json("GET", `/auth/password-link?token=${token}`)).status, 404)
})

test("a newer link ends the older one; an expired link and two uses at once don't work", async () => {
  const mel = await User.findOne({ email: "mel@t.test" })
  const first = await createPasswordLink(mel, "reset")
  const second = await createPasswordLink(mel, "admin")
  assert.equal((await json("GET", `/auth/password-link?token=${first.token}`)).status, 404)
  assert.equal((await json("GET", `/auth/password-link?token=${second.token}`)).body.purpose, "admin")
  const both = await Promise.all([1, 2].map(() => json("POST", "/auth/password-link", { token: second.token, password: "raced-password-1" })))
  assert.deepEqual(both.map((item) => item.status).sort(), [200, 404])
  const late = await createPasswordLink(mel, "reset")
  await PasswordLink.updateOne({ userId: mel._id, usedAt: null }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await json("GET", `/auth/password-link?token=${late.token}`)).status, 404)
})

test("an invitation without a password emails a link (and gives it to the admin); with one, the email leaves it out", async () => {
  const invited = await json("POST", "/members", { name: "Rae", email: "rae@t.test", role: "contractor", permissions: permissionsFor({ role: "contractor" }), propertyIds: [] })
  assert.equal(invited.status, 201)
  assert.match(invited.body.link, /\/set-password\?token=[\w-]{40,}$/)
  const token = new URL(invited.body.link).searchParams.get("token")
  assert.equal((await json("GET", `/auth/password-link?token=${token}`)).body.purpose, "invite")
  assert.equal((await json("POST", "/auth/password-link", { token, password: "rae-chose-this" })).status, 200)
  assert.ok(await canSignIn("rae@t.test", "rae-chose-this"))

  const withPassword = await json("POST", "/members", { name: "Dee", email: "dee@t.test", password: "admin-picked-1", role: "member", permissions: permissionsFor({ role: "member" }), propertyIds: [] })
  assert.equal(withPassword.status, 201)
  assert.ok(await canSignIn("dee@t.test", "admin-picked-1"))
  const mails = await MailMessage.find({ event: "member.invited" })
  assert.equal(mails.length, 2)
  assert.ok(mails.every((mail) => !JSON.stringify(mail.toObject()).includes("admin-picked-1")))
  assert.equal((await json("POST", "/members", { name: "Eli", email: "eli@t.test", password: "short", role: "member", permissions: [], propertyIds: [] })).status, 400)
})

test("an admin can set a password (not emailed) or email a link; the person's old password works until the link is used", async () => {
  const mel = await User.findOne({ email: "mel@t.test" })
  const set = await json("POST", `/members/${mel._id}/password`, { password: "set-by-admin-1" })
  assert.equal(set.status, 200)
  assert.ok(await canSignIn("mel@t.test", "set-by-admin-1"))
  const changed = await MailMessage.findOne({ event: "member.password" }).sort({ createdAt: -1 })
  assert.doesNotMatch(JSON.stringify(changed.toObject()), /set-by-admin-1/)
  const sent = await json("POST", `/members/${mel._id}/password-link`, {})
  assert.equal(sent.status, 200)
  assert.match(sent.body.link, /\/set-password\?token=/)
  assert.ok(await canSignIn("mel@t.test", "set-by-admin-1"))
  assert.equal((await json("POST", `/members/${new mongoose.Types.ObjectId()}/password-link`, {})).status, 404)
})

test("after too many wrong guesses, setting a password from a link lets them sign in again straight away", async () => {
  const mel = await User.findOne({ email: "mel@t.test" })
  const from = { "CF-Connecting-IP": "192.0.2.150" }
  for (let i = 0; i < 5; i += 1) await json("POST", "/auth/login", { email: "mel@t.test", password: "wrong-guess-1" }, from)
  assert.equal((await json("POST", "/auth/login", { email: "mel@t.test", password: "set-by-admin-1" }, from)).status, 429)
  const { token } = await createPasswordLink(mel, "reset")
  assert.equal((await json("POST", "/auth/password-link", { token, password: "fresh-password-9" })).status, 200)
  assert.equal((await json("POST", "/auth/login", { email: "mel@t.test", password: "fresh-password-9" }, from)).status, 200)
})

test("Forgot password can't be used to flood an inbox", async () => {
  const statuses = []
  for (let i = 0; i < 4; i += 1) statuses.push((await json("POST", "/auth/forgot", { email: "dee@t.test" }, { "CF-Connecting-IP": "192.0.2.77" })).status)
  assert.deepEqual(statuses, [200, 200, 200, 429])
})
