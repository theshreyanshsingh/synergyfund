import fs from "node:fs"

// Firebase Cloud Messaging, for the Android app. Set FIREBASE_SERVICE_ACCOUNT to the service account key (the JSON,
// or the JSON in base64), or FIREBASE_SERVICE_ACCOUNT_FILE to the key file's path. Without it, phones get nothing.
let messaging
let transport = null

function readKey() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || "").trim()
  if (raw) return JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"))
  const file = String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || "").trim()
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"))
  return null
}

async function client() {
  if (messaging !== undefined) return messaging
  try {
    const key = readKey()
    if (!key) {
      messaging = null
      return messaging
    }
    const { cert, getApps, initializeApp } = await import("firebase-admin/app")
    const { getMessaging } = await import("firebase-admin/messaging")
    const app = getApps().find((item) => item.name === "synergifund") || initializeApp({ credential: cert(key) }, "synergifund")
    messaging = getMessaging(app)
  } catch (error) {
    console.error(`Firebase is not set up: ${error.message}`)
    messaging = null
  }
  return messaging
}

export function nativePushConfigured() {
  return Boolean(transport || String(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_FILE || "").trim())
}

// Tests replace the sending with their own function (devices, data, options).
export function setNativeTransport(fn) {
  transport = fn
}

const GONE = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"])

// Data-only messages (every value a string): the app decides how to show them, also when it is closed.
export async function sendNative(devices, data, { ttlMs = 3600000, high = true } = {}) {
  if (!devices.length) return { sent: 0, failed: 0 }
  const payload = Object.fromEntries(Object.entries(data).filter(([, value]) => value != null && value !== "").map(([key, value]) => [key, String(value)]))
  if (transport) return transport(devices, payload, { ttlMs, high })
  const fcm = await client()
  if (!fcm) return { sent: 0, failed: 0 }
  const response = await fcm.sendEachForMulticast({
    tokens: devices.map((device) => device.token),
    data: payload,
    android: { priority: high ? "high" : "normal", ttl: ttlMs },
  })
  response.responses.forEach((result, index) => {
    if (result.success) return
    const code = result.error?.code || ""
    // The app was removed or its address changed: forget this phone.
    if (GONE.has(code)) devices[index].deleteOne?.().catch(() => {})
    else console.error(`Android push failed (${data.type || "notification"}): ${code} ${result.error?.message || ""}`.trim())
  })
  return { sent: response.successCount, failed: response.failureCount }
}
