import fs from "node:fs"
import http2 from "node:http2"
import { createPrivateKey, sign } from "node:crypto"

// Apple push (APNs), for the iPhone app: a call push rings the phone through CallKit (PushKit), and notifications
// show messages and missed calls. Set APNS_KEY_ID and the key from Apple (the .p8 file): APNS_KEY_FILE (its path) or
// APNS_KEY (its text, or the text in base64). APNS_TEAM_ID and APNS_BUNDLE_ID default to the company's. Without a key,
// iPhones get nothing.
const HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" }
// Apple refuses a sign-in token newer than one from 20 minutes ago, and older than an hour.
const TOKEN_MS = 45 * 60 * 1000

let transport = null
let signer = null
let issued = { value: "", at: 0 }
const sessions = new Map()

function readKey() {
  const raw = String(process.env.APNS_KEY || "").trim()
  if (raw) return raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8")
  const file = String(process.env.APNS_KEY_FILE || "").trim()
  return file ? fs.readFileSync(file, "utf8") : ""
}

function credentials() {
  if (signer !== null) return signer
  try {
    const text = readKey()
    const keyId = String(process.env.APNS_KEY_ID || "").trim()
    signer = text && keyId ? { key: createPrivateKey(text), keyId, teamId: String(process.env.APNS_TEAM_ID || "8PJ65D3FXP").trim() } : false
  } catch (error) {
    console.error(`Apple push is not set up: ${error.message}`)
    signer = false
  }
  return signer
}

export function apnsConfigured() {
  return Boolean(transport || credentials())
}

export function bundleId() {
  return String(process.env.APNS_BUNDLE_ID || "com.synergifund.app").trim()
}

// Tests replace the sending with their own function ({ device, push, token, sandbox, headers, payload } → { status, reason }).
export function setApnsTransport(fn) {
  transport = fn
}

// Settings changed (tests): read the key again.
export function resetApns() {
  signer = null
  issued = { value: "", at: 0 }
  for (const session of sessions.values()) session.close()
  sessions.clear()
}

// The sign-in token Apple asks for (ES256, the team and key), kept for most of an hour.
export function providerToken(fresh = false) {
  const now = Date.now()
  if (!fresh && issued.value && now - issued.at < TOKEN_MS) return issued.value
  const { key, keyId, teamId } = credentials()
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const body = `${part({ alg: "ES256", kid: keyId })}.${part({ iss: teamId, iat: Math.floor(now / 1000) })}`
  const signature = sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")
  issued = { value: `${body}.${signature}`, at: now }
  return issued.value
}

function origin(sandbox) {
  return String(process.env.APNS_HOST || "").trim() || (sandbox ? HOSTS.sandbox : HOSTS.production)
}

// One connection per Apple host, kept open between pushes and closed after a few quiet minutes.
function session(address) {
  const existing = sessions.get(address)
  if (existing && !existing.closed && !existing.destroyed) return existing
  const client = http2.connect(address)
  const forget = () => {
    if (sessions.get(address) === client) sessions.delete(address)
  }
  client.on("error", forget)
  client.on("goaway", forget)
  client.on("close", forget)
  client.setTimeout(5 * 60 * 1000, () => client.close())
  client.unref()
  sessions.set(address, client)
  return client
}

function post(address, path, headers, body) {
  return new Promise((resolve) => {
    let client
    try {
      client = session(address)
    } catch (error) {
      resolve({ status: 0, reason: error.message })
      return
    }
    let status = 0
    let data = ""
    const request = client.request({ ":method": "POST", ":path": path, "content-type": "application/json", ...headers })
    request.setEncoding("utf8")
    request.on("response", (head) => { status = Number(head[":status"]) || 0 })
    request.on("data", (chunk) => { data += chunk })
    request.on("end", () => {
      let reason = ""
      try {
        reason = JSON.parse(data || "{}").reason || ""
      } catch {}
      resolve({ status, reason })
    })
    request.on("error", (error) => resolve({ status: 0, reason: error.message }))
    request.setTimeout(10000, () => {
      request.close(http2.constants.NGHTTP2_CANCEL)
      resolve({ status: 0, reason: "No answer from Apple" })
    })
    request.end(body)
  })
}

async function deliver(device, push, token, headers, payload) {
  const body = JSON.stringify(payload)
  const send = (sandbox, fresh = false) => (transport
    ? Promise.resolve(transport({ device, push, token, sandbox, headers, payload }))
    : post(origin(sandbox), `/3/device/${token}`, { authorization: `bearer ${providerToken(fresh)}`, ...headers }, body))
  const sandbox = Boolean(device.sandbox)
  let result = await send(sandbox)
  if (result.status === 403 && result.reason === "ExpiredProviderToken") result = await send(sandbox, true)
  // A phone built for testing talks to Apple's test service (and the other way round): try the other one once.
  if (result.status === 400 && result.reason === "BadDeviceToken") {
    const other = await send(!sandbox)
    if (other.status === 200) {
      device.updateOne?.({ $set: { sandbox: !sandbox } }).catch(() => {})
      return other
    }
  }
  return result
}

// push: "voip" rings the phone (CallKit), "alert" shows a notification. A token Apple no longer knows is forgotten:
// the phone's row for a call token, only its notification address for an alert token.
export async function sendApns(devices, { push, payload, expiresAt = 0, collapseId = "", priority = 10 }) {
  let sent = 0
  let failed = 0
  if (!devices.length || !apnsConfigured()) return { sent, failed }
  const voip = push === "voip"
  const headers = {
    "apns-topic": voip ? `${bundleId()}.voip` : bundleId(),
    "apns-push-type": voip ? "voip" : "alert",
    "apns-priority": String(priority),
    "apns-expiration": String(Math.max(0, Math.floor(expiresAt / 1000))),
    ...(collapseId ? { "apns-collapse-id": String(collapseId).slice(0, 64) } : {}),
  }
  for (const device of devices) {
    const token = voip ? device.token : device.alertToken
    if (!token) continue
    let result
    try {
      result = await deliver(device, push, token, headers, payload)
    } catch (error) {
      result = { status: 0, reason: error.message }
    }
    if (result.status === 200) {
      sent += 1
      continue
    }
    failed += 1
    if (result.status === 410 || (result.status === 400 && result.reason === "BadDeviceToken")) {
      if (voip) device.deleteOne?.().catch(() => {})
      else device.updateOne?.({ $unset: { alertToken: 1 } }).catch(() => {})
    } else {
      console.error(`iPhone push failed (${voip ? "call" : payload?.kind || "notification"}): ${result.status || "no answer"} ${result.reason || ""}`.trim())
    }
  }
  return { sent, failed }
}
