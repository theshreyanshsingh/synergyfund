"use client"

import { useEffect, useRef, useState } from "react"
import { Icon } from "../ui/Icon"

const LEAVE_MS = 200

// A sheet that slides up over the Agent with the Agent dimmed behind it: X on the left, its name in the middle and
// `action` (a button) on the right. A tap on the dimmed part, Escape, X, or a swipe down on its top closes it.
// On a computer it is a card in the middle of the screen. `children` may be a function given close(), to close it
// with its slide (after Done, say).
export function AgentBottomSheet({ title, onClose, action = null, className = "", children }) {
  const [leaving, setLeaving] = useState(false)
  const [drag, setDrag] = useState(0)
  const panel = useRef(null)
  const swipe = useRef(null)
  const done = useRef(false)

  function close() {
    if (done.current) return
    done.current = true
    setLeaving(true)
    setTimeout(onClose, LEAVE_MS)
  }

  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      close()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [])

  const top = {
    onTouchStart: (event) => { swipe.current = { y: event.touches[0].clientY, at: Date.now() } },
    onTouchMove: (event) => { if (swipe.current) setDrag(Math.max(0, event.touches[0].clientY - swipe.current.y)) },
    onTouchEnd: () => {
      if (!swipe.current) return
      const quick = drag > 40 && Date.now() - swipe.current.at < 250
      swipe.current = null
      if (drag > 90 || quick) close()
      else setDrag(0)
    },
  }

  return (
    <div className={["agent-bottom", leaving ? "is-leaving" : "", className].filter(Boolean).join(" ")}>
      <button type="button" className="agent-bottom-scrim" aria-label={`Close ${title}`} tabIndex={-1} onClick={close} />
      <section ref={panel} className="agent-bottom-panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
        <header className="agent-bottom-head" {...top}>
          <span className="agent-bottom-grip" aria-hidden="true" />
          <button type="button" className="agent-round" onClick={close} aria-label="Close"><Icon name="close" size={18} /></button>
          <h2>{title}</h2>
          {action || <span aria-hidden="true" />}
        </header>
        <div className="agent-bottom-body">{typeof children === "function" ? children(close) : children}</div>
      </section>
    </div>
  )
}

// Small notes over the box that go by themselves after two seconds: "Copied to clipboard", "Thanks for your feedback!".
export function agentToast(text) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("agent:toast", { detail: { text } }))
}

export function AgentToasts() {
  const [toasts, setToasts] = useState([])
  useEffect(() => {
    const timers = new Set()
    const show = (event) => {
      const text = String(event.detail?.text || "")
      if (!text) return
      const id = `${Date.now()}-${Math.random()}`
      setToasts((current) => [...current.filter((toast) => toast.text !== text), { id, text }].slice(-2))
      const timer = setTimeout(() => {
        timers.delete(timer)
        setToasts((current) => current.filter((toast) => toast.id !== id))
      }, 2200)
      timers.add(timer)
    }
    window.addEventListener("agent:toast", show)
    return () => {
      window.removeEventListener("agent:toast", show)
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])
  return (
    <div className="agent-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => <p key={toast.id} className="agent-toast"><Icon name="tick" size={15} />{toast.text}</p>)}
    </div>
  )
}
