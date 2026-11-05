"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { can, initials, PERMISSIONS } from "@synergifund/shared"
import { Icon } from "../ui/Icon"

const SLIDE_MS = 220

// The light or dark theme, as the top bar's moon and the More sheet switch it (kept for next time on this device).
export function useTheme() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark")
  }, [])
  // From the theme as it is now (the other switch, on the top bar or in More, may have changed it).
  function toggle() {
    const next = document.documentElement.dataset.theme !== "dark"
    document.documentElement.dataset.theme = next ? "dark" : "light"
    try {
      localStorage.setItem("synergifund-theme", next ? "dark" : "light")
    } catch {}
    setDark(next)
  }
  return [dark, toggle]
}

// A contractor's More, from the dock on phones and tablets: who is signed in, Channels and Calls, Settings, the dark
// theme and Log out, in a sheet that slides up from the bottom. A tap outside it, a swipe down, Escape or the phone's
// Back closes it.
export function MoreSheet({ user, badges = {}, onClose, onSignOut }) {
  const router = useRouter()
  const [shown, setShown] = useState(false)
  const [drag, setDrag] = useState(0)
  const [dark, toggleTheme] = useTheme()
  const sheetRef = useRef(null)
  const swipe = useRef(null)
  const closing = useRef(false)
  // A page to open once the sheet is gone (Back has taken its own step out of the history first).
  const next = useRef("")
  const chat = can(user, PERMISSIONS.chatUse)

  function finish() {
    if (closing.current) return
    closing.current = true
    setShown(false)
    const href = next.current
    setTimeout(() => {
      onClose()
      if (href) router.push(href)
    }, href ? 0 : SLIDE_MS)
  }

  function close() {
    if (window.history.state?.moreSheet) window.history.back()
    else finish()
  }

  function open(href) {
    next.current = href
    close()
  }

  useEffect(() => {
    // Focus goes back to what opened it once it closes: More in the dock (also when a tap left nothing focused).
    const focused = document.activeElement
    const opener = focused instanceof HTMLElement && focused !== document.body ? focused : document.querySelector(".dock button[aria-haspopup='dialog']")
    const frame = requestAnimationFrame(() => setShown(true))
    if (!window.history.state?.moreSheet) window.history.pushState({ ...window.history.state, moreSheet: true }, "")
    window.addEventListener("popstate", finish)
    sheetRef.current?.focus()
    const onKey = (event) => { if (event.key === "Escape") close() }
    document.addEventListener("keydown", onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("popstate", finish)
      document.removeEventListener("keydown", onKey)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grip = {
    onTouchStart: (event) => { swipe.current = { y: event.touches[0].clientY, at: Date.now() } },
    onTouchMove: (event) => { if (swipe.current) setDrag(Math.max(0, event.touches[0].clientY - swipe.current.y)) },
    onTouchEnd: () => {
      if (!swipe.current) return
      const quick = drag > 30 && Date.now() - swipe.current.at < 250
      swipe.current = null
      if (drag > 90 || quick) close()
      else setDrag(0)
    },
  }

  const row = (href, icon, label, count = 0) => (
    <a
      href={href}
      className="more-row"
      onClick={(event) => {
        event.preventDefault()
        open(href)
      }}
    >
      <Icon name={icon} size={19} />
      <span>{label}</span>
      {count > 0 && <em className="more-count" aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</em>}
      <span className="more-chevron" aria-hidden="true"><Icon name="chevron" size={16} /></span>
    </a>
  )

  return (
    <div className={shown ? "more-layer is-shown" : "more-layer"}>
      <button type="button" className="more-scrim" aria-label="Close" tabIndex={-1} onClick={close} />
      <section
        ref={sheetRef}
        className="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="More"
        tabIndex={-1}
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      >
        <div className="more-grip-area" {...grip}>
          <span className="more-grip" aria-hidden="true" />
        </div>
        <div className="more-person">
          <span className="avatar">{initials(user.name)}</span>
          <div className="more-person-copy">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        {chat && (
          <div className="more-group">
            {row("/chat", "hash", "Channels", badges.channels || 0)}
            {row("/calls", "phone", "Calls")}
          </div>
        )}
        <div className="more-group">
          {row("/settings", "settings", "Settings")}
          <button type="button" className="more-row" role="switch" aria-checked={dark} onClick={toggleTheme}>
            <Icon name={dark ? "sun" : "moon"} size={19} />
            <span>Dark mode</span>
            <span className={dark ? "more-switch is-on" : "more-switch"} aria-hidden="true" />
          </button>
        </div>
        <div className="more-group">
          <button type="button" className="more-row is-danger" onClick={onSignOut}>
            <Icon name="logout" size={19} />
            <span>Log out</span>
          </button>
        </div>
      </section>
    </div>
  )
}
