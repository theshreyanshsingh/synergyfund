import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { Router } from "express"
import { NativeDevice, Notification, PushSubscription, User } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { recordActivity } from "../services/notify.js"
import { configurePush, sendPush } from "../services/push.js"
import { declineCallFor } from "../services/calls.js"
import { nativePushConfigured, sendNative } from "../services/fcm.js"

export const pushRouter = Router()

const hashKey = (key) => createHash("sha256").update(String(key)).digest("hex")
const cleanToken = (value) => {
  const token = String(value || "").trim()
  return token.length >= 20 && token.length <= 4096 && !/\s/.test(token) ? token : ""
}

// The Android app registers this phone's push address for the signed-in person (it moves to them if someone else
// used the phone before). The reply is the phone's own key, for Decline from the lock screen.
pushRouter.post(
  "/native",
  asyncHandler(async (req, res) => {
    const token = cleanToken(req.body?.token)
    if (!token) {
      sendError(res, 400, "This phone did not give a push address.")
      return
    }
    const deviceKey = randomBytes(24).toString("base64url")
    await NativeDevice.findOneAndUpdate(
      { token },
      { userId: req.user._id, token, platform: String(req.body?.platform || "android").slice(0, 20), keyHash: hashKey(deviceKey), appVersion: String(req.body?.appVersion || "").slice(0, 40), lastSeenAt: new Date() },
      { upsert: true, setDefaultsOnInsert: true },
    )
    res.json({ ok: true, deviceKey })
  }),
)

// Signing out on the phone: it stops getting this person's calls and messages.
pushRouter.delete(
  "/native",
  asyncHandler(async (req, res) => {
    const token = cleanToken(req.body?.token)
    if (token) await NativeDevice.deleteOne({ token, userId: req.user._id })
    res.json({ ok: true })
  }),
)

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
    await recordActivity({ user: req.user, title: "Notifications turned on", detail: "On this device" })
    res.json({ ok: true })
  }),
)

pushRouter.delete(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const endpoint = String(req.body?.endpoint || "")
    if (endpoint) await PushSubscription.deleteOne({ endpoint, userId: req.user._id })
    await recordActivity({ user: req.user, title: "Notifications turned off", detail: "On this device" })
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
    const webReady = configurePush()
    const phonesReady = nativePushConfigured()
    if (!webReady && !phonesReady) {
      sendError(res, 503, "Push notifications are not configured yet.")
      return
    }
    // Browsers with notifications on, and phones with the app.
    const subscriptions = webReady ? await PushSubscription.find() : []
    const phones = phonesReady ? await NativeDevice.find() : []
    if (!subscriptions.length && !phones.length) {
      sendError(res, 400, "Nobody has turned on notifications yet.")
      return
    }
    const userIds = [...new Set([...subscriptions, ...phones].map((item) => String(item.userId)))]
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
    const web = await sendPush(subscriptions, { title, body, href })
    const phone = await sendNative(phones, { type: "alert", kind: "notice", title, body, href, sentAt: Date.now() }).catch(() => ({ sent: 0, failed: phones.length }))
    const sent = web.sent + phone.sent
    const failed = web.failed + phone.failed
    await recordActivity({ user: req.user, title: "Push notification sent", detail: title })
    res.json({ sent, failed })
  }),
)

// Decline from the ringing notification or the call screen on a locked phone: no sign-in cookie there, so the phone
// proves itself with its push address and its own key. Mounted outside the signed-in routes.
export const nativeDecline = asyncHandler(async (req, res) => {
  const token = cleanToken(req.body?.token)
  const key = String(req.body?.deviceKey || "")
  const callId = String(req.body?.callId || "").trim()
  const device = token && key ? await NativeDevice.findOne({ token }) : null
  const given = Buffer.from(hashKey(key))
  const stored = Buffer.from(device?.keyHash || "")
  if (!device || given.length !== stored.length || !timingSafeEqual(given, stored)) {
    sendError(res, 401, "This phone is not signed in.")
    return
  }
  const user = await User.findById(device.userId)
  if (!user || !callId) {
    sendError(res, 404, "That call was not found.")
    return
  }
  await declineCallFor(user, callId)
  res.json({ ok: true })
})
