"use client"

import { useEffect, useRef, useState } from "react"
import { canShareScreen, leaveCall, setMinimized, toggleCamera, toggleMute, toggleScreen } from "../../lib/calls"
import { Icon } from "../ui/Icon"
import { openCallPip, pipSupported, usePipOpen } from "./CallPip"
import { NotesOn } from "./CallParts"

const SPOT = "synergifund-call-bar"
const EDGE = 8

function keepInside(pos, element) {
  if (!pos || !element) return pos
  const width = element.offsetWidth
  const height = element.offsetHeight
  return {
    x: Math.round(Math.min(Math.max(EDGE, pos.x), Math.max(EDGE, window.innerWidth - width - EDGE))),
    y: Math.round(Math.min(Math.max(EDGE, pos.y), Math.max(EDGE, window.innerHeight - height - EDGE))),
  }
}

// The small call bar: drag it anywhere (it remembers where), tap the name to open the call.
export function MiniBar({ current, title, status, myName }) {
  const box = useRef(null)
  const drag = useRef(null)
  const [pos, setPos] = useState(null)
  const [dragging, setDragging] = useState(false)
  const pip = usePipOpen()

  useEffect(() => {
    let saved = null
    try {
      saved = JSON.parse(localStorage.getItem(SPOT) || "null")
    } catch {}
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) setPos(keepInside(saved, box.current))
    function onResize() {
      setPos((current) => (current ? keepInside(current, box.current) : current))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return
    // Buttons keep working as buttons; drag from the name or the bar itself.
    if (event.target.closest("button")) return
    const rect = box.current.getBoundingClientRect()
    // Remember where the press started: once the bar captures the pointer, the release is reported on the bar itself.
    drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, startX: event.clientX, startY: event.clientY, moved: false, onName: Boolean(event.target.closest(".call-mini-handle")) }
    box.current.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event) {
    const state = drag.current
    if (!state) return
    if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5) return
    if (!state.moved) setDragging(true)
    state.moved = true
    event.preventDefault()
    // Kept here as well: on release the bar may not have been redrawn at the last spot yet.
    state.last = keepInside({ x: event.clientX - state.dx, y: event.clientY - state.dy }, box.current)
    setPos(state.last)
  }

  function onPointerUp(event) {
    const state = drag.current
    drag.current = null
    setDragging(false)
    box.current?.releasePointerCapture?.(event.pointerId)
    if (!state) return
    if (state.moved) {
      const rect = box.current.getBoundingClientRect()
      const spot = state.last || { x: Math.round(rect.left), y: Math.round(rect.top) }
      try {
        localStorage.setItem(SPOT, JSON.stringify({ x: spot.x, y: spot.y }))
      } catch {}
    } else if (state.onName) {
      setMinimized(false)
    }
  }

  const placed = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto", transform: "none" } : undefined
  return (
    <div
      ref={box}
      className={dragging ? "call-mini is-dragging" : "call-mini"}
      style={placed}
      role="region"
      aria-label="Call in progress. Drag to move."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; setDragging(false) }}
    >
      <div
        className="call-mini-handle"
        role="button"
        tabIndex={0}
        title="Drag to move, tap to open the call"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setMinimized(false)
          }
        }}
      >
        <span className="call-mini-grip" aria-hidden="true"><Icon name="grip" size={14} /></span>
        <span className="call-live-dot" aria-hidden="true" />
        <span className="call-mini-copy"><strong>{title}</strong><em>{status}</em></span>
        {current.call?.notes && <NotesOn notes={current.call.notes} compact />}
      </div>
      <button type="button" className="call-mini-icon" onClick={() => setMinimized(false)} aria-label="Open the call" title="Open the call"><Icon name="expand" size={15} /></button>
      {pipSupported() && !pip && (
        <button type="button" className="call-mini-icon" onClick={() => openCallPip({ myName })} aria-label="Pop out" title="Keep the call on top of other apps and tabs"><Icon name="popout" size={15} /></button>
      )}
      <button type="button" className={current.muted ? "call-round is-small is-off" : "call-round is-small"} onClick={toggleMute} aria-label={current.muted ? "Unmute" : "Mute"} title={current.muted ? "Unmute" : "Mute"}><Icon name={current.muted ? "micOff" : "mic"} size={16} /></button>
      <button type="button" className={current.camera ? "call-round is-small" : "call-round is-small is-off"} onClick={toggleCamera} aria-label={current.camera ? "Stop video" : "Start video"} title={current.camera ? "Stop video" : "Start video"}><Icon name={current.camera ? "video" : "videoOff"} size={16} /></button>
      {current.screen && canShareScreen() && (
        <button type="button" className="call-round is-small is-active" onClick={toggleScreen} aria-label="Stop sharing your screen" title="Stop sharing your screen"><Icon name="screen" size={16} /></button>
      )}
      <button type="button" className="call-round is-small is-danger" onClick={leaveCall} aria-label="Leave call" title="Leave call"><Icon name="phoneOff" size={16} /></button>
    </div>
  )
}
