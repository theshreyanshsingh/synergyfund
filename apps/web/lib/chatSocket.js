"use client"

import { useEffect, useRef, useState } from "react"
import { io } from "socket.io-client"
import { api } from "./api"

const listeners = new Map()
const statusListeners = new Set()
let socket = null
let users = 0
let status = "offline"
let starting = null
let retries = 0
let blocked = false
let retryTimer = null

function retryLater(action) {
  clearTimeout(retryTimer)
  const delay = Math.min(60000, 2000 * 2 ** Math.min(retries, 5))
  retries += 1
  retryTimer = setTimeout(() => {
    if (users) action()
  }, delay)
}

function setStatus(next) {
  status = next
  for (const listener of statusListeners) listener(next)
}

function socketUrl(serverUrl) {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL || serverUrl
  if (configured) return configured
  return `${window.location.protocol}//${window.location.hostname}:4000`
}

function dispatch(event, payload) {
  for (const listener of listeners.get(event) || []) {
    try {
      listener(payload)
    } catch (error) {
      console.error(`Chat listener for ${event} failed`, error)
    }
  }
}

async function start() {
  if (socket || starting) return starting
  starting = (async () => {
    setStatus("connecting")
    let first
    try {
      first = await api("/chat/socket-token")
    } catch (error) {
      setStatus("offline")
      starting = null
      if (error.status !== 403 && error.status !== 401) retryLater(start)
      return
    }
    if (!users) {
      setStatus("offline")
      starting = null
      return
    }
    let token = first.token
    socket = io(socketUrl(first.url), {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      auth: (done) => {
        if (token) {
          done({ token })
          token = ""
          return
        }
        api("/chat/socket-token").then((data) => {
          blocked = false
          done({ token: data.token })
        }).catch((error) => {
          blocked = error.status === 401 || error.status === 403
          done({ token: "" })
        })
      },
    })
    socket.on("connect", () => {
      retries = 0
      setStatus("live")
      dispatch("reconnect", {})
    })
    socket.on("disconnect", (reason) => {
      setStatus("connecting")
      if (reason === "io server disconnect" && !blocked) retryLater(() => socket?.connect())
    })
    socket.on("connect_error", () => {
      setStatus("connecting")
      if (blocked) setStatus("offline")
      else if (socket && !socket.active) retryLater(() => socket?.connect())
    })
    socket.onAny((event, payload) => dispatch(event, payload))
    starting = null
  })()
  return starting
}

function stop() {
  clearTimeout(retryTimer)
  retries = 0
  socket?.disconnect()
  socket = null
  setStatus("offline")
}

export function emitChat(event, payload) {
  if (socket?.connected) socket.emit(event, payload)
}

export function useChatEvents(handlers, enabled = true) {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    if (!enabled) return undefined
    users += 1
    start()
    const bound = new Map()
    for (const event of Object.keys(ref.current)) {
      const listener = (payload) => ref.current[event]?.(payload)
      bound.set(event, listener)
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(listener)
    }
    return () => {
      for (const [event, listener] of bound) listeners.get(event)?.delete(listener)
      users -= 1
      if (!users) setTimeout(() => {
        if (!users) stop()
      }, 2000)
    }
    // Event names are fixed per component, so subscribing once per enabled state is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}

export function useChatStatus() {
  const [value, setValue] = useState(status)
  useEffect(() => {
    setValue(status)
    statusListeners.add(setValue)
    return () => statusListeners.delete(setValue)
  }, [])
  return value
}
