import assert from "node:assert/strict"
import { generateKeyPairSync, verify } from "node:crypto"
import http2 from "node:http2"
import { test } from "node:test"
import { testEnv } from "./helpers.js"

testEnv()

// A stand-in for Apple's push service (plain HTTP/2 on this machine): records each request and answers as told.
const seen = []
let answer = () => ({ status: 200 })
const server = http2.createServer()
server.on("stream", (stream, headers) => {
  let body = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => { body += chunk })
  stream.on("end", () => {
    const request = { headers, body: JSON.parse(body || "{}") }
    seen.push(request)
    const { status, reason } = answer(request)
    stream.respond({ ":status": status, "content-type": "application/json" })
    stream.end(reason ? JSON.stringify({ reason }) : "")
  })
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
Object.assign(process.env, {
  APNS_HOST: `http://127.0.0.1:${server.address().port}`,
  APNS_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n"),
  APNS_KEY_ID: "ABC123DEFG",
  APNS_TEAM_ID: "8PJ65D3FXP",
  APNS_BUNDLE_ID: "com.synergifund.app",
})
const apns = await import("../src/services/apns.js")

// A phone as the sender sees it, recording what it is asked to change.
function phone(fields) {
  const changes = []
  return { ...fields, changes, deleteOne: async () => changes.push("deleted"), updateOne: async (update) => changes.push(update) }
}
const TOKEN = "ab".repeat(32)
const ALERT = "cd".repeat(32)

test.after(() => {
  apns.resetApns()
  server.close()
})

test("a call push: Apple's call topic, the sign-in token, and when it stops mattering", async () => {
  seen.length = 0
  answer = () => ({ status: 200 })
  const expiresAt = Date.now() + 40000
  const result = await apns.sendApns([phone({ token: TOKEN, alertToken: ALERT })], { push: "voip", payload: { type: "call", callId: "c1" }, expiresAt, priority: 10 })
  assert.deepEqual(result, { sent: 1, failed: 0 })
  const [request] = seen
  assert.equal(request.headers[":path"], `/3/device/${TOKEN}`)
  assert.equal(request.headers["apns-topic"], "com.synergifund.app.voip")
  assert.equal(request.headers["apns-push-type"], "voip")
  assert.equal(request.headers["apns-priority"], "10")
  assert.equal(request.headers["apns-expiration"], String(Math.floor(expiresAt / 1000)))
  assert.deepEqual(request.body, { type: "call", callId: "c1" })
  // The token is ES256, from this team and key, and checks out with the key's public half.
  const [head, claims, signature] = request.headers.authorization.replace(/^bearer /, "").split(".")
  assert.deepEqual(JSON.parse(Buffer.from(head, "base64url")), { alg: "ES256", kid: "ABC123DEFG" })
  const issued = JSON.parse(Buffer.from(claims, "base64url"))
  assert.equal(issued.iss, "8PJ65D3FXP")
  assert.ok(Math.abs(issued.iat - Date.now() / 1000) < 5)
  assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")))
})

test("a notification: the app's own topic and its notification address, grouped by its tag", async () => {
  seen.length = 0
  answer = () => ({ status: 200 })
  const result = await apns.sendApns([phone({ token: TOKEN, alertToken: ALERT })], { push: "alert", payload: { aps: { alert: { title: "Ann", body: "Hi" } } }, collapseId: "chat-1", priority: 10 })
  assert.equal(result.sent, 1)
  assert.equal(seen[0].headers[":path"], `/3/device/${ALERT}`)
  assert.equal(seen[0].headers["apns-topic"], "com.synergifund.app")
  assert.equal(seen[0].headers["apns-push-type"], "alert")
  assert.equal(seen[0].headers["apns-collapse-id"], "chat-1")
  // A phone without notifications allowed has no notification address and gets none.
  seen.length = 0
  assert.deepEqual(await apns.sendApns([phone({ token: TOKEN })], { push: "alert", payload: {} }), { sent: 0, failed: 0 })
  assert.equal(seen.length, 0)
})

test("the sign-in token is kept between pushes, and made again when Apple says it expired", async () => {
  seen.length = 0
  answer = () => ({ status: 200 })
  await apns.sendApns([phone({ token: TOKEN })], { push: "voip", payload: {} })
  await apns.sendApns([phone({ token: TOKEN })], { push: "voip", payload: {} })
  assert.equal(seen[0].headers.authorization, seen[1].headers.authorization)
  seen.length = 0
  await new Promise((resolve) => setTimeout(resolve, 1100))
  answer = (request) => (seen.length === 1 ? { status: 403, reason: "ExpiredProviderToken" } : { status: 200 })
  const result = await apns.sendApns([phone({ token: TOKEN })], { push: "voip", payload: {} })
  assert.equal(result.sent, 1)
  assert.equal(seen.length, 2)
  assert.notEqual(seen[0].headers.authorization, seen[1].headers.authorization)
})

test("a phone Apple no longer knows: its row goes for a call address, only the address for notifications", async () => {
  answer = () => ({ status: 410, reason: "Unregistered" })
  const ringing = phone({ token: TOKEN, alertToken: ALERT })
  assert.deepEqual(await apns.sendApns([ringing], { push: "voip", payload: {} }), { sent: 0, failed: 1 })
  assert.deepEqual(ringing.changes, ["deleted"])
  const notified = phone({ token: TOKEN, alertToken: ALERT })
  await apns.sendApns([notified], { push: "alert", payload: {} })
  assert.deepEqual(notified.changes, [{ $unset: { alertToken: 1 } }])
})

test("a bad address is tried on Apple's other service once; Apple refusing the topic changes nothing", async () => {
  seen.length = 0
  answer = () => (seen.length === 1 ? { status: 400, reason: "BadDeviceToken" } : { status: 200 })
  const test = phone({ token: TOKEN, sandbox: false })
  assert.equal((await apns.sendApns([test], { push: "voip", payload: {} })).sent, 1)
  assert.equal(seen.length, 2)
  assert.deepEqual(test.changes, [{ $set: { sandbox: true } }])
  answer = () => ({ status: 400, reason: "BadDeviceToken" })
  const gone = phone({ token: TOKEN })
  await apns.sendApns([gone], { push: "voip", payload: {} })
  assert.deepEqual(gone.changes, ["deleted"])
  answer = () => ({ status: 400, reason: "DeviceTokenNotForTopic" })
  const wrong = phone({ token: TOKEN })
  const errors = console.error
  console.error = () => {}
  try {
    assert.equal((await apns.sendApns([wrong], { push: "voip", payload: {} })).failed, 1)
  } finally {
    console.error = errors
  }
  assert.deepEqual(wrong.changes, [])
})

test("without a key nothing is sent", async () => {
  const saved = { key: process.env.APNS_KEY, id: process.env.APNS_KEY_ID }
  process.env.APNS_KEY = ""
  process.env.APNS_KEY_ID = ""
  apns.resetApns()
  try {
    assert.equal(apns.apnsConfigured(), false)
    assert.deepEqual(await apns.sendApns([phone({ token: TOKEN })], { push: "voip", payload: {} }), { sent: 0, failed: 0 })
  } finally {
    process.env.APNS_KEY = saved.key
    process.env.APNS_KEY_ID = saved.id
    apns.resetApns()
  }
  assert.equal(apns.apnsConfigured(), true)
})
