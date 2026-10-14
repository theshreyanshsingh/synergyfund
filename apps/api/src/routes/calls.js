import { Router } from "express"
import { Call, PushSubscription } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { configurePush, isApplePush, sendPush } from "../services/push.js"
import { presentChannel, usesChat, visibleChannels } from "../services/chat.js"
import { declineCallFor, liveCall, liveCallsFor, network, relayProvider, silenceCallFor } from "../services/calls.js"

export const callsRouter = Router()

callsRouter.use((req, res, next) => {
  if (usesChat(req.user)) return next()
  sendError(res, 403, "Calls are turned off for your account.")
})

// Call history for the conversations this person can see, newest first, plus calls happening now.
callsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = String(req.user._id)
    const visible = await visibleChannels(req.user)
    const channels = new Map(visible.map((entry) => [String(entry.channel._id), entry]))
    // Calls in conversations they can see, plus calls they were added to from outside the conversation.
    const calls = await Call.find({
      $or: [
        { channelId: { $in: visible.map((entry) => entry.channel._id) }, startedBy: req.user._id },
        { invitedIds: req.user._id },
        { "participants.userId": req.user._id },
      ],
    }).sort({ startedAt: -1 }).limit(150)
    const items = calls.map((call) => {
      const entry = channels.get(String(call.channelId))
      const joined = (call.participants || []).some((person) => String(person.userId) === me)
      const ended = call.status === "ended"
      const names = [...new Set((call.participants || []).map((person) => person.name).filter(Boolean))]
      const others = [...new Set([call.startedByName, ...(call.participants || []).filter((person) => String(person.userId) !== me).map((person) => person.name)].filter((name) => name && name !== req.user.name))]
      return {
        id: String(call._id),
        channelId: String(call.channelId),
        channel: entry ? presentChannel(entry.channel, entry.property) : null,
        // For calls someone added them to, the conversation is not theirs; name the people instead.
        title: entry ? "" : others.join(", ") || "Call",
        media: call.media === "video" ? "video" : "audio",
        startedBy: String(call.startedBy),
        startedByName: call.startedByName || "",
        direction: String(call.startedBy) === me ? "outgoing" : "incoming",
        outcome: ended ? call.outcome || "ended" : "live",
        joined,
        declined: !joined && (call.declinedIds || []).some((id) => String(id) === me),
        missed: ended && !joined && (call.invitedIds || []).some((id) => String(id) === me) && !(call.declinedIds || []).some((id) => String(id) === me),
        participants: names,
        seconds: call.answeredAt && call.endedAt ? Math.max(0, Math.round((call.endedAt - call.answeredAt) / 1000)) : 0,
        startedAt: call.startedAt,
        endedAt: call.endedAt || null,
        live: ended ? false : Boolean(liveCall(call._id)),
      }
    })
    res.json({ items, live: await liveCallsFor(req.user) })
  }),
)

// Lets a phone notification's Decline button decline without opening the app.
// The device sends its push address so its own notification is not replaced a second time.
callsRouter.post(
  "/:id/decline",
  asyncHandler(async (req, res) => {
    await declineCallFor(req.user, req.params.id, typeof req.body?.endpoint === "string" ? req.body.endpoint : "")
    res.json({ ok: true })
  }),
)

// The ringing notification was swiped away: stop re-sending it. The call keeps ringing in the app.
callsRouter.post(
  "/:id/silence",
  asyncHandler(async (req, res) => {
    res.json({ ok: silenceCallFor(req.user, req.params.id) })
  }),
)

// Used by the connection test in Settings: which servers calls use, and whether a relay is set up.
callsRouter.get(
  "/network",
  asyncHandler(async (req, res) => {
    res.json({ ...(await network()), provider: relayProvider() })
  }),
)

// Test rings in progress, per person, so Answer, Decline or a new test stops the old one.
const testRings = new Map()
const TEST_RING_MS = 15000

function stopTestRing(userId) {
  for (const timer of testRings.get(userId) || []) clearTimeout(timer)
  testRings.delete(userId)
}

// Settings › App: rings your own devices like a real call for about 15 seconds
// and reports what each push service said to the first notification.
callsRouter.post(
  "/test-notification",
  asyncHandler(async (req, res) => {
    if (!configurePush()) return sendError(res, 503, "Push notifications are not set up on the server (VAPID keys are missing).")
    const subscriptions = await PushSubscription.find({ userId: req.user._id })
    if (!subscriptions.length) return sendError(res, 400, "No device has notifications turned on for your account. Turn them on above, then try again.")
    const me = String(req.user._id)
    stopTestRing(me)
    const startedAt = Date.now()
    const message = {
      kind: "call",
      test: true,
      callId: "test",
      media: "audio",
      tag: "call-test",
      title: "SynergiFund is calling you",
      body: "Test call. It rings like a real call. Tap Answer or Decline to stop it.",
      href: "/settings",
      ringStartedAt: startedAt,
    }
    const result = await sendPush(subscriptions, { ...message, repeat: 0, sentAt: startedAt, ringFor: TEST_RING_MS }, { TTL: 60, urgency: "high" })
    // Ring again on the same schedule as a real call: every 3 seconds, every 5 on Apple devices.
    const timers = []
    for (const [apple, every] of [[false, 3000], [true, 5000]]) {
      const group = subscriptions.filter((subscription) => isApplePush(subscription.endpoint) === apple)
      if (!group.length) continue
      for (let at = every; at < TEST_RING_MS; at += every) {
        timers.push(setTimeout(async () => {
          if (!testRings.has(me)) return
          const fresh = await PushSubscription.find({ _id: { $in: group.map((subscription) => subscription._id) } }).catch(() => [])
          await sendPush(fresh, { ...message, repeat: Math.round(at / every), sentAt: Date.now(), ringFor: TEST_RING_MS - at }, { TTL: Math.ceil((every * 2) / 1000), urgency: "high" }).catch(() => {})
        }, at))
      }
    }
    timers.push(setTimeout(() => testRings.delete(me), TEST_RING_MS))
    testRings.set(me, timers)
    res.json({ devices: subscriptions.length, sent: result.sent, failed: result.failed, errors: result.errors, ringsFor: TEST_RING_MS / 1000 })
  }),
)

// Answer, Decline, a tap or a swipe on the test notification stops the test ringing.
callsRouter.post(
  "/test-notification/stop",
  asyncHandler(async (req, res) => {
    stopTestRing(String(req.user._id))
    res.json({ ok: true })
  }),
)
