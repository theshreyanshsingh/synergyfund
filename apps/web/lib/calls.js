"use client"

import { useSyncExternalStore } from "react"
import { currentPushEndpoint, emitChat, requestChat } from "./chatSocket"
import { audioContext, playLoop, soundsReady as soundsUnlocked, stopLoop, unlockSounds } from "./sounds"

// One call at a time. Every person connects straight to every other person (a mesh),
// so audio and video never pass through our server. The server only passes setup messages along.

const listeners = new Set()
const EMPTY = { incoming: [], current: null, live: {}, liveLoaded: false, notice: null, me: "", audioBlocked: false }
let state = EMPTY

let localStream = null
let micTrack = null
let cameraTrack = null
let screenTrack = null
let iceServers = []
const connections = new Map()
// Details of people who joined, kept until their connection is set up.
const peerInfo = new Map()
let speaking = null
let noticeTimer = null
// Set while a call is being started or joined, so double clicks never open two microphones.
let busy = false
// Events for the call being joined that arrive before the server's reply; replayed once the call is set up.
let joining = ""
let early = []
let cameraPending = false
let screenPending = false

function set(patch) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function setCurrent(patch) {
  if (!state.current) return
  set({ current: { ...state.current, ...patch } })
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCalls() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY)
}

export function setCallUser(id) {
  if (state.me !== id) set({ me: id || "" })
}

export function callTitle(call, me) {
  if (!call) return "Call"
  const channel = call.channel || {}
  if (channel.kind === "direct") {
    const names = Object.entries(call.names || {}).filter(([id]) => id !== me).map(([, name]) => name)
    if (!names.length) return call.startedByName || "Call"
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")
  }
  if (channel.kind === "property") return channel.name || "Property room"
  return `#${channel.name || "channel"}`
}

function notice(text, tone = "neutral") {
  clearTimeout(noticeTimer)
  set({ notice: text ? { text, tone } : null })
  if (text) noticeTimer = setTimeout(() => set({ notice: null }), 6000)
}

export function dismissNotice() {
  notice("")
}

/* ---------- sounds ---------- */

// The tones themselves (and the person's chosen ringtone) live in lib/sounds.js.
function playTone(kind) {
  playLoop(kind)
}

function stopTone() {
  stopLoop()
}

export function soundsReady() {
  return soundsUnlocked()
}

// One place decides what should be heard: an incoming ring, the ringback of our own unanswered call, or nothing.
function refreshTone() {
  const current = state.current
  if (state.incoming.length) playTone("incoming")
  else if (current && !(current.peers || []).length && !current.call?.answered) playTone("outgoing")
  else stopTone()
}

// Browsers only allow sound after the person taps or types; this unlocks the ringtone.
export function unlockCallSounds() {
  unlockSounds()
}

/* ---------- local media ---------- */

async function openMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot make calls. Open SynergiFund in Chrome, Safari, Edge or Firefox over https.")
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false,
    })
    return stream
  } catch (error) {
    if (video) {
      // No camera, or the camera is blocked: join with audio only rather than not at all.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        notice("The camera is not available, so you joined with audio only.")
        return stream
      } catch {}
    }
    if (error?.name === "NotAllowedError") throw new Error("Allow microphone access for this site, then try again.")
    if (error?.name === "NotFoundError") throw new Error("No microphone was found on this device.")
    throw new Error("The microphone could not start. Close other apps using it and try again.")
  }
}

function keepStream(stream) {
  localStream = stream
  micTrack = stream.getAudioTracks()[0] || null
  cameraTrack = stream.getVideoTracks()[0] || null
  if (micTrack) {
    micTrack.onended = () => {
      // A Bluetooth headset disconnecting or a phone call can take the microphone away.
      if (!state.current) return
      setCurrent({ muted: true, micLost: true })
      notice("Your microphone stopped. Check your headset or microphone, then leave and rejoin the call.", "bad")
      pushMedia()
    }
  }
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

function stopLocal() {
  for (const track of [micTrack, cameraTrack, screenTrack]) track?.stop()
  localStream?.getTracks().forEach((track) => track.stop())
  localStream = null
  micTrack = null
  cameraTrack = null
  screenTrack = null
}

function outgoingVideo() {
  return screenTrack || cameraTrack || null
}

function localView() {
  const tracks = [micTrack, outgoingVideo()].filter(Boolean)
  return tracks.length ? new MediaStream(tracks) : null
}

/* ---------- speaking indicator ---------- */

function watchSpeaking() {
  if (!audioContext() || speaking) return
  speaking = { sources: new Map(), timer: null }
  speaking.timer = setInterval(() => {
    if (!state.current) return
    const loud = []
    for (const [key, entry] of speaking.sources) {
      entry.analyser.getByteTimeDomainData(entry.data)
      let sum = 0
      for (const value of entry.data) sum += (value - 128) ** 2
      if (Math.sqrt(sum / entry.data.length) > 6) loud.push(key)
    }
    const before = state.current.speaking || []
    if (loud.join() !== before.join()) setCurrent({ speaking: loud })
  }, 250)
}

function listenTo(key, stream) {
  const context = audioContext()
  if (!speaking || !context || !stream?.getAudioTracks().length) return
  stopListening(key)
  try {
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    speaking.sources.set(key, { source, analyser, data: new Uint8Array(analyser.fftSize) })
  } catch {}
}

function stopListening(key) {
  const entry = speaking?.sources.get(key)
  if (!entry) return
  try {
    entry.source.disconnect()
  } catch {}
  speaking.sources.delete(key)
}

function stopSpeaking() {
  if (!speaking) return
  clearInterval(speaking.timer)
  for (const key of [...speaking.sources.keys()]) stopListening(key)
  speaking = null
}

/* ---------- peers ---------- */

function publishPeers() {
  if (!state.current) return
  const waiting = [...peerInfo.values()].filter((info) => !connections.has(info.peerId)).map((info) => ({ ...info, stream: null, status: Date.now() - (info.since || Date.now()) >= 30000 ? "failed" : "connecting", version: 0 }))
  setCurrent({
    peers: [...connections.values()].map((peer) => ({
      peerId: peer.peerId,
      userId: peer.userId,
      name: peer.name,
      audio: peer.audio,
      video: peer.video,
      screen: peer.screen,
      stream: peer.stream,
      status: peer.status,
      version: peer.version,
    })).concat(waiting),
  })
}

function signal(peerId, data) {
  if (!state.current) return
  emitChat("call:signal", { callId: state.current.callId, to: peerId, data })
}

function attachLocal(peer) {
  for (const transceiver of peer.pc.getTransceivers()) {
    const kind = transceiver.receiver.track?.kind
    if (!kind || transceiver.stopped) continue
    if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv"
    const track = kind === "audio" ? micTrack : outgoingVideo()
    if (transceiver.sender.track !== track) transceiver.sender.replaceTrack(track).catch(() => {})
    if (kind === "video") peer.videoSender = transceiver.sender
    if (kind === "audio") peer.audioSender = transceiver.sender
  }
}

async function sendOffer(peer, restart = false) {
  // Never stack offers: a second offer before the answer arrives breaks the connection.
  if (peer.offering || peer.pc.signalingState !== "stable") {
    if (restart) peer.restartQueued = true
    return
  }
  peer.offering = true
  try {
    const offer = await peer.pc.createOffer(restart ? { iceRestart: true } : undefined)
    await peer.pc.setLocalDescription(offer)
    signal(peer.peerId, { description: peer.pc.localDescription.toJSON() })
  } catch (error) {
    console.error("Call offer failed", error)
  } finally {
    peer.offering = false
  }
}

function createPeer(info, initiator) {
  const existing = connections.get(info.peerId)
  if (existing) return existing
  const pc = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" })
  const peer = {
    peerId: info.peerId,
    userId: info.userId || "",
    name: info.name || "Someone",
    audio: info.audio !== false,
    video: Boolean(info.video),
    screen: Boolean(info.screen),
    stream: new MediaStream(),
    status: "connecting",
    initiator,
    pc,
    pending: [],
    restarts: 0,
    version: 0,
    audioSender: null,
    videoSender: null,
  }
  connections.set(info.peerId, peer)
  peerInfo.delete(info.peerId)
  pc.ontrack = (event) => {
    if (!peer.stream.getTracks().includes(event.track)) peer.stream.addTrack(event.track)
    // A fresh stream object makes video elements pick the new track up.
    peer.stream = new MediaStream(peer.stream.getTracks())
    peer.version += 1
    if (event.track.kind === "audio") listenTo(peer.peerId, peer.stream)
    event.track.onunmute = () => {
      peer.version += 1
      publishPeers()
    }
    publishPeers()
  }
  pc.onicecandidate = (event) => {
    if (event.candidate) signal(peer.peerId, { candidate: event.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => {
    const status = pc.connectionState
    if (status === "connected") {
      peer.restarts = 0
      peer.everConnected = true
      clearTimeout(peer.giveUp)
      peer.status = "connected"
    } else if (status === "failed") {
      // One fresh attempt (it fixes a changed network); after that, say plainly that it failed.
      if (peer.restarts < 1) {
        peer.restarts += 1
        peer.status = "connecting"
        // Only the side that made the first offer restarts, so both sides never offer at once.
        if (peer.initiator) sendOffer(peer, true)
        else signal(peer.peerId, { restart: true })
      } else {
        peer.status = "failed"
      }
    } else if (status === "disconnected") {
      peer.status = "reconnecting"
    } else if (peer.status !== "failed") {
      peer.status = "connecting"
    }
    publishPeers()
    noteFailures()
  }
  // If it has not connected within 30 seconds, stop saying "Connecting…" and explain instead.
  peer.giveUp = setTimeout(() => {
    if (peer.status === "connected" || !connections.has(peer.peerId)) return
    peer.status = "failed"
    publishPeers()
    noteFailures()
  }, 30000)
  if (initiator) {
    peer.audioSender = pc.addTransceiver(micTrack || "audio", { direction: "sendrecv" }).sender
    peer.videoSender = pc.addTransceiver(outgoingVideo() || "video", { direction: "sendrecv" }).sender
    sendOffer(peer)
  }
  publishPeers()
  return peer
}

// When a connection cannot be made, tell the person why, once per call.
function noteFailures() {
  if (!state.current || state.current.blockedShown) return
  const failed = [...connections.values()].filter((peer) => peer.status === "failed" && !peer.everConnected)
  const silent = [...peerInfo.values()].filter((info) => !connections.has(info.peerId) && Date.now() - (info.since || Date.now()) >= 30000)
  if (!failed.length && !silent.length) return
  setCurrent({ blockedShown: true, blocked: true })
}

function closePeer(peerId) {
  const peer = connections.get(peerId)
  if (!peer) return
  connections.delete(peerId)
  peerInfo.delete(peerId)
  clearTimeout(peer.giveUp)
  stopListening(peerId)
  try {
    peer.pc.ontrack = null
    peer.pc.onicecandidate = null
    peer.pc.onconnectionstatechange = null
    peer.pc.close()
  } catch {}
  publishPeers()
}

async function flushCandidates(peer) {
  const waiting = peer.pending
  peer.pending = []
  for (const candidate of waiting) {
    try {
      await peer.pc.addIceCandidate(candidate)
    } catch {}
  }
}

async function onSignal({ callId, from, data }) {
  if (!state.current || state.current.callId !== callId || !data) return
  let peer = connections.get(from)
  try {
    if (data.restart) {
      if (peer?.initiator) sendOffer(peer, true)
      return
    }
    if (data.description) {
      const description = data.description
      if (description.type === "offer") {
        if (!peer) peer = createPeer(peerInfo.get(from) || { peerId: from }, false)
        await peer.pc.setRemoteDescription(description)
        attachLocal(peer)
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(answer)
        signal(from, { description: peer.pc.localDescription.toJSON() })
        await flushCandidates(peer)
      } else if (description.type === "answer" && peer) {
        if (peer.pc.signalingState !== "have-local-offer") return
        await peer.pc.setRemoteDescription(description)
        await flushCandidates(peer)
        if (peer.restartQueued) {
          peer.restartQueued = false
          if (peer.pc.connectionState === "failed") sendOffer(peer, true)
        }
      }
      return
    }
    if (data.candidate && peer) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {})
      else peer.pending.push(data.candidate)
    }
  } catch (error) {
    console.error("Call signal failed", error)
  }
}

/* ---------- call lifecycle ---------- */

function pushMedia() {
  if (!state.current) return
  const media = { audio: !state.current.muted, video: Boolean(cameraTrack) && !screenTrack, screen: Boolean(screenTrack) }
  emitChat("call:media", { callId: state.current.callId, ...media })
}

function begin(reply, media) {
  iceServers = reply.iceServers?.length ? reply.iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
  set({
    incoming: state.incoming.filter((item) => item.id !== reply.call.id),
    current: {
      callId: reply.call.id,
      call: reply.call,
      peerId: reply.peerId,
      shareKey: reply.share || "",
      relay: Boolean(reply.relay),
      blocked: false,
      blockedShown: false,
      media,
      startedAt: Date.now(),
      connectedAt: reply.peers.length ? Date.now() : 0,
      muted: false,
      micLost: false,
      camera: Boolean(cameraTrack),
      screen: false,
      minimized: false,
      speaking: [],
      local: localView(),
      localVersion: 0,
      peers: [],
    },
  })
  watchSpeaking()
  if (micTrack) listenTo("me", new MediaStream([micTrack]))
  for (const info of reply.peers) createPeer(info, true)
  replayEarly(reply.call.id)
  refreshTone()
}

function replayEarly(callId) {
  const waiting = early
  early = []
  joining = ""
  for (const { event, payload } of waiting) if (!payload?.callId || payload.callId === callId) callEvents[event](payload)
}

function closeConnections() {
  for (const peerId of [...connections.keys()]) closePeer(peerId)
  peerInfo.clear()
}

function teardown(message, tone) {
  closeConnections()
  stopSpeaking()
  stopLocal()
  set({ current: null, audioBlocked: false })
  refreshTone()
  if (message) notice(message, tone)
}

// Asks the server to drop this device from any call it may have joined, e.g. after a reply timed out.
function leaveAnything() {
  emitChat("call:leave", { all: true })
}

export async function startCall(channelId, media = "audio") {
  if (state.current || busy) {
    if (state.current) notice("You are already in a call.")
    return false
  }
  busy = true
  joining = "*"
  early = []
  unlockCallSounds()
  let stream = null
  try {
    stream = await openMedia(media === "video")
    const reply = await requestChat("call:start", { channelId, media, audio: true, video: stream.getVideoTracks().length > 0 })
    if (reply.join) {
      // Someone already started a call here: join it with the same microphone, without asking again.
      return await enterCall(reply.join.id, media, stream)
    }
    if (reply.error) throw new Error(reply.error)
    keepStream(stream)
    begin(reply, media)
    return true
  } catch (error) {
    stopStream(stream)
    joining = ""
    early = []
    if (/did not answer/.test(error.message)) leaveAnything()
    notice(error.message, "bad")
    return false
  } finally {
    busy = false
  }
}

export async function joinCall(callId, media = "audio", key = "") {
  if (state.current?.callId === callId) {
    setCurrent({ minimized: false })
    return true
  }
  if (state.current || busy) {
    if (state.current) notice("Leave your current call before joining another.")
    return false
  }
  busy = true
  unlockCallSounds()
  // Stop ringing as soon as the person answers, even while the browser asks for the microphone.
  set({ incoming: state.incoming.filter((item) => item.id !== callId) })
  refreshTone()
  try {
    return await enterCall(callId, media, null, key)
  } finally {
    busy = false
  }
}

async function enterCall(callId, media, given, key = "") {
  joining = callId
  early = early.filter((item) => item.payload?.callId === callId)
  let stream = given
  try {
    if (!stream) stream = await openMedia(media === "video")
    const endpoint = await currentPushEndpoint().catch(() => "")
    const reply = await requestChat("call:join", { callId, media, key, endpoint, audio: true, video: stream.getVideoTracks().length > 0 })
    if (reply.error) throw new Error(reply.error)
    keepStream(stream)
    begin(reply, media)
    closeRingNotification(callId)
    return true
  } catch (error) {
    stopStream(stream)
    joining = ""
    early = []
    if (/did not answer/.test(error.message)) emitChat("call:leave", { callId })
    set({ incoming: state.incoming.filter((item) => item.id !== callId) })
    refreshTone()
    notice(error.message, "bad")
    return false
  }
}

// Takes this device's "is calling you" notification away once the ringing is over here.
// Only the ringing one: "Missed call" and "Call ended" notifications stay.
function closeRingNotification(callId) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.getRegistration) return
  navigator.serviceWorker.getRegistration()
    .then((registration) => registration?.getNotifications({ tag: `call-${callId}` }))
    .then((list) => {
      for (const note of list || []) if (note.data?.kind === "call") note.close()
    })
    .catch(() => {})
}

export function declineCall(callId) {
  closeRingNotification(callId)
  set({ incoming: state.incoming.filter((item) => item.id !== callId) })
  refreshTone()
  currentPushEndpoint().catch(() => "").then((endpoint) => emitChat("call:decline", { callId, endpoint }))
}

export function leaveCall() {
  if (!state.current) return
  emitChat("call:leave", { callId: state.current.callId })
  teardown("")
}

export function toggleMute() {
  if (!state.current || !micTrack || micTrack.readyState !== "live") return
  const muted = !state.current.muted
  micTrack.enabled = !muted
  setCurrent({ muted })
  pushMedia()
}

async function sendVideo() {
  const track = outgoingVideo()
  for (const peer of connections.values()) {
    if (!peer.videoSender) attachLocal(peer)
    if (peer.videoSender && peer.videoSender.track !== track) await peer.videoSender.replaceTrack(track).catch(() => {})
  }
  setCurrent({ local: localView(), localVersion: (state.current?.localVersion || 0) + 1, camera: Boolean(cameraTrack), screen: Boolean(screenTrack) })
  pushMedia()
}

export async function toggleCamera() {
  if (!state.current || cameraPending) return
  if (cameraTrack) {
    cameraTrack.stop()
    cameraTrack = null
    await sendVideo()
    return
  }
  cameraPending = true
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } })
    if (!state.current) {
      stopStream(stream)
      return
    }
    cameraTrack?.stop()
    cameraTrack = stream.getVideoTracks()[0]
    await sendVideo()
  } catch (error) {
    notice(error?.name === "NotAllowedError" ? "Allow camera access for this site, then try again." : "The camera could not start.", "bad")
  } finally {
    cameraPending = false
  }
}

// Phone browsers (iPhone Safari, Android Chrome) do not let websites share the screen; computers do.
// Checks what the browser can actually do rather than guessing from the device name.
export function canShareScreen() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function"
}

const SCREEN_NOT_ON_PHONE = "Screen sharing works from a computer. iPhone and Android browsers do not let websites share the screen, but you can still see a screen someone else shares."

export async function toggleScreen() {
  if (!state.current || screenPending) return
  if (!canShareScreen()) {
    notice(SCREEN_NOT_ON_PHONE)
    return
  }
  if (screenTrack) {
    screenTrack.stop()
    screenTrack = null
    await sendVideo()
    return
  }
  screenPending = true
  const askedAt = Date.now()
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
    if (!state.current) {
      stopStream(stream)
      return
    }
    screenTrack?.stop()
    screenTrack = stream.getVideoTracks()[0]
    const mine = screenTrack
    screenTrack.onended = () => {
      if (screenTrack !== mine) return
      screenTrack = null
      sendVideo()
    }
    await sendVideo()
  } catch (error) {
    // Some phone browsers have the feature in name only and refuse instantly, before any prompt could appear.
    const phone = /iphone|ipad|android|mobile/i.test(navigator.userAgent || "")
    if (phone && Date.now() - askedAt < 400) notice(SCREEN_NOT_ON_PHONE)
    else if (error?.name === "NotSupportedError" || error?.name === "TypeError") notice(SCREEN_NOT_ON_PHONE)
    else if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") notice("Screen sharing could not start.", "bad")
  } finally {
    screenPending = false
  }
}

export function setMinimized(minimized) {
  setCurrent({ minimized })
}

export function dismissBlocked() {
  setCurrent({ blocked: false })
}

// Rings more people into the current call.
export async function inviteToCall(userIds) {
  if (!state.current) return { error: "You are not in a call." }
  try {
    return await requestChat("call:invite", { callId: state.current.callId, userIds })
  } catch (error) {
    return { error: error.message }
  }
}

// A link anyone signed in can use to join while this call is on.
export function callLink() {
  if (!state.current?.shareKey || typeof window === "undefined") return ""
  return `${window.location.origin}/calls?join=${state.current.callId}&key=${encodeURIComponent(state.current.shareKey)}`
}

export async function peekCall(callId, key = "") {
  try {
    return await requestChat("call:peek", { callId, key })
  } catch (error) {
    return { error: error.message }
  }
}

// Some browsers block call audio until the person taps the page; the call screen then offers a button.
export function reportAudioBlocked(blocked) {
  if (state.audioBlocked !== blocked) set({ audioBlocked: blocked })
}

// After the connection to the server drops and comes back, rejoin the same call on the new connection.
async function rejoin() {
  const current = state.current
  if (!current || current.rejoining) return
  setCurrent({ rejoining: true })
  closeConnections()
  setCurrent({ peers: [] })
  joining = current.callId
  early = []
  try {
    const reply = await requestChat("call:join", { callId: current.callId, media: current.media, audio: !current.muted, video: Boolean(cameraTrack) || Boolean(screenTrack) })
    if (!state.current || state.current.callId !== current.callId) return
    if (reply.error) {
      teardown(reply.error === "That call has ended." ? "The call ended while you were reconnecting." : reply.error, "bad")
      return
    }
    iceServers = reply.iceServers?.length ? reply.iceServers : iceServers
    setCurrent({ call: reply.call, peerId: reply.peerId, shareKey: reply.share || state.current.shareKey, relay: Boolean(reply.relay), rejoining: false })
    for (const info of reply.peers) createPeer(info, true)
    replayEarly(current.callId)
    pushMedia()
    refreshTone()
  } catch {
    teardown("The connection dropped and the call could not reconnect.", "bad")
  }
}

/* ---------- server events ---------- */

// While a call is being set up, keep its events until the server's reply arrives.
function hold(event, payload) {
  if (state.current?.rejoining && payload?.callId === state.current.callId) {
    early.push({ event, payload })
    return true
  }
  if (state.current || !joining) return false
  if (joining === "*" || payload?.callId === joining) {
    early.push({ event, payload })
    return true
  }
  return false
}

export const callEvents = {
  "call:ring": ({ call, invitedBy } = {}) => {
    if (!call || state.current?.callId === call.id) return
    if (state.incoming.some((item) => item.id === call.id)) return
    set({ incoming: [...state.incoming, { ...call, invitedBy: invitedBy || "" }] })
    refreshTone()
    if (typeof document !== "undefined" && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const added = invitedBy && invitedBy !== call.startedByName
        const kind = call.media === "video" ? "video" : "voice"
        // Same tag as the phone notification, so the two replace each other instead of doubling up.
        const note = new Notification(added ? `${invitedBy} is adding you to a ${kind} call` : `${call.startedByName} is calling you`, { body: `${kind === "video" ? "Video" : "Voice"} call`, tag: `call-${call.id}`, renotify: true, requireInteraction: true })
        note.onclick = () => {
          window.focus()
          note.close()
        }
      } catch {}
    }
  },
  "call:ring-stop": ({ callId } = {}) => {
    if (callId) closeRingNotification(callId)
    set({ incoming: state.incoming.filter((item) => item.id !== callId) })
    refreshTone()
  },
  "call:update": ({ channelId, call } = {}) => {
    if (!channelId) return
    const live = { ...state.live }
    if (call) live[channelId] = call
    else delete live[channelId]
    set({ live })
    if (state.current && call && call.id === state.current.callId) setCurrent({ call })
    if (!call) set({ incoming: state.incoming.filter((item) => item.channelId !== channelId) })
    refreshTone()
  },
  "call:peer-joined": (payload = {}) => {
    if (hold("call:peer-joined", payload)) return
    const { callId, peer } = payload
    if (!state.current || state.current.callId !== callId || !peer) return
    if (!state.current.connectedAt) setCurrent({ connectedAt: Date.now() })
    const existing = connections.get(peer.peerId)
    if (existing) {
      // Their offer got here first; fill in who they are.
      Object.assign(existing, { userId: peer.userId, name: peer.name, audio: peer.audio !== false, video: Boolean(peer.video), screen: Boolean(peer.screen) })
      existing.version += 1
    } else {
      // The person joining sends the offer; keep their details until it arrives.
      peerInfo.set(peer.peerId, { ...peer, since: Date.now() })
      setTimeout(() => {
        if (!peerInfo.has(peer.peerId)) return
        publishPeers()
        noteFailures()
      }, 30500)
    }
    publishPeers()
    refreshTone()
  },
  "call:peer-left": (payload = {}) => {
    if (hold("call:peer-left", payload)) return
    const { callId, peerId } = payload
    if (!state.current || state.current.callId !== callId) return
    peerInfo.delete(peerId)
    closePeer(peerId)
    publishPeers()
    refreshTone()
  },
  "call:peer-media": (payload = {}) => {
    if (hold("call:peer-media", payload)) return
    const { callId, peerId, audio, video, screen } = payload
    if (!state.current || state.current.callId !== callId) return
    const peer = connections.get(peerId)
    if (peer) {
      peer.audio = audio
      peer.video = video
      peer.screen = screen
      peer.version += 1
      publishPeers()
    } else if (peerInfo.has(peerId)) {
      peerInfo.set(peerId, { ...peerInfo.get(peerId), audio, video, screen })
      publishPeers()
    }
  },
  "call:signal": (payload = {}) => {
    if (hold("call:signal", payload)) return
    onSignal(payload)
  },
  "call:ended": ({ callId, reason } = {}) => {
    set({ incoming: state.incoming.filter((item) => item.id !== callId) })
    if (joining && (joining === callId)) {
      joining = ""
      early = []
    }
    if (!state.current || state.current.callId !== callId) {
      refreshTone()
      return
    }
    const message = reason === "declined" ? "Call declined." : reason === "missed" ? "No answer." : reason === "moved" ? "You joined this call on another device." : reason === "removed" ? "You no longer have access to this conversation, so you left the call." : "Call ended."
    teardown(message)
  },
  reconnect: () => {
    if (state.current) rejoin()
    requestChat("call:live", {}).then((reply) => {
      const live = {}
      for (const call of reply.calls || []) live[call.channelId] = call
      // Replace the ringing list: anything that stopped while we were offline disappears.
      const ringing = (reply.ringing || []).filter((call) => call.id !== state.current?.callId)
      set({ live, liveLoaded: true, incoming: ringing })
      refreshTone()
    }).catch(() => {})
  },
}

export function leaveOnUnload() {
  if (state.current) emitChat("call:leave", { callId: state.current.callId })
}
