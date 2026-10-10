"use client"

import { useEffect } from "react"

export function NoZoom() {
  useEffect(() => {
    const block = (event) => event.preventDefault()
    const pinch = (event) => {
      if (event.touches && event.touches.length > 1) event.preventDefault()
    }
    let lastTap = 0
    const doubleTap = (event) => {
      const now = Date.now()
      const interactive = event.target.closest?.("button, a, input, textarea, select, label, summary, video, [role='button'], [contenteditable='true']")
      if (now - lastTap < 300 && !interactive) event.preventDefault()
      lastTap = now
    }
    document.addEventListener("gesturestart", block, { passive: false })
    document.addEventListener("gesturechange", block, { passive: false })
    document.addEventListener("gestureend", block, { passive: false })
    document.addEventListener("touchmove", pinch, { passive: false })
    document.addEventListener("touchend", doubleTap, { passive: false })
    return () => {
      document.removeEventListener("gesturestart", block)
      document.removeEventListener("gesturechange", block)
      document.removeEventListener("gestureend", block)
      document.removeEventListener("touchmove", pinch)
      document.removeEventListener("touchend", doubleTap)
    }
  }, [])
  return null
}
