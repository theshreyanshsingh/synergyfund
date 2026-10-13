import { Router } from "express"
import { Call, PushSubscription } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { configurePush, sendPush } from "../services/push.js"
import { presentChannel, usesChat, visibleChannels } from "../services/chat.js"
import { declineCallFor, liveCall, liveCallsFor, network, relayProvider } from "../services/calls.js"

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
callsRouter.post(
  "/:id/decline",
  asyncHandler(async (req, res) => {
    await declineCallFor(req.user, req.params.id)
    res.json({ ok: true })
  }),
)

// Used by the connection test in Settings: which servers calls use, and whether a relay is set up.
callsRouter.get(
  "/network",
  asyncHandler(async (req, res) => {
    res.json({ ...(await network()), provider: relayProvider() })
  }),
)

// Settings › App: sends a call-style notification to your own devices and reports what each push service said.
callsRouter.post(
  "/test-notification",
  asyncHandler(async (req, res) => {
    if (!configurePush()) return sendError(res, 503, "Push notifications are not set up on the server (VAPID keys are missing).")
    const subscriptions = await PushSubscription.find({ userId: req.user._id })
    if (!subscriptions.length) return sendError(res, 400, "No device has notifications turned on for your account. Turn them on above, then try again.")
    const result = await sendPush(subscriptions, {
      kind: "call",
      test: true,
      callId: "test",
      media: "audio",
      tag: "call-test",
      title: "SynergiFund is calling you",
      body: "Test call notification. If you can see this, calls will ring here.",
      href: "/settings",
    }, { TTL: 60, urgency: "high" })
    res.json({ devices: subscriptions.length, sent: result.sent, failed: result.failed, errors: result.errors })
  }),
)
