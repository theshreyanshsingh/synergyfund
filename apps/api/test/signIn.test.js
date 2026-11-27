import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startMongo, testEnv } from "./helpers.js"

// Signing in and out: the cookie is https-only on the live site, signing out ends that session on the server, "Sign
// out everywhere" ends the others, and wrong passwords are limited.
testEnv()
process.env.JWT_SECRET = "sign-in-test"
const mongo = await startMongo()
const { default: mongoose } = await import("mongoose")
const { default: express } = await import("express")
const { default: cookieParser } = await import("cookie-parser")
const { default: bcrypt } = await import("bcryptjs")
const { NativeDevice, PushSubscription, User } = await import("../src/models/index.js")
const { authRouter } = await import("../src/routes/auth.js")

let server
let base

before(async () => {
  await mongoose.connect(mongo.uri)
  const passwordHash = await bcrypt.hash("right-password", 4)
  await User.create([
    { name: "Ann", email: "ann@t.test", passwordHash, role: "admin" },
    { name: "Bo", email: "bo@t.test", passwordHash, role: "member" },
    { name: "Cy", email: "cy@t.test", passwordHash, role: "member" },
  ])
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use("/auth", authRouter)
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

async function login(email, password = "right-password", address = "203.0.113.1") {
  const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": address }, body: JSON.stringify({ email, password }) })
  const cookie = response.headers.getSetCookie().find((line) => line.startsWith("sf_session=")) || ""
  return { status: response.status, body: await response.json(), cookie, token: cookie.split(";")[0].slice("sf_session=".length) }
}
const me = (token) => fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.status)
const post = (path, token, body = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })

test("the sign-in cookie is https-only on the live site, and not in local development", async () => {
  const local = await login("ann@t.test")
  assert.equal(local.status, 200)
  assert.doesNotMatch(local.cookie, /;\s*Secure/i)
  assert.match(local.cookie, /HttpOnly/i)
  const before = process.env.NODE_ENV
  process.env.NODE_ENV = "production"
  try {
    const live = await login("ann@t.test")
    assert.match(live.cookie, /;\s*Secure/i)
    process.env.COOKIE_SECURE = "false"
    assert.doesNotMatch((await login("ann@t.test")).cookie, /;\s*Secure/i)
  } finally {
    process.env.NODE_ENV = before ?? ""
    delete process.env.COOKIE_SECURE
  }
})

test("signing out ends that session on the server; the person's other sessions keep working", async () => {
  const laptop = await login("bo@t.test")
  const phone = await login("bo@t.test")
  assert.equal(await me(laptop.token), 200)
  const out = await post("/auth/logout", laptop.token)
  assert.equal(out.status, 200)
  assert.match(out.headers.getSetCookie().join(""), /sf_session=;/)
  assert.equal(await me(laptop.token), 401)
  assert.equal(await me(phone.token), 200)
  // Signing out twice is fine.
  assert.equal((await post("/auth/logout", laptop.token)).status, 200)
})

test("Sign out everywhere ends the other sessions and their notifications, and keeps this device", async () => {
  const here = await login("cy@t.test")
  const there = await login("cy@t.test")
  const cy = await User.findOne({ email: "cy@t.test" })
  await PushSubscription.create([
    { userId: cy._id, endpoint: "https://push.example/here", p256dh: "k", auth: "a" },
    { userId: cy._id, endpoint: "https://push.example/there", p256dh: "k", auth: "a" },
  ])
  await NativeDevice.create([{ userId: cy._id, token: "phone-here", keyHash: "h1" }, { userId: cy._id, token: "phone-lost", keyHash: "h2" }])
  const response = await post("/auth/sign-out-everywhere", here.token, { keepEndpoint: "https://push.example/here", keepToken: "phone-here" })
  assert.equal(response.status, 200)
  const fresh = response.headers.getSetCookie().find((line) => line.startsWith("sf_session=")).split(";")[0].slice("sf_session=".length)
  assert.equal(await me(there.token), 401)
  assert.equal(await me(here.token), 401)
  assert.equal(await me(fresh), 200)
  assert.deepEqual((await PushSubscription.find({ userId: cy._id })).map((item) => item.endpoint), ["https://push.example/here"])
  assert.deepEqual((await NativeDevice.find({ userId: cy._id })).map((item) => item.token), ["phone-here"])
})

test("after 5 wrong passwords from one address, sign-in waits there, even for the right one; elsewhere still works", async () => {
  for (let i = 0; i < 5; i += 1) assert.equal((await login("ann@t.test", "wrong-password", "198.51.100.7")).status, 401)
  const locked = await login("ann@t.test", "right-password", "198.51.100.7")
  assert.equal(locked.status, 429)
  assert.match(locked.body.error, /Try again in 15 minutes/)
  assert.equal((await login("ann@t.test", "right-password", "198.51.100.8")).status, 200)
  // Wrong passwords sent all at once count too.
  const burst = await Promise.all(Array.from({ length: 8 }, () => login("bo@t.test", "wrong-password", "198.51.100.9")))
  assert.ok(burst.filter((item) => item.status === 429).length >= 3)
})
