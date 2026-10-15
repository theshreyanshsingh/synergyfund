import { Router } from "express"
import mongoose from "mongoose"
import multer from "multer"
import { Call, CallNote, ChatChannel, ChatMessage, PushSubscription } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { configurePush, isApplePush, sendPush } from "../services/push.js"
import { audience, presentChannel, presentMessage, propertyFor, usesChat, visibleChannels } from "../services/chat.js"
import { declineCallFor, liveCall, liveCallsFor, network, relayProvider, silenceCallFor } from "../services/calls.js"
import { emitToUsers } from "../services/chatHub.js"
import { recordActivity } from "../services/notify.js"
import { MAX_PIECE_BYTES, acceptPiece, presentNote, retryNotes } from "../services/callNotes.js"

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
    // AI notes taken on these calls, that this person may open.
    const notes = await CallNote.find({ callId: { $in: calls.map((call) => call._id) } }).select("callId channelId status title participants onAt").sort({ onAt: 1 })
    const notesByCall = new Map()
    for (const note of notes) {
      if (!channels.has(String(note.channelId)) && !note.participants.some((person) => String(person.userId) === me)) continue
      const list = notesByCall.get(String(note.callId)) || []
      list.push({ id: String(note._id), status: note.status, title: note.title || "" })
      notesByCall.set(String(note.callId), list)
    }
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
        notes: notesByCall.get(String(call._id)) || [],
      }
    })
    res.json({ items, live: await liveCallsFor(req.user) })
  }),
)

// AI notes: open to the people who were on the call and to everyone who can see the conversation it was in
// (they are posted there).
async function openNote(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendError(res, 404, "Those call notes were not found.")
    return null
  }
  const note = await CallNote.findById(req.params.id)
  if (!note) {
    sendError(res, 404, "Those call notes were not found.")
    return null
  }
  const me = String(req.user._id)
  if (note.participants.some((person) => String(person.userId) === me)) return note
  const visible = await visibleChannels(req.user)
  if (visible.some((entry) => String(entry.channel._id) === String(note.channelId))) return note
  sendError(res, 404, "Those call notes were not found.")
  return null
}

const notesUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PIECE_BYTES, files: 1 } })

// A piece of someone's own speech while AI notes are on (a short WAV file), transcribed and then thrown away.
callsRouter.post(
  "/notes/:id/audio",
  (req, res, next) => notesUpload.single("audio")(req, res, (error) => (error ? sendError(res, 413, "That piece of audio is too long.") : next())),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 404, "Those call notes were not found.")
    const audio = req.file?.buffer
    if (!audio || audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return sendError(res, 400, "Send the audio as a WAV file.")
    const result = await acceptPiece({ user: req.user, noteId: req.params.id, audio, durationMs: req.body?.durationMs, endedAgoMs: req.body?.endedAgoMs })
    if (result.error) return sendError(res, result.status, result.error)
    res.status(202).json({ ok: true })
  }),
)

callsRouter.get(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const note = await openNote(req, res)
    if (!note) return
    const me = String(req.user._id)
    res.json({ note: { ...presentNote(note, { full: true }), canManage: req.user.role === "admin" || String(note.startedBy) === me } })
  }),
)

// Write the notes again after the AI model failed.
callsRouter.post(
  "/notes/:id/retry",
  asyncHandler(async (req, res) => {
    const note = await openNote(req, res)
    if (!note) return
    if (note.status !== "failed") return sendError(res, 400, "These notes are not waiting to be written again.")
    const started = await retryNotes(note._id)
    const fresh = await CallNote.findById(note._id)
    const me = String(req.user._id)
    res.json({ ok: started, note: { ...presentNote(fresh, { full: true }), canManage: req.user.role === "admin" || String(fresh.startedBy) === me } })
  }),
)

// Whoever turned the notes on, or an admin, can delete them (and their post in the conversation).
callsRouter.delete(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const note = await openNote(req, res)
    if (!note) return
    if (req.user.role !== "admin" && String(note.startedBy) !== String(req.user._id)) return sendError(res, 403, "Only whoever turned these notes on, or an admin, can delete them.")
    if (note.status === "recording" || note.status === "writing") return sendError(res, 409, "These notes are still being taken. Turn AI notes off first.")
    // Their card in the conversation goes too, for everyone looking at it.
    const message = note.messageId ? await ChatMessage.findByIdAndUpdate(note.messageId, { $set: { deletedAt: new Date(), text: "" } }, { new: true }) : null
    if (message) {
      const channel = await ChatChannel.findById(message.channelId)
      if (channel) {
        const people = await audience(channel, await propertyFor(channel)).catch(() => [])
        emitToUsers(people.map((person) => String(person._id)), "message:update", { message: presentMessage(message) })
      }
    }
    await note.deleteOne()
    await recordActivity({ user: req.user, title: "Call notes deleted", detail: note.title || "AI notes" })
    res.json({ ok: true })
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
