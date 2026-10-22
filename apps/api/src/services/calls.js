import { randomBytes } from "node:crypto"
import mongoose from "mongoose"
import { Call, ChatChannel, ChatMessage, ChatRead, Notification, User } from "../models/index.js"
import { audience, hasMemberList, isGuest, loadChannel, presentChannel, presentMessage, usesChat, visibleChannels } from "./chat.js"
import { chatIo, emitToUsers } from "./chatHub.js"
import { isApplePush, pushToUsers, sendPush, subscriptionsFor } from "./push.js"
import { addNoteParticipant, notesAvailable, startNotes, stopNotes } from "./callNotes.js"

// Everyone in a call connects to everyone else (a mesh), which stays smooth up to about eight people.
export const MAX_PEERS = 8
const RING_MS = Number(process.env.CALL_RING_MS) || 45000
// Big public channels show a "Join" button instead of ringing everybody.
const RING_LIMIT = 12

// A push notification chimes once, so a ringing phone gets the same notification again every few seconds
// (same tag, so it replaces itself and alerts again) until the person answers, declines or the call stops ringing.
// Apple may drop pushes that come too often, so iPhones, iPads and Safari get one every 5 seconds.
const REPEAT_MS = Math.max(2000, Number(process.env.CALL_REPEAT_MS) || 3000)
const APPLE_REPEAT_MS = Math.max(REPEAT_MS, Number(process.env.CALL_APPLE_REPEAT_MS) || 5000)
const REPEAT_FOR_MS = Math.min(RING_MS, Number(process.env.CALL_REPEAT_FOR_MS) || 30000)

// Seconds a dropped connection keeps its place before the person counts as gone.
const AWAY_MS = Number(process.env.CALL_AWAY_MS) || 20000

const live = new Map()
// channelId -> callId, or a promise while a call there is being created.
const byChannel = new Map()
const starting = new Set()

// How browsers find each other. STUN works on most networks; mobile data and many offices and routers
// block direct connections, and then only a relay (TURN) can carry the call.
// Cloudflare TURN: set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN (short-lived logins are made here).
// Any other TURN server: set TURN_URLS, TURN_USERNAME and TURN_CREDENTIAL.
let cloudflareTurn = { servers: null, until: 0, pending: null, failedAt: 0 }

async function cloudflareServers() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN
  if (!keyId || !token) return []
  const now = Date.now()
  if (cloudflareTurn.servers && cloudflareTurn.until - now > 3600 * 1000) return cloudflareTurn.servers
  if (cloudflareTurn.pending) return cloudflareTurn.pending
  // After a failure, wait a minute before asking Cloudflare again, but keep using older logins if they still work.
  if (now - cloudflareTurn.failedAt < 60000) return cloudflareTurn.until > now ? cloudflareTurn.servers || [] : []
  const ttl = 24 * 3600
  cloudflareTurn.pending = (async () => {
    try {
      const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new Error(`Cloudflare TURN answered ${response.status}`)
      const data = await response.json()
      const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : []
      // Browsers handle port 53 badly, so those addresses are left out, as Cloudflare recommends.
      const servers = list.map((server) => ({ ...server, urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => url && !/:53(\?|$)/.test(url)) })).filter((server) => server.urls.length)
      cloudflareTurn = { servers, until: Date.now() + ttl * 1000, pending: null, failedAt: 0 }
      return servers
    } catch (error) {
      console.error("Cloudflare TURN login failed", error.message)
      cloudflareTurn.failedAt = Date.now()
      cloudflareTurn.pending = null
      return cloudflareTurn.until > Date.now() ? cloudflareTurn.servers || [] : []
    }
  })()
  return cloudflareTurn.pending
}

export async function iceServers() {
  const stun = String(process.env.CALL_STUN_URLS || "stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302")
    .split(",").map((url) => url.trim()).filter(Boolean)
  const servers = stun.length ? [{ urls: stun }] : []
  const turn = String(process.env.TURN_URLS || process.env.TURN_URL || "").split(",").map((url) => url.trim()).filter(Boolean)
  if (turn.length) servers.push({ urls: turn, username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" })
  servers.push(...(await cloudflareServers()))
  return servers
}

function hasRelay(servers) {
  return servers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/.test(String(url))))
}

export async function network() {
  const servers = await iceServers()
  return { iceServers: servers, relay: hasRelay(servers) }
}

export function relayProvider() {
  if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) return "cloudflare"
  if (process.env.TURN_URLS || process.env.TURN_URL) return "custom"
  return "none"
}

// After a restart nobody is connected any more. Close those calls with the time they were last touched,
// not the boot time, so history does not show calls lasting all night.
export async function closeStaleCalls() {
  await Call.updateMany(
    { status: { $in: ["ringing", "active"] } },
    [{
      $set: {
        status: "ended",
        endedAt: "$updatedAt",
        outcome: { $cond: [{ $ifNull: ["$answeredAt", false] }, "completed", "missed"] },
        participants: { $map: { input: { $ifNull: ["$participants", []] }, as: "person", in: { $mergeObjects: ["$$person", { leftAt: { $ifNull: ["$$person.leftAt", "$updatedAt"] } }] } } },
      },
    }],
  )
}

function summary(state) {
  return {
    id: state.id,
    channelId: state.channelId,
    channel: state.channel,
    media: state.media,
    startedBy: state.startedBy,
    startedByName: state.startedByName,
    startedAt: state.startedAt,
    answered: state.answered,
    ringing: Boolean(state.ringTimer) && !state.answered,
    participants: [...state.peers.values()].map((peer) => ({ userId: peer.userId, name: peer.name })),
    names: state.names,
    max: MAX_PEERS,
    // AI notes: on (who turned them on, and when) or null; and whether this server can take them at all.
    notes: state.notes ? { id: state.notes.id, byName: state.notes.byName, since: state.notes.since } : null,
    notesReady: notesAvailable(),
  }
}

function peerList(state, except = "") {
  return [...state.peers.entries()].filter(([peerId]) => peerId !== except).map(([peerId, peer]) => ({ peerId, userId: peer.userId, name: peer.name, audio: peer.audio, video: peer.video, screen: peer.screen }))
}

function toPeers(state, event, payload, except = "") {
  const io = chatIo()
  if (!io) return
  for (const peerId of state.peers.keys()) if (peerId !== except) io.to(peerId).emit(event, payload)
}

function announce(state, ended = false) {
  if (!ended && !live.has(state.id)) return
  emitToUsers(state.audienceIds, "call:update", { channelId: state.channelId, call: ended ? null : summary(state) })
}

// People briefly disconnected still count as in the call, so a network blip does not end it.
function inCall(state, userId) {
  if (state.away.has(userId)) return true
  for (const peer of state.peers.values()) if (peer.userId === userId) return true
  return false
}

function userInCall(userId) {
  if (starting.has(userId)) return "starting"
  for (const state of live.values()) if (inCall(state, userId)) return state
  return null
}

function present(state) {
  const people = new Set([...state.peers.values()].map((peer) => peer.userId))
  for (const userId of state.away.keys()) people.add(userId)
  return people.size
}

function duration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`
}

async function postCallNote(state, outcome) {
  const found = await ChatChannel.findById(state.channelObjectId)
  if (!found || found.archivedAt) return
  const kind = state.media === "video" ? "video" : "voice"
  const text = outcome === "completed"
    ? `${kind === "video" ? "Video" : "Voice"} call · ${duration(Date.now() - state.answeredAt)}`
    : outcome === "declined"
      ? `${kind === "video" ? "Video" : "Voice"} call declined`
      : `Missed ${kind} call`
  const message = await ChatMessage.create({ channelId: state.channelObjectId, userId: state.startedBy, userName: state.startedByName, kind: "call", text })
  await ChatChannel.updateOne({ _id: state.channelObjectId }, { $max: { lastMessageAt: message.createdAt } })
  // People who took part already know about the call, so the note does not count as unread for them.
  const joined = [...state.joinedIds]
  if (joined.length) {
    await ChatRead.bulkWrite(joined.map((userId) => ({
      updateOne: { filter: { userId: new mongoose.Types.ObjectId(userId), channelId: state.channelObjectId }, update: { $max: { lastReadAt: message.createdAt } }, upsert: true },
    })), { ordered: false }).catch(() => {})
    for (const userId of joined) emitToUsers([userId], "read", { channelId: state.channelId, lastReadAt: message.createdAt })
  }
  const people = await audience(found, state.property).catch(() => null)
  const ids = people ? people.map((person) => String(person._id)) : state.audienceIds
  const payload = { message: presentMessage(message), channel: presentChannel(found, state.property) }
  // People who were on the call get it as already read: no chime and no unread badge.
  const took = new Set(joined)
  emitToUsers(ids.filter((id) => !took.has(id)), "message:new", payload)
  if (took.size) emitToUsers(ids.filter((id) => took.has(id)), "message:new", { ...payload, read: true })
}

async function endCall(state, reason) {
  if (!live.has(state.id)) return
  live.delete(state.id)
  if (byChannel.get(state.channelId) === state.id) byChannel.delete(state.channelId)
  clearTimeout(state.ringTimer)
  state.ringTimer = null
  for (const timer of state.away.values()) clearTimeout(timer)
  state.away.clear()
  for (const timer of state.ringing.values()) clearTimeout(timer)
  state.ringing.clear()
  stopRepeats(state)
  const outcome = state.answered ? "completed" : reason === "declined" ? "declined" : "missed"
  // AI notes stop with the call and are written up.
  if (state.notes) {
    const noteId = state.notes.id
    state.notes = null
    // Stopped before anyone is told the call ended, so the last words they send are counted.
    await stopNotes(noteId).catch((error) => console.error("Call notes: stopping failed", error))
  }
  pushCallOver(state).catch(() => {})
  recordMissed(state).catch((error) => console.error("Missed call note failed", error))
  const io = chatIo()
  for (const peerId of state.peers.keys()) io?.to(peerId).emit("call:ended", { callId: state.id, reason, outcome })
  emitToUsers(state.invitedIds, "call:ring-stop", { callId: state.id })
  announce(state, true)
  const endedAt = new Date()
  await Call.updateOne(
    { _id: state.id },
    { $set: { status: "ended", outcome, endedAt, "participants.$[open].leftAt": endedAt } },
    { arrayFilters: [{ "open.leftAt": null }] },
  ).catch((error) => console.error("Call close failed", error))
  await postCallNote(state, outcome).catch((error) => console.error("Call note failed", error))
}

// The call ends when nobody is left, or for a one-to-one call once either person has gone.
async function settle(state) {
  if (!live.has(state.id)) return
  const oneToOne = state.channel.kind === "direct" && state.invitedIds.length === 1
  const count = present(state)
  if (!count || (oneToOne && state.answered && count < 2)) {
    await endCall(state, state.answered ? "ended" : "cancelled")
    return
  }
  announce(state)
}

async function removePeer(state, peerId, { away = false, moving = false } = {}) {
  const peer = state.peers.get(peerId)
  if (!peer) return
  state.peers.delete(peerId)
  toPeers(state, "call:peer-left", { callId: state.id, peerId })
  if (moving) return
  const stillHere = [...state.peers.values()].some((other) => other.userId === peer.userId)
  if (away && !stillHere && live.has(state.id)) {
    // Keep their place for a short time; if they reconnect they rejoin the same call.
    clearTimeout(state.away.get(peer.userId))
    state.away.set(peer.userId, setTimeout(() => {
      state.away.delete(peer.userId)
      markLeft(state, peer.userId)
      settle(state).catch((error) => console.error("Call settle failed", error))
    }, AWAY_MS))
    announce(state)
    return
  }
  if (!stillHere) markLeft(state, peer.userId)
  await settle(state)
}

function markLeft(state, userId) {
  Call.updateOne(
    { _id: state.id },
    { $set: { "participants.$[mine].leftAt": new Date() } },
    { arrayFilters: [{ "mine.userId": new mongoose.Types.ObjectId(userId), "mine.leftAt": null }] },
  ).catch(() => {})
}

function ringUntil(state) {
  // Rooms that show a Join button instead of ringing have no "missed" timeout.
  if (!state.invitedIds.length) return
  state.ringTimer = setTimeout(() => {
    state.ringTimer = null
    if (!live.has(state.id)) return
    if (!state.answered) endCall(state, "missed").catch((error) => console.error("Call end failed", error))
    else announce(state)
  }, RING_MS)
}

// Each invited person rings for RING_MS, including people added later in the call.
function ringPeople(state, userIds, invitedBy) {
  const fresh = userIds.filter((userId) => !inCall(state, userId))
  const now = Date.now()
  for (const userId of fresh) {
    clearTimeout(state.ringing.get(userId))
    state.declined.delete(userId)
    state.silenced.delete(userId)
    state.finalPushed.delete(userId)
    state.ringStarted.set(userId, now)
    state.ringing.set(userId, setTimeout(() => {
      state.ringing.delete(userId)
      state.ringStarted.delete(userId)
      stopRepeats(state, userId)
      emitToUsers([userId], "call:ring-stop", { callId: state.id })
      // Rang out while the call goes on without them: their phone shows "Missed call" now, not when the call ends.
      if (live.has(state.id) && state.answered && !inCall(state, userId) && !state.declined.has(userId)) {
        pushMissedNow(state, userId).catch((error) => console.error("Missed call push failed", error))
      }
    }, RING_MS))
  }
  if (!fresh.length) return
  emitToUsers(fresh, "call:ring", { call: summary(state), invitedBy: invitedBy || "" })
  pushRing(state, fresh, invitedBy, now).catch((error) => console.error("Call push failed", error))
}

// Stops this person's ringing. After they answer or decline on one device, their other devices
// get a quiet notification that replaces the ringing one (the device that acted is skipped).
function stopRinging(state, userId, { reason = "", endpoint = "" } = {}) {
  const wasRinging = state.ringing.has(userId)
  clearTimeout(state.ringing.get(userId))
  state.ringing.delete(userId)
  state.ringStarted.delete(userId)
  stopRepeats(state, userId)
  emitToUsers([userId], "call:ring-stop", { callId: state.id })
  if (reason && wasRinging && state.pushed.has(userId)) {
    pushRingStopped(state, userId, reason, endpoint).catch((error) => console.error("Call push failed", error))
  }
}

function placeName(state) {
  if (state.channel.kind === "direct") return ""
  return state.channel.kind === "property" ? state.channel.name : `#${state.channel.name}`
}

// Every device with notifications on rings with "Name is calling you", like a phone,
// even if SynergiFund is open somewhere else (that screen also shows the ringing card).
async function pushRing(state, userIds, invitedBy, startedAt) {
  if (!userIds.length) return
  for (const userId of userIds) state.pushed.add(userId)
  const place = placeName(state)
  const kind = state.media === "video" ? "video" : "voice"
  const added = invitedBy && invitedBy !== state.startedByName
  const message = {
    kind: "call",
    callId: state.id,
    media: state.media,
    caller: added ? invitedBy : state.startedByName,
    tag: `call-${state.id}`,
    title: added ? `${invitedBy} is adding you to a ${kind} call` : `${state.startedByName} is calling you`,
    body: `${kind === "video" ? "Video" : "Voice"} call${added ? ` with ${state.startedByName}` : ""}${place ? ` · ${place}` : ""}`,
    href: `/calls?join=${state.id}`,
    // When this ring began, so a device can tell a new ring from a late copy of one that already stopped.
    ringStartedAt: startedAt,
  }
  for (const userId of userIds) {
    state.ringMessages.set(userId, message)
    startRepeats(state, userId)
  }
  // Every device gets the call notification. The server cannot know for sure whether a phone app was just closed,
  // so the device decides: only a computer with SynergiFund open and in focus skips it (it already shows the ringing card).
  await pushToUsers(userIds, { ...message, repeat: 0, sentAt: Date.now(), ringFor: RING_MS }, {
    TTL: Math.max(60, Math.round(RING_MS / 1000)),
    urgency: "high",
    // No "Topic" header: Apple's push service (iPhone, Safari) refuses every push that has one.
    // The notification tag already makes "Missed call" replace the ringing notification on the device.
  })
}

// Each ringing person gets two loops: one for their Apple devices and one for the rest (Chrome, Edge, Firefox, Android),
// each starting from that person's own first ring, so someone added later rings at the same steady pace.
function startRepeats(state, userId) {
  stopRepeats(state, userId)
  const timers = { other: null, apple: null }
  state.repeats.set(userId, timers)
  for (const apple of [false, true]) {
    const key = apple ? "apple" : "other"
    const every = apple ? APPLE_REPEAT_MS : REPEAT_MS
    const tick = async () => {
      if (state.repeats.get(userId) !== timers) return
      if (!keepsRinging(state, userId)) {
        timers[key] = null
        return
      }
      timers[key] = "sending"
      try {
        await repeatRing(state, userId, apple, every)
      } catch (error) {
        console.error("Call push failed", error)
      }
      // A newer ring for this person, or the end of the call, replaced these loops while sending.
      if (state.repeats.get(userId) !== timers) return
      timers[key] = keepsRinging(state, userId) ? setTimeout(tick, every) : null
    }
    timers[key] = setTimeout(tick, every)
  }
}

// One person's loops, or everyone's.
function stopRepeats(state, userId = null) {
  for (const id of userId ? [userId] : [...state.repeats.keys()]) {
    const timers = state.repeats.get(id)
    if (!timers) continue
    for (const timer of Object.values(timers)) if (timer && timer !== "sending") clearTimeout(timer)
    state.repeats.delete(id)
  }
}

function keepsRinging(state, userId) {
  const started = state.ringStarted.get(userId)
  return Boolean(live.has(state.id) && started && state.ringing.has(userId) && Date.now() - started < REPEAT_FOR_MS
    && !state.silenced.has(userId) && !state.declined.has(userId) && !inCall(state, userId) && state.audienceIds.includes(userId))
}

// Sends this person's ringing notification again to their Apple devices, or to their other devices.
async function repeatRing(state, userId, apple, every) {
  const message = state.ringMessages.get(userId)
  if (!message) return
  const subscriptions = (await subscriptionsFor([userId])).filter((subscription) => isApplePush(subscription.endpoint) === apple)
  // Checked again: they may have answered while the devices were being looked up.
  if (!subscriptions.length || !keepsRinging(state, userId)) return
  const started = state.ringStarted.get(userId)
  const now = Date.now()
  // A short life: if the device is offline, an old repeat is dropped instead of buzzing late.
  await sendPush(subscriptions, { ...message, repeat: Math.max(1, Math.round((now - started) / every)), sentAt: now, ringFor: Math.max(1000, RING_MS - (now - started)) }, { TTL: Math.max(5, Math.ceil((every * 2) / 1000)), urgency: "high" })
}

// Missed calls also land in the Notifications list.
async function recordMissed(state) {
  const missed = state.invitedIds.filter((userId) => !state.joinedIds.has(userId) && !state.declined.has(userId))
  if (!missed.length) return
  const kind = state.media === "video" ? "video" : "voice"
  const place = placeName(state)
  await Notification.insertMany(missed.map((userId) => ({
    userId: new mongoose.Types.ObjectId(userId),
    title: `Missed ${kind} call from ${state.startedByName}`,
    body: place ? `In ${place}` : "",
    href: "/calls",
    event: "call.missed",
  })))
  emitToUsers(missed, "notification:new", { title: `Missed ${kind} call from ${state.startedByName}`, href: "/calls" })
}

// Replaces the ringing notification on phones once the call is over.
async function pushCallOver(state) {
  const people = [...state.pushed]
  if (!people.length) return
  const kind = state.media === "video" ? "video" : "voice"
  const notJoined = people.filter((userId) => !state.joinedIds.has(userId) && !state.declined.has(userId))
  // People whose phone already said "Missed call" when their own ringing ran out are not told twice.
  const missed = notJoined.filter((userId) => !state.finalPushed.has(userId))
  const done = people.filter((userId) => !notJoined.includes(userId))
  const place = placeName(state)
  const options = { TTL: 24 * 3600, urgency: "normal" }
  const at = Date.now()
  if (missed.length) {
    await pushToUsers(missed, { kind: "call-over", at, callId: state.id, tag: `call-${state.id}`, title: `Missed ${kind} call from ${state.startedByName}`, body: place || "Tap to call back", href: "/calls" }, options)
  }
  if (done.length) {
    // Replace the ringing notification on every device that got one.
    await pushToUsers(done, { kind: "call-over", at, quiet: true, callId: state.id, tag: `call-${state.id}`, title: `${kind === "video" ? "Video" : "Voice"} call ended`, body: `${state.startedByName}${place ? ` · ${place}` : ""}`, href: "/calls" }, options)
  }
}

// Someone's ringing ran out while the others carry on talking.
async function pushMissedNow(state, userId) {
  if (!state.pushed.has(userId)) return
  state.finalPushed.add(userId)
  const kind = state.media === "video" ? "video" : "voice"
  const place = placeName(state)
  await pushToUsers([userId], { kind: "call-over", at: Date.now(), callId: state.id, tag: `call-${state.id}`, title: `Missed ${kind} call from ${state.startedByName}`, body: place ? `${place} · the call is still going` : "The call is still going. Open it to join.", href: `/calls?join=${state.id}` }, { TTL: 24 * 3600, urgency: "normal" })
}

// Answered or declined on one device: the person's other devices stop showing "is calling you".
async function pushRingStopped(state, userId, reason, endpoint) {
  const kind = state.media === "video" ? "Video" : "Voice"
  const place = placeName(state)
  const title = reason === "answered" ? "Answered on another device" : "Call declined"
  await pushToUsers([userId], { kind: "call-over", at: Date.now(), quiet: true, callId: state.id, tag: `call-${state.id}`, title, body: `${kind} call · ${state.startedByName}${place ? ` · ${place}` : ""}`, href: "/calls" }, { TTL: 3600, urgency: "normal" }, endpoint ? [endpoint] : null)
}

// In a call by being part of the conversation, by being added by someone in the call, or by holding its link.
async function mayJoin(user, state, key = "") {
  if (state.guestIds.has(String(user._id))) return usesChat(user)
  if (await loadChannel(user, state.channelId)) return true
  if (key && state.shareKey && key === state.shareKey && usesChat(user)) {
    state.guestIds.add(String(user._id))
    if (!state.audienceIds.includes(String(user._id))) state.audienceIds.push(String(user._id))
    return true
  }
  return false
}

export async function declineCallFor(user, callId, endpoint = "") {
  const me = String(user._id)
  const state = live.get(cleanId(callId))
  if (!state || !state.invitedIds.includes(me) || inCall(state, me)) return false
  state.declined.add(me)
  const waiting = state.invitedIds.filter((id) => !state.declined.has(id) && !state.joinedIds.has(id))
  const ends = !state.answered && !waiting.length
  // When declining ends the call, the "call ended" notification replaces the ringing one everywhere instead.
  stopRinging(state, me, ends ? {} : { reason: "declined", endpoint: cleanEndpoint(endpoint) })
  Call.updateOne({ _id: state.id }, { $addToSet: { declinedIds: user._id } }).catch(() => {})
  if (ends) await endCall(state, "declined")
  return true
}

// The ringing notification was swiped away on a device: stop sending it again, but keep the call ringing in the app.
export function silenceCallFor(user, callId) {
  const state = live.get(cleanId(callId))
  const me = String(user._id)
  if (!state || !state.ringing.has(me)) return false
  state.silenced.add(me)
  stopRepeats(state, me)
  return true
}

function cleanEndpoint(value) {
  return typeof value === "string" && value.length < 1000 && /^https:\/\//.test(value) ? value : ""
}

function cleanMedia(value, fallback) {
  return typeof value === "boolean" ? value : fallback
}

function cleanId(value) {
  const text = typeof value === "string" ? value : ""
  return /^[a-f0-9]{24}$/i.test(text) ? text : ""
}

// Every handler gets a plain object and a safe reply function, and never throws into socket.io.
function handle(socket, event, run) {
  socket.on(event, async (data, ack) => {
    const body = data && typeof data === "object" && !Array.isArray(data) ? data : {}
    let replied = false
    const reply = (value) => {
      if (replied || typeof ack !== "function") return
      replied = true
      try {
        ack(value)
      } catch {}
    }
    try {
      await run(body, reply)
    } catch (error) {
      console.error(`Call ${event} failed`, error)
      reply({ error: "Something went wrong with the call. Try again." })
    }
  })
}

export function registerCallHandlers(socket) {
  const user = socket.data.user
  const me = String(user._id)

  handle(socket, "call:start", async (data, reply) => {
    const net = await network()
    const media = data.media === "video" ? "video" : "audio"
    const found = await loadChannel(user, cleanId(data.channelId))
    if (!found) return reply({ error: "That conversation was not found." })
    const channelId = String(found.channel._id)
    // Someone else may be starting a call here at this exact moment; join theirs instead of making a second one.
    const existing = byChannel.get(channelId)
    if (existing) {
      const id = typeof existing === "string" ? existing : await existing
      const running = id && live.get(id)
      if (running) return reply({ join: summary(running) })
    }
    if (userInCall(me)) return reply({ error: "You are already in a call. Leave it before starting another." })
    let settleStart
    const pending = new Promise((resolve) => { settleStart = resolve })
    byChannel.set(channelId, pending)
    starting.add(me)
    let state = null
    try {
      const people = await audience(found.channel, found.property)
      // The AI teammate is in property chats but never in calls.
      const others = people.filter((person) => String(person._id) !== me && !person.bot)
      if (!others.length) return reply({ error: "There is no one else in this conversation to call." })
      // Direct messages and private channels ring everyone; a big public channel (even one with a member list) shows Join.
      const ringing = found.channel.kind === "direct" || Boolean(found.channel.private) || others.length <= RING_LIMIT
      const invitedIds = ringing ? others.map((person) => String(person._id)) : []
      const doc = await Call.create({
        channelId: found.channel._id,
        media,
        startedBy: user._id,
        startedByName: user.name,
        invitedIds,
        participants: [{ userId: user._id, name: user.name, joinedAt: new Date() }],
        status: "ringing",
      })
      if (!socket.connected) {
        await Call.updateOne({ _id: doc._id }, { $set: { status: "ended", outcome: "missed", endedAt: new Date() } }).catch(() => {})
        return
      }
      state = {
        id: String(doc._id),
        channelId,
        channelObjectId: found.channel._id,
        channel: presentChannel(found.channel, found.property),
        property: found.property,
        media,
        startedBy: me,
        startedByName: user.name,
        startedAt: doc.startedAt,
        answered: false,
        answeredAt: 0,
        invitedIds,
        audienceIds: people.map((person) => String(person._id)),
        // Direct and private conversations show who is in them; big rooms show the room name.
        names: hasMemberList(found.channel) ? Object.fromEntries(people.map((person) => [String(person._id), person.name])) : {},
        peers: new Map([[socket.id, { userId: me, name: user.name, audio: cleanMedia(data.audio, true), video: cleanMedia(data.video, media === "video"), screen: false }]]),
        away: new Map(),
        joinedIds: new Set([me]),
        declined: new Set(),
        ringing: new Map(),
        ringStarted: new Map(),
        ringMessages: new Map(),
        silenced: new Set(),
        finalPushed: new Set(),
        repeats: new Map(),
        guestIds: new Set(),
        pushed: new Set(),
        shareKey: randomBytes(18).toString("base64url"),
        ringTimer: null,
        notes: null,
        notesStarting: false,
      }
      live.set(state.id, state)
      byChannel.set(channelId, state.id)
    } finally {
      starting.delete(me)
      if (!state && byChannel.get(channelId) === pending) byChannel.delete(channelId)
      settleStart(state ? state.id : null)
    }
    ringUntil(state)
    reply({ call: summary(state), peerId: socket.id, peers: [], ...net, share: state.shareKey })
    ringPeople(state, state.invitedIds, "")
    announce(state)
  })

  handle(socket, "call:join", async (data, reply) => {
    const net = await network()
    const state = live.get(cleanId(data.callId))
    if (!state) return reply({ error: "That call has ended." })
    const key = typeof data.key === "string" ? data.key.slice(0, 64) : ""
    if (!(await mayJoin(user, state, key))) return reply({ error: key ? "This call link is not valid any more." : "You are not part of that conversation." })
    if (!live.has(state.id)) return reply({ error: "That call has ended." })
    if (state.peers.has(socket.id)) return reply({ call: summary(state), peerId: socket.id, peers: peerList(state, socket.id), ...net, share: state.shareKey })
    const busy = userInCall(me)
    if (busy && busy !== state) return reply({ error: "You are already in another call. Leave it first." })
    const earlier = [...state.peers.entries()].filter(([, peer]) => peer.userId === me).map(([peerId]) => peerId)
    if (state.peers.size - earlier.length >= MAX_PEERS) return reply({ error: `This call is full. Calls hold up to ${MAX_PEERS} people.` })
    const media = data.media === "video" ? "video" : "audio"
    // Add the new device first, then move this person off any older device, so the call never looks empty.
    state.peers.set(socket.id, { userId: me, name: user.name, audio: cleanMedia(data.audio, true), video: cleanMedia(data.video, media === "video"), screen: false })
    clearTimeout(state.away.get(me))
    state.away.delete(me)
    for (const peerId of earlier) {
      chatIo()?.to(peerId).emit("call:ended", { callId: state.id, reason: "moved" })
      await removePeer(state, peerId, { moving: true })
    }
    const others = peerList(state, socket.id)
    stopRinging(state, me, { reason: "answered", endpoint: cleanEndpoint(data.endpoint) || socket.data.endpoint || "" })
    const firstAnswer = !state.answered && state.peers.size >= 2
    if (firstAnswer) {
      state.answered = true
      state.answeredAt = Date.now()
    }
    const rejoined = state.joinedIds.has(me)
    state.joinedIds.add(me)
    const update = { $set: {} }
    if (firstAnswer) update.$set = { status: "active", answeredAt: new Date(state.answeredAt) }
    if (!rejoined) update.$push = { participants: { userId: user._id, name: user.name, joinedAt: new Date() } }
    if (firstAnswer || !rejoined) Call.updateOne({ _id: state.id, status: { $ne: "ended" } }, update).catch((error) => console.error("Call join save failed", error))
    if (state.notes) addNoteParticipant(state.notes.id, user)
    const self = state.peers.get(socket.id)
    toPeers(state, "call:peer-joined", { callId: state.id, peer: { peerId: socket.id, userId: me, name: user.name, audio: self.audio, video: self.video, screen: false } }, socket.id)
    reply({ call: summary(state), peerId: socket.id, peers: others, ...net, share: state.shareKey })
    announce(state)
  })

  // AI notes on or off, by anyone in the call. Everyone in it sees that they are on, and each person's app sends
  // their own speech to be transcribed until they are turned off (or the call ends).
  handle(socket, "call:notes", async (data, reply) => {
    const state = live.get(cleanId(data.callId))
    if (!state || !state.peers.has(socket.id)) return reply({ error: "You are not in that call." })
    const on = data.on === true
    if (on) {
      if (state.notes) return reply({ notes: summary(state).notes })
      if (!notesAvailable()) return reply({ error: "AI notes need an AI model. An admin can add OPENROUTER_API_KEY to the server settings." })
      if (state.notesStarting) return reply({ error: "AI notes are already turning on." })
      state.notesStarting = true
      try {
        const people = [...state.peers.values()].map((peer) => ({ userId: peer.userId, name: peer.name }))
        const note = await startNotes({ callId: state.id, channelId: state.channelObjectId, media: state.media, user, participants: people })
        if (!live.has(state.id)) {
          await stopNotes(note._id, user)
          return reply({ error: "That call has ended." })
        }
        state.notes = { id: String(note._id), by: me, byName: user.name, since: note.onAt }
        // Anyone who joined while the notes were being set up is on them too.
        const counted = new Set(people.map((person) => String(person.userId)))
        for (const peer of state.peers.values()) {
          if (counted.has(peer.userId)) continue
          counted.add(peer.userId)
          await addNoteParticipant(note._id, { _id: peer.userId, name: peer.name })
        }
      } finally {
        state.notesStarting = false
      }
    } else {
      if (!state.notes) return reply({ notes: null })
      const noteId = state.notes.id
      state.notes = null
      await stopNotes(noteId, user)
    }
    const notes = summary(state).notes
    toPeers(state, "call:notes", { callId: state.id, on, by: me, byName: user.name, notes })
    announce(state)
    reply({ notes })
  })

  // Someone in the call rings more people. A one-to-one call becomes a group call.
  handle(socket, "call:invite", async (data, reply) => {
    const state = live.get(cleanId(data.callId))
    if (!state || !state.peers.has(socket.id)) return reply({ error: "Join the call before adding people." })
    const wanted = [...new Set((Array.isArray(data.userIds) ? data.userIds : []).map(cleanId).filter(Boolean))].filter((id) => id !== me).slice(0, MAX_PEERS)
    if (!wanted.length) return reply({ error: "Pick at least one person." })
    // The AI teammate is never rung into a call (it would count as someone still to answer).
    let people = (await User.find({ _id: { $in: wanted }, bot: { $ne: true } }).select("_id name role extraPermissions deniedPermissions createdAt")).filter(usesChat)
    if (isGuest(user)) {
      // Contractors can add admins and people they already work with, the same rule as starting a chat.
      const shared = new Set()
      for (const { channel, property } of await visibleChannels(user)) {
        for (const id of channel.memberIds || []) shared.add(String(id))
        for (const id of property?.assignedUserIds || []) shared.add(String(id))
      }
      people = people.filter((person) => person.role === "admin" || shared.has(String(person._id)))
    }
    if (!live.has(state.id)) return reply({ error: "That call has ended." })
    people = people.filter((person) => !inCall(state, String(person._id)))
    if (!people.length) return reply({ error: "Those people are already in the call or cannot be added." })
    if (present(state) + people.length > MAX_PEERS) return reply({ error: `A call holds up to ${MAX_PEERS} people. ${Math.max(0, MAX_PEERS - present(state))} more can join.` })
    const ids = people.map((person) => String(person._id))
    for (const person of people) {
      const id = String(person._id)
      state.guestIds.add(id)
      if (!state.invitedIds.includes(id)) state.invitedIds.push(id)
      if (!state.audienceIds.includes(id)) state.audienceIds.push(id)
      if (state.names && hasMemberList(state.channel)) state.names[id] = person.name
    }
    Call.updateOne({ _id: state.id }, { $addToSet: { invitedIds: { $each: people.map((person) => person._id) } } }).catch(() => {})
    ringPeople(state, ids, user.name)
    announce(state)
    reply({ ok: true, names: people.map((person) => person.name) })
  })

  // Checks a call (and its link) before joining, so the join screen can say who is calling or that it ended.
  handle(socket, "call:peek", async (data, reply) => {
    const state = live.get(cleanId(data.callId))
    if (!state) return reply({ ended: true })
    const key = typeof data.key === "string" ? data.key.slice(0, 64) : ""
    const allowed = state.guestIds.has(me) || Boolean(await loadChannel(user, state.channelId)) || (key && key === state.shareKey && usesChat(user))
    if (!allowed) return reply({ error: key ? "This call link is not valid any more." : "You are not part of that conversation." })
    reply({ call: summary(state) })
  })

  handle(socket, "call:decline", async (data) => {
    await declineCallFor(user, data.callId, cleanEndpoint(data.endpoint) || socket.data.endpoint || "")
  })

  handle(socket, "call:leave", async (data) => {
    if (data.all === true) {
      // The client gave up waiting for a reply; take this device out of whatever call it ended up in.
      for (const entry of [...live.values()]) if (entry.peers.has(socket.id)) await removePeer(entry, socket.id)
      return
    }
    const state = live.get(cleanId(data.callId))
    if (!state) return
    clearTimeout(state.away.get(me))
    state.away.delete(me)
    await removePeer(state, socket.id)
    // Leaving from a device that reconnected (so it is not the one in the call) still counts.
    if (live.has(state.id) && !inCall(state, me)) {
      markLeft(state, me)
      await settle(state)
    }
  })

  handle(socket, "call:signal", async (data) => {
    const state = live.get(cleanId(data.callId))
    const to = typeof data.to === "string" ? data.to : ""
    if (!state || !state.peers.has(socket.id) || !state.peers.has(to) || to === socket.id) return
    const payload = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : null
    if (!payload) return
    // Only setup messages: a session description, a network candidate, or a restart request.
    const clean = {}
    if (payload.description && typeof payload.description === "object" && ["offer", "answer"].includes(payload.description.type) && typeof payload.description.sdp === "string" && payload.description.sdp.length < 200000) {
      clean.description = { type: payload.description.type, sdp: payload.description.sdp }
    }
    if (payload.candidate && typeof payload.candidate === "object" && typeof payload.candidate.candidate === "string" && payload.candidate.candidate.length < 2000) {
      clean.candidate = {
        candidate: payload.candidate.candidate,
        sdpMid: typeof payload.candidate.sdpMid === "string" ? payload.candidate.sdpMid : null,
        sdpMLineIndex: Number.isInteger(payload.candidate.sdpMLineIndex) ? payload.candidate.sdpMLineIndex : null,
        usernameFragment: typeof payload.candidate.usernameFragment === "string" ? payload.candidate.usernameFragment : undefined,
      }
    }
    if (payload.restart === true) clean.restart = true
    if (!Object.keys(clean).length) return
    chatIo()?.to(to).emit("call:signal", { callId: state.id, from: socket.id, data: clean })
  })

  handle(socket, "call:media", async (data) => {
    const state = live.get(cleanId(data.callId))
    const peer = state?.peers.get(socket.id)
    if (!peer) return
    peer.audio = cleanMedia(data.audio, peer.audio)
    peer.video = cleanMedia(data.video, peer.video)
    peer.screen = cleanMedia(data.screen, peer.screen)
    toPeers(state, "call:peer-media", { callId: state.id, peerId: socket.id, audio: peer.audio, video: peer.video, screen: peer.screen }, socket.id)
  })

  handle(socket, "call:live", async (data, reply) => {
    reply({ calls: await liveCallsFor(user), ringing: ringingFor(me) })
  })
}

// A dropped connection keeps the person's place briefly so they can reconnect into the same call.
export async function leaveCallsFor(socket) {
  for (const state of [...live.values()]) {
    if (state.peers.has(socket.id)) await removePeer(state, socket.id, { away: true })
  }
}

export async function liveCallsFor(user) {
  const result = []
  for (const state of [...live.values()]) {
    if (!state.audienceIds.includes(String(user._id))) continue
    if (state.guestIds.has(String(user._id)) || await loadChannel(user, state.channelId)) result.push(summary(state))
  }
  return result
}

// Calls still ringing for this person, so a device that connects late (or opens from a notification) rings too.
function ringingFor(userId) {
  const result = []
  for (const state of live.values()) {
    if (!state.ringing.has(userId) || inCall(state, userId)) continue
    result.push(summary(state))
  }
  return result
}

export function liveCall(callId) {
  const state = live.get(String(callId || ""))
  return state ? summary(state) : null
}

// Run after membership, assignments, archiving or deletion change: people who lost access leave the call,
// and a call in a conversation that no longer exists ends.
export async function recheckCalls(channelId = "") {
  for (const state of [...live.values()]) {
    if (channelId && state.channelId !== String(channelId)) continue
    const channel = await ChatChannel.findById(state.channelObjectId).catch(() => null)
    if (!channel || channel.archivedAt) {
      await endCall(state, "ended")
      continue
    }
    const users = await User.find({ _id: { $in: [...new Set([...state.peers.values()].map((peer) => peer.userId))] } })
    const allowed = new Set()
    for (const person of users) {
      const id = String(person._id)
      if ((state.guestIds.has(id) && usesChat(person)) || await loadChannel(person, state.channelId)) allowed.add(id)
    }
    for (const [peerId, peer] of [...state.peers.entries()]) {
      if (allowed.has(peer.userId) || !live.has(state.id)) continue
      chatIo()?.to(peerId).emit("call:ended", { callId: state.id, reason: "removed" })
      await removePeer(state, peerId)
    }
    if (!live.has(state.id)) continue
    // The property is read again (someone may have been taken off it), and people added to the call from outside the
    // conversation stay in its audience.
    const people = await audience(channel, channel.kind === "property" ? undefined : null).catch(() => null)
    if (people) state.audienceIds = [...new Set([...people.map((person) => String(person._id)), ...state.guestIds])]
    announce(state)
  }
}
