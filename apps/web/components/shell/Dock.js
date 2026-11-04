"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { navFor } from "@synergifund/shared"
import { Icon } from "../ui/Icon"

// The pages in the dock along the bottom on phones, tablets and narrow windows (then Search, five in all): Home, the
// Agent, Messages and Tasks. The sidebar leaves them out there; a computer screen keeps the full sidebar and no dock.
export const DOCK = ["/home", "/knowledge", "/messages", "/tasks"]

// Shorter names where the dock's slot is narrow.
const DOCK_LABELS = { "/messages": "Messages" }
const PHONE = "(max-width: 760px)"

export function isActive(href, pathname) {
  return pathname === href || (href !== "/overview" && pathname.startsWith(href))
}

// Messages is lit on Channels too (the same conversations app), and counts what is unread in both.
function docked(href, pathname) {
  return href === "/messages" ? pathname === "/messages" || pathname === "/chat" : isActive(href, pathname)
}

export function Dock({ user, searching, onSearch, agentOpen = false, onAgent, unread = 0 }) {
  const pathname = usePathname()
  const items = navFor(user).filter((item) => DOCK.includes(item.href)).sort((a, b) => DOCK.indexOf(a.href) - DOCK.indexOf(b.href))
  return (
    <nav className="dock" aria-label="Main">
      {items.map((item) => {
        const agent = item.href === "/knowledge"
        const on = !searching && (agent ? agentOpen || pathname === item.href : !agentOpen && docked(item.href, pathname))
        const count = item.href === "/messages" ? unread : 0
        return (
          <Link
            key={item.href}
            href={item.href}
            className={on ? "dock-link is-on" : "dock-link"}
            aria-current={on ? "page" : undefined}
            onClick={(event) => {
              // On a phone the Agent slides up over the page (as from the menu) instead of opening its own page.
              if (agent && onAgent && pathname !== item.href && window.matchMedia(PHONE).matches) {
                event.preventDefault()
                onAgent()
              }
            }}
          >
            <span className="dock-icon">
              <Icon name={item.icon} size={21} />
              {count > 0 && <em className="dock-count" aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</em>}
            </span>
            <span>{DOCK_LABELS[item.href] || item.label}</span>
          </Link>
        )
      })}
      <button type="button" className={searching ? "dock-link is-on" : "dock-link"} onClick={onSearch}>
        <span className="dock-icon"><Icon name="search" size={21} /></span>
        <span>Search</span>
      </button>
    </nav>
  )
}
