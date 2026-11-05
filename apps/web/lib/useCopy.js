"use client"

import { useEffect, useRef, useState } from "react"

// Copies text to the clipboard, the old way where a web view can't write it. `copied` is "yes" or "no" for a moment
// after (for a tick or a message), then false again.
export function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy(text) {
    let ok = true
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      try {
        ok = document.execCommand("copy")
      } catch {
        ok = false
      }
      area.remove()
    }
    setCopied(ok ? "yes" : "no")
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
    return ok
  }
  return [copied, copy]
}
