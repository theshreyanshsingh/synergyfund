"use client"

import { useState } from "react"
import { joinCall, setMinimized, startCall, useCalls } from "../../lib/calls"
import { Icon } from "../ui/Icon"

// Voice and video buttons for a conversation, or "Join" when a call is already running in it.
export function CallButtons({ channel }) {
  const calls = useCalls()
  const [busy, setBusy] = useState(false)
  if (!channel || (channel.kind === "direct" && (channel.memberIds || []).length < 2)) return null
  const live = calls.live[channel.id]
  const inThis = Boolean(calls.current && live && calls.current.callId === live.id)

  async function run(action) {
    if (busy) return
    setBusy(true)
    await action()
    setBusy(false)
  }

  if (inThis) {
    return <button type="button" className="call-pill is-in" onClick={() => setMinimized(false)}><span className="call-live-dot" aria-hidden="true" />In call</button>
  }
  if (live) {
    const count = live.participants?.length || 0
    return (
      <span className="call-join">
        <button type="button" className="call-pill is-join" disabled={busy} onClick={() => run(() => joinCall(live.id, "audio"))} title="Join with voice">
          <Icon name="phone" size={14} />Join{count ? ` · ${count}` : ""}
        </button>
        <button type="button" className="chat-members-button" disabled={busy} onClick={() => run(() => joinCall(live.id, "video"))} title="Join with video" aria-label="Join with video"><Icon name="video" size={15} /></button>
      </span>
    )
  }
  return (
    <span className="call-buttons">
      <button type="button" className="chat-members-button" disabled={busy || Boolean(calls.current)} onClick={() => run(() => startCall(channel.id, "audio"))} title={calls.current ? "You are already in a call" : "Start a voice call"} aria-label="Start a voice call"><Icon name="phone" size={15} /></button>
      <button type="button" className="chat-members-button" disabled={busy || Boolean(calls.current)} onClick={() => run(() => startCall(channel.id, "video"))} title={calls.current ? "You are already in a call" : "Start a video call"} aria-label="Start a video call"><Icon name="video" size={15} /></button>
    </span>
  )
}
