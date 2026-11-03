"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { NAV } from "@synergifund/shared"

// Back buttons that go back one step at a time and say where to. Each history entry keeps (in history.state) the page
// you came from and, on a page with steps of its own (a property's tabs and folders), the steps before this one. So the
// page's Back, the browser's and a swipe back all retrace the same steps, and a reload keeps them.
const KEY = "synergifundBack"
const MAX_STEPS = 40
const titles = new Map()
let current = ""
let previous = ""

// AppShell: every page opened in this tab.
export function notePage(path) {
  if (!path || path === current) return
  previous = current
  current = path
}

// A detail page's title (an address, a company's name), so a Back to it can say it.
export function noteTitle(path, title) {
  if (path && typeof title === "string" && title) titles.set(path, title)
}

function labelFor(path) {
  return titles.get(path) || NAV.find((item) => item.href === path)?.label || "Back"
}

function here() {
  return window.location.pathname + window.location.search
}

// Where Back goes from here: `label` ("" when nothing in the app came before, so the page links to its list instead)
// and `go`. `to(url, label)` takes a step on the page, `label` naming the step you leave; a step to where you just
// were is a Back, so going back and forth between two tabs doesn't pile up.
export function useBack() {
  const pathname = usePathname()
  const query = useSearchParams().toString()
  const [entry, setEntry] = useState(null)

  useEffect(() => {
    let saved = window.history.state?.[KEY]
    if (!saved) {
      // This can run before or after AppShell notes this page.
      const from = current && current !== pathname ? current : previous && previous !== pathname ? previous : ""
      saved = { from: from ? { path: from, label: labelFor(from) } : null, steps: [] }
      window.history.replaceState({ ...window.history.state, [KEY]: saved }, "")
    }
    setEntry(saved)
  }, [pathname, query])

  function to(url, label) {
    if (url === here()) return
    const now = entry || { from: null, steps: [] }
    if (now.steps.at(-1)?.url === url) {
      window.history.back()
      return
    }
    window.history.pushState({ [KEY]: { from: now.from, steps: [...now.steps, { url: here(), label }].slice(-MAX_STEPS) } }, "", url)
  }

  return { label: entry?.steps.at(-1)?.label || entry?.from?.label || "", go: () => window.history.back(), to }
}
