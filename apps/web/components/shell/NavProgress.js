"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

// Gives up on a page that never arrives (the bar fades rather than sitting there).
const GIVE_UP_MS = 10000
const FADE_MS = 450

// A thin bar along the top from the moment a link to another page is tapped until that page shows, so a tap always
// answers at once (a page that is already loaded shows before the bar would). Links that open something over the page
// instead (the Agent on a phone) carry data-no-progress.
export function NavProgress() {
  const pathname = usePathname()
  const [state, setState] = useState("idle")

  useEffect(() => {
    function onClick(event) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!link || link.closest("[data-no-progress]") || link.hasAttribute("download") || (link.target && link.target !== "_self")) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      setState("going")
    }
    // (Capture: a link's own handler cancels the click before it would reach the document.)
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])

  useEffect(() => {
    setState((current) => (current === "going" ? "done" : current))
  }, [pathname])

  useEffect(() => {
    if (state === "idle") return undefined
    const timer = setTimeout(() => setState(state === "going" ? "done" : "idle"), state === "going" ? GIVE_UP_MS : FADE_MS)
    return () => clearTimeout(timer)
  }, [state])

  return <div className={`nav-progress is-${state}`} aria-hidden="true" />
}
