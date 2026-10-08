import { Router } from "express"
import webpush from "web-push"
import { Notification, PushSubscription, User } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { recordActivity } from "../services/notify.js"

export const pushRouter = Router()

pushRouter.get(
  "/vapid-public-key",
  asyncHandler(async (req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || ""
    if (!publicKey || !process.env.VAPID_PRIVATE_KEY) {
      sendError(res, 503, "Push notifications are not configured yet.")
      return
    }
    res.json({ publicKey })
  }),
)

pushRouter.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const endpoint = String(req.body?.endpoint || "")
    const p256dh = String(req.body?.keys?.p256dh || "")
    const auth = String(req.body?.keys?.auth || "")
    if (!endpoint || !p256dh || !auth) {
      sendError(res, 400, "This browser did not provide a notification subscription.")
      return
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { userId: req.user._id, endpoint, p256dh, auth },
      { upsert: true, setDefaultsOnInsert: true },
    )
    res.json({ ok: true })
  }),
)

pushRouter.delete(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const endpoint = String(req.body?.endpoint || "")
    if (endpoint) await PushSubscription.deleteOne({ endpoint, userId: req.user._id })
    res.json({ ok: true })
  }),
)

pushRouter.post(
  "/send",
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") {
      sendError(res, 403, "Only an admin can send a push notification.")
      return
    }
    const title = String(req.body?.title || "").trim()
    const body = String(req.body?.body || "").trim()
    const requestedHref = String(req.body?.href || "/notifications").trim()
    const href = requestedHref.startsWith("/") && !requestedHref.startsWith("//") ? requestedHref : "/notifications"
    if (!title) {
      sendError(res, 400, "Write a title for the notification.")
      return
    }
    if (!configurePush()) {
      sendError(res, 503, "Push notifications are not configured yet.")
      return
    }
    const subscriptions = await PushSubscription.find()
    if (!subscriptions.length) {
      sendError(res, 400, "Nobody has turned on notifications yet.")
      return
    }
    const userIds = [...new Set(subscriptions.map((item) => String(item.userId)))]
    const people = await User.find({ _id: { $in: userIds } }).select("_id")
    if (people.length) {
      await Notification.insertMany(people.map((person) => ({
        userId: person._id,
        title,
        body,
        href,
        event: "push.sent",
      })))
    }
    const payload = JSON.stringify({ title, body, href })
    let sent = 0
    let failed = 0
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload)
        sent += 1
      } catch (error) {
        failed += 1
        if (error.statusCode === 404 || error.statusCode === 410) await subscription.deleteOne()
      }
    }
    await recordActivity({ user: req.user, title: "Push notification sent", detail: title })
    res.json({ sent, failed })
  }),
)

function configurePush() {
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@synergifund.com"
  const publicKey = process.env.VAPID_PUBLIC_KEY || ""
  const privateKey = process.env.VAPID_PRIVATE_KEY || ""
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  return true
}
