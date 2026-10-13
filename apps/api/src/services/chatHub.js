import jwt from "jsonwebtoken"
import { Server } from "socket.io"
import { User } from "../models/index.js"
import { audience, loadChannel, usesChat } from "./chat.js"
import { leaveCallsFor, recheckCalls, registerCallHandlers } from "./calls.js"

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
  try {
    const { hostname } = new URL(clean)
    return process.env.NODE_ENV !== "production" && (hostname === "localhost" || hostname === "127.0.0.1" || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(hostname))
  } catch {
    return false
  }
}

export function attachChatSockets(server) {
  io = new Server(server, {
    path: "/socket.io",
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
    // Whether the app is on screen on this device; calls push to phones when nothing is on screen.
    socket.data.visible = true
    socket.on("presence:visible", (data) => {
      socket.data.visible = Boolean(data && data.visible)
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

// True when the person has SynergiFund open and on screen on some device right now.
export async function hasVisibleDevice(userId) {
  if (!io) return false
  const sockets = await io.in(`user:${userId}`).fetchSockets()
  return sockets.some((socket) => socket.data.visible !== false)
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
