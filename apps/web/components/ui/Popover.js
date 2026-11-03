"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

// A small panel opened from a button (`anchor`, its element): below it, or above when there is no room, kept on
// screen. A tap outside, Escape, or scrolling the page closes it.
export function Popover({ anchor, onClose, children, className = "", align = "start", width = null }) {
  const ref = useRef(null)
  const [place, setPlace] = useState(null)

  useLayoutEffect(() => {
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
  }, [anchor, align])

  useEffect(() => {
    const away = (event) => {
      if (ref.current?.contains(event.target) || anchor?.contains(event.target)) return
      onClose()
    }
    const key = (event) => { if (event.key === "Escape") onClose() }
    const scroll = (event) => { if (!ref.current?.contains(event.target)) onClose() }
    document.addEventListener("pointerdown", away, true)
    document.addEventListener("keydown", key)
    window.addEventListener("scroll", scroll, true)
    return () => {
      document.removeEventListener("pointerdown", away, true)
      document.removeEventListener("keydown", key)
      window.removeEventListener("scroll", scroll, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`.trim()}
      role="dialog"
      style={{ top: place?.top ?? -9999, left: place?.left ?? -9999, maxHeight: place?.maxHeight, width: width || undefined, visibility: place ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body,
  )
}
