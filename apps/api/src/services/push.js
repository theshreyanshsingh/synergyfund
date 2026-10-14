import webpush from "web-push"
import { PushSubscription } from "../models/index.js"

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

// skipEndpoints: devices that already show this in the app right now.
export async function pushToUsers(userIds, message, options = {}, skipEndpoints = null) {
  if (!userIds.length || !configurePush()) return { sent: 0, failed: 0 }
  const skip = skipEndpoints ? [...skipEndpoints] : []
  const subscriptions = await PushSubscription.find({ userId: { $in: userIds }, ...(skip.length ? { endpoint: { $nin: skip } } : {}) })
  return sendPush(subscriptions, message, options)
}
