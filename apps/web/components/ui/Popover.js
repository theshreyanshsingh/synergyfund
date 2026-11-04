"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

const PHONE = "(max-width: 760px)"

// A small panel opened from a button (`anchor`, its element): below it, or above when there is no room, kept on
// screen. A tap outside, Escape, or scrolling the page closes it. On a phone it is a sheet from the bottom over a
// dimmed page instead (a tap on the dimmed page closes it).
export function Popover({ anchor, onClose, children, className = "", align = "start", width = null }) {
  const ref = useRef(null)
  const [place, setPlace] = useState(null)
  const [sheet] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE).matches)

  useLayoutEffect(() => {
    if (sheet) {
      setPlace({})
      return undefined
    }
    function measure() {
      if (!anchor || !ref.current) return
      const box = anchor.getBoundingClientRect()
      const panel = ref.current.getBoundingClientRect()
      const gap = 6
      const room = window.innerHeight - box.bottom - gap - 8
      const above = room < panel.height && box.top - gap - 8 > room
      const top = above ? Math.max(8, box.top - gap - panel.height) : Math.min(box.bottom + gap, window.innerHeight - 8 - Math.min(panel.height, window.innerHeight - 16))
      let left = align === "end" ? box.right - panel.width : box.left
      left = Math.min(Math.max(8, left), window.innerWidth - panel.width - 8)
      setPlace({ top, left, maxHeight: window.innerHeight - 16 })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [anchor, align, sheet])

  useEffect(() => {
    const away = (event) => {
      // The sheet's dimmed page closes it on its click (closing on the press would let the tap land on what is under it).
      if (ref.current?.contains(event.target) || anchor?.contains(event.target) || event.target.classList?.contains("popover-backdrop")) return
      onClose()
    }
    const key = (event) => { if (event.key === "Escape") onClose() }
    const scroll = (event) => { if (!ref.current?.contains(event.target)) onClose() }
    document.addEventListener("pointerdown", away, true)
    document.addEventListener("keydown", key)
    if (!sheet) window.addEventListener("scroll", scroll, true)
    return () => {
      document.removeEventListener("pointerdown", away, true)
      document.removeEventListener("keydown", key)
      window.removeEventListener("scroll", scroll, true)
    }
  }, [anchor, onClose, sheet])

  return createPortal(
    <>
      {sheet && <div className="popover-backdrop" onClick={onClose} />}
      <div
        ref={ref}
        className={["popover", sheet ? "is-sheet" : "", className].filter(Boolean).join(" ")}
        role="dialog"
        style={sheet ? undefined : { top: place?.top ?? -9999, left: place?.left ?? -9999, maxHeight: place?.maxHeight, width: width || undefined, visibility: place ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
