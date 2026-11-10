import webpush from "web-push"
import { NativeDevice, PushSubscription } from "../models/index.js"
import { nativePushConfigured, sendNative } from "./fcm.js"
import { apnsConfigured, sendApns } from "./apns.js"

export function configurePush() {
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@synergifund.com"
  const publicKey = process.env.VAPID_PUBLIC_KEY || ""
  const privateKey = process.env.VAPID_PRIVATE_KEY || ""
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}

// Apple's push service (iPhone, iPad, Safari on a Mac).
export function isApplePush(endpoint) {
  try {
    return new URL(endpoint).hostname.endsWith("push.apple.com")
  } catch {
    return false
  }
}

function serviceName(endpoint) {
  try {
    const host = new URL(endpoint).hostname
    if (host.endsWith("push.apple.com")) return "Apple"
    if (host.includes("googleapis.com")) return "Google"
    if (host.includes("mozilla")) return "Mozilla"
    if (host.includes("windows") || host.includes("microsoft")) return "Microsoft"
    return host
  } catch {
    return "unknown"
  }
}

// Extra fields (kind, tag, callId, media) travel to the service worker, which uses them for call notifications.
// Never pass a "topic" option: Apple's push service rejects every push that has a Topic header.
export async function sendPush(subscriptions, { title, body, href, ...extra }, options = {}) {
  const payload = JSON.stringify({ ...extra, title, body, href: href || "/notifications" })
  const { topic, ...safe } = options
  let sent = 0
  let failed = 0
  const errors = []
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, safe)
      sent += 1
    } catch (error) {
      failed += 1
      const service = serviceName(subscription.endpoint)
      const reason = `${error.statusCode || "no answer"} ${String(error.body || error.message || "").trim().slice(0, 200)}`.trim()
      errors.push({ service, reason })
      if (error.statusCode === 404 || error.statusCode === 410) {
        // The device turned notifications off or the app was removed; forget it.
        await subscription.deleteOne().catch(() => {})
      } else {
        console.error(`Push to ${service} failed (${extra.kind || "notification"}): ${reason}`)
      }
    }
  }
  return { sent, failed, errors }
}

export async function subscriptionsFor(userIds) {
  if (!userIds.length || !configurePush()) return []
  return PushSubscription.find({ userId: { $in: userIds } })
}

// What the Android app gets: the same message as data. "call" rings the phone, "call-over" stops it (and says
// "Missed call" unless quiet), anything else is a notification that opens href.
function nativeData(message) {
  const type = message.kind === "call" ? "call" : message.kind === "call-over" ? "call-over" : "alert"
  return {
    type,
    kind: message.kind || "",
    title: message.title,
    body: message.body,
    href: message.href || "/notifications",
    tag: message.tag,
    callId: message.callId,
    media: message.media,
    caller: message.caller,
    quiet: message.quiet ? "true" : "",
    ringFor: message.ringFor,
    ringStartedAt: message.ringStartedAt,
    sentAt: message.sentAt || Date.now(),
  }
}

const NONE = { sent: 0, failed: 0 }

// iPhones: a call push rings through CallKit, once per ring (the phone keeps ringing by itself and asks the server
// whether it still should, so no push stops it). A quiet "call over" sends nothing; a missed call and everything else
// is a notification. skipPhones: call tokens of iPhones showing SynergiFund on screen right now (they ring in the app).
async function toIphones(devices, message, options, skipPhones) {
  if (message.kind === "call") {
    const skip = skipPhones ? await skipPhones : null
    const ringing = skip ? devices.filter((device) => !skip.has(device.token)) : devices
    const started = Number(message.ringStartedAt) || Date.now()
    const ringFor = Number(message.ringFor) || 45000
    return sendApns(ringing, {
      push: "voip",
      payload: { type: "call", callId: message.callId, ringStartedAt: started, ringFor, sentAt: Number(message.sentAt) || Date.now(), caller: message.caller || "", title: message.title, body: message.body || "", media: message.media || "audio" },
      expiresAt: started + ringFor,
      priority: 10,
    })
  }
  if (message.kind === "call-over" && message.quiet) return NONE
  const tag = message.tag || ""
  return sendApns(devices.filter((device) => device.alertToken), {
    push: "alert",
    payload: {
      aps: { alert: { title: message.title, body: message.body || "" }, sound: "default", ...(tag ? { "thread-id": tag } : {}) },
      href: message.href || "/notifications",
      kind: message.kind || "",
      tag,
      ...(message.callId ? { callId: message.callId } : {}),
    },
    expiresAt: Date.now() + (Number(options.TTL) || 3600) * 1000,
    collapseId: tag,
    priority: options.urgency === "high" || ["message", "call-over"].includes(message.kind) ? 10 : 5,
  })
}

// Phones running the app: Android gets data messages (it decides what to show, and skips what the open app already
// shows), iPhones get Apple pushes.
export async function pushToDevices(devices, message, options = {}, skipPhones = null) {
  const android = devices.filter((device) => device.platform !== "ios")
  const iphones = devices.filter((device) => device.platform === "ios")
  const [phones, apple] = await Promise.all([
    android.length && nativePushConfigured()
      ? sendNative(android, nativeData(message), { ttlMs: (Number(options.TTL) || 3600) * 1000, high: options.urgency === "high" || message.kind === "call" })
      : NONE,
    iphones.length && apnsConfigured() ? toIphones(iphones, message, options, skipPhones) : NONE,
  ])
  return { sent: phones.sent + apple.sent, failed: phones.failed + apple.failed }
}

export async function pushToNative(userIds, message, options = {}, skipPhones = null) {
  if (!userIds.length || (!nativePushConfigured() && !apnsConfigured())) return NONE
  const devices = await NativeDevice.find({ userId: { $in: userIds } })
  return pushToDevices(devices, message, options, skipPhones)
}

// skipEndpoints: browsers that already show this in the app right now. skipPhones: a promise of iPhones that do.
export async function pushToUsers(userIds, message, options = {}, skipEndpoints = null, skipPhones = null) {
  if (!userIds.length) return { sent: 0, failed: 0 }
  const native = pushToNative(userIds, message, options, skipPhones).catch((error) => {
    console.error("Phone push failed", error)
    return { sent: 0, failed: 0 }
  })
  let web = { sent: 0, failed: 0 }
  if (configurePush()) {
    const skip = skipEndpoints ? [...skipEndpoints] : []
    const subscriptions = await PushSubscription.find({ userId: { $in: userIds }, ...(skip.length ? { endpoint: { $nin: skip } } : {}) })
    web = await sendPush(subscriptions, message, options)
  }
  const phones = await native
  return { sent: web.sent + phones.sent, failed: web.failed + phones.failed, ...(web.errors ? { errors: web.errors } : {}) }
}
