import jwt from "jsonwebtoken"
import { Server } from "socket.io"
import { User } from "../models/index.js"
import { audience, loadChannel, usesChat } from "./chat.js"
import { leaveCallsFor, recheckCalls, registerCallHandlers } from "./calls.js"
import { trustedOrigin } from "./appUrl.js"

const SOCKET_PURPOSE = "chat-socket"
const online = new Map()
const adminIds = new Set()
let io = null

function announce(userId, isAdmin, isOnline) {
  if (!io) return
  const room = isAdmin ? io.to(["staff", "guests"]) : io.to("staff")
  room.emit("presence:change", { userId, online: isOnline })
}

export function socketToken(user) {
  return jwt.sign({ sub: String(user._id), purpose: SOCKET_PURPOSE }, process.env.JWT_SECRET, { expiresIn: "10m" })
}

export function allowedOrigins() {
  return String(process.env.WEB_ORIGIN || "http://localhost:3000").split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean)
}

function originAllowed(origin) {
  if (!origin) return true
  const clean = origin.replace(/\/+$/, "")
  if (allowedOrigins().includes(clean)) return true
  // The company's own addresses (admin.synergifund.com) even when WEB_ORIGIN is mistyped, and local ones in development.
  return Boolean(trustedOrigin(clean))
}

export function attachChatSockets(server) {
  io = new Server(server, {
    path: "/socket.io",
    // Accept "/socket.io?..." as well as "/socket.io/?...", so it works through the website's proxy without a redirect.
    addTrailingSlash: false,
    cors: { origin: (origin, done) => done(null, originAllowed(origin)), credentials: true },
    pingInterval: 20000,
    pingTimeout: 20000,
  })

  io.use(async (socket, next) => {
    try {
      const payload = jwt.verify(String(socket.handshake.auth?.token || ""), process.env.JWT_SECRET)
      if (payload.purpose !== SOCKET_PURPOSE) throw new Error("Wrong token")
      const user = await User.findById(payload.sub)
      if (!user || !usesChat(user)) throw new Error("No user")
      socket.data.user = user
      next()
    } catch {
      next(new Error("unauthorized"))
    }
  })

  io.on("connection", (socket) => {
    const user = socket.data.user
    const id = String(user._id)
    const guest = user.role === "contractor"
    socket.join(`user:${id}`)
    socket.join(guest ? "guests" : "staff")
    const before = online.get(id) || 0
    online.set(id, before + 1)
    const visibleTo = () => (guest ? onlineIds().filter((other) => other === id || adminIds.has(other)) : onlineIds())
    if (user.role === "admin") adminIds.add(id)
    socket.emit("presence", { online: visibleTo() })
    if (!before) announce(id, user.role === "admin", true)

    socket.on("presence:get", () => socket.emit("presence", { online: visibleTo() }))
    // What this device is showing: on screen or not, which chat is open, and its push address.
    // Devices check in every ~15 seconds while on screen; a frozen or locked phone stops checking in and soon counts as away.
    socket.data.visible = false
    socket.data.visibleAt = 0
    socket.data.endpoint = ""
    socket.data.channelId = ""
    socket.on("presence:visible", (data) => {
      const info = data && typeof data === "object" ? data : {}
      socket.data.visible = Boolean(info.visible)
      socket.data.visibleAt = Date.now()
      socket.data.endpoint = typeof info.endpoint === "string" && info.endpoint.length < 1000 ? info.endpoint : ""
      socket.data.channelId = typeof info.channelId === "string" && /^[a-f0-9]{24}$/i.test(info.channelId) ? info.channelId : ""
    })
    registerCallHandlers(socket)

    socket.on("typing", async (data = {}) => {
      try {
        const found = await loadChannel(user, data.channelId)
        if (!found) return
        const people = await audience(found.channel, found.property)
        emitToUsers(people.map((person) => person._id).filter((person) => String(person) !== id), "typing", {
          channelId: String(found.channel._id),
          parentId: data.parentId ? String(data.parentId) : "",
          userId: id,
          name: user.name,
        })
      } catch {}
    })

    socket.on("disconnect", () => {
      leaveCallsFor(socket).catch((error) => console.error("Leaving calls failed", error))
      const left = (online.get(id) || 1) - 1
      if (left > 0) online.set(id, left)
      else {
        online.delete(id)
        announce(id, user.role === "admin", false)
      }
    })
  })
  return io
}

// Devices check in every 10 seconds while on screen; after 20 seconds without one, the device counts as away.
const FRESH_MS = 20000

function onScreen(socket) {
  return Boolean(socket.data.visible) && Date.now() - (socket.data.visibleAt || 0) < FRESH_MS
}

// True when the person has SynergiFund open and on screen on some device right now.
export async function hasVisibleDevice(userId) {
  if (!io) return false
  const sockets = await io.in(`user:${userId}`).fetchSockets()
  return sockets.some(onScreen)
}

// Push addresses of this person's devices that are on screen right now, optionally only those showing one chat.
// Those devices already show the message or call in the app, so they are left out of the push.
export async function screenEndpoints(userIds, channelId = "") {
  const endpoints = new Set()
  if (!io) return endpoints
  for (const userId of userIds) {
    const sockets = await io.in(`user:${userId}`).fetchSockets()
    for (const socket of sockets) {
      if (!onScreen(socket) || !socket.data.endpoint) continue
      if (channelId && socket.data.channelId !== String(channelId)) continue
      endpoints.add(socket.data.endpoint)
    }
  }
  return endpoints
}

export function chatIo() {
  return io
}

export function onlineIds() {
  return [...online.keys()]
}

export function isOnline(userId) {
  return online.has(String(userId))
}

export function refreshChat(userIds) {
  emitToUsers(userIds.map(String), "chat:refresh", {})
  // Access changed (role, permissions, assignments): drop anyone from live calls they can no longer see.
  recheckCalls().catch((error) => console.error("Call access check failed", error))
}

export function disconnectChat(userIds) {
  if (!io) return
  for (const id of userIds.map(String)) io.in(`user:${id}`).disconnectSockets(true)
}

export function emitToUsers(userIds, event, payload) {
  if (!io) return
  const rooms = [...new Set(userIds.map((userId) => `user:${userId}`))]
  if (rooms.length) io.to(rooms).emit(event, payload)
}
