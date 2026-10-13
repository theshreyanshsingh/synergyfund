"use client"

import { useEffect, useRef, useState } from "react"
import { initials } from "@synergifund/shared"
import { Icon } from "../ui/Icon"

// Pieces shared by the call window, the small call bar and the floating (picture-in-picture) window.

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function statusText(current, now) {
  const others = (current.peers || []).length
  if (!others) return current.call?.answered ? "Waiting for others…" : "Ringing…"
  if (!(current.peers || []).some((peer) => peer.status === "connected")) {
    return (current.peers || []).every((peer) => peer.status === "failed") ? "Couldn’t connect" : "Connecting…"
  }
  return formatClock(now - (current.connectedAt || current.startedAt))
}

export function Tile({ self = false, name, avatarName, stream, version, video, screen = false, muted, speaking, status }) {
  const ref = useRef(null)
  const hasVideo = Boolean(video && stream?.getVideoTracks().some((track) => track.readyState === "live" && (self || !track.muted)))
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (element.srcObject !== stream) element.srcObject = stream || null
    if (stream) element.play?.().catch(() => {})
  }, [stream, version, hasVideo])
  return (
    <div className={`call-tile${self ? " is-self" : ""}${speaking && !muted ? " is-speaking" : ""}${screen ? " is-screen" : ""}`}>
      <video ref={ref} className={hasVideo ? (self && !screen ? "is-mirrored" : "") : "is-hidden"} autoPlay playsInline muted />
      {!hasVideo && <span className="call-avatar">{initials(avatarName || name || "?")}</span>}
      <span className="call-tile-name">
        {muted && <Icon name="micOff" size={13} />}
        {name}{screen ? " · sharing screen" : ""}
      </span>
      {status && status !== "connected" && <span className={status === "failed" ? "call-tile-status is-failed" : "call-tile-status"}>{status === "failed" ? "Couldn’t connect" : status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>}
    </div>
  )
}
