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

export async function sendPush(subscriptions, { title, body, href }) {
  const payload = JSON.stringify({ title, body, href: href || "/notifications" })
  let sent = 0
  let failed = 0
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload)
      sent += 1
    } catch (error) {
      failed += 1
      if (error.statusCode === 404 || error.statusCode === 410) await subscription.deleteOne().catch(() => {})
    }
  }
  return { sent, failed }
}

export async function pushToUsers(userIds, message) {
  if (!userIds.length || !configurePush()) return { sent: 0, failed: 0 }
  const subscriptions = await PushSubscription.find({ userId: { $in: userIds } })
  return sendPush(subscriptions, message)
}
