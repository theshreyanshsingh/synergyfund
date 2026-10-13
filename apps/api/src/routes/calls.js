import { Router } from "express"
import { Call } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { presentChannel, usesChat, visibleChannels } from "../services/chat.js"
import { declineCallFor, liveCall, liveCallsFor } from "../services/calls.js"

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
