"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { can, navFor, PERMISSIONS } from "@synergifund/shared"
import { Icon } from "../ui/Icon"

// The pages in the dock along the bottom on phones, tablets and narrow windows (then Search, five in all): Home, the
// Agent, Messages and Tasks. The sidebar leaves them out there; a computer screen keeps the full sidebar and no dock.
export const DOCK = ["/home", "/knowledge", "/messages", "/tasks"]
// A contractor's dock: their jobs, expenses, tasks and messages, then More (Channels, Calls, Settings, the theme and
// Log out). A computer screen keeps their top bar of links instead.
export const CONTRACTOR_DOCK = ["/properties", "/expenses", "/tasks", "/messages"]

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

function dockItems(user) {
  if (user?.role !== "contractor") return navFor(user).filter((item) => DOCK.includes(item.href)).sort((a, b) => DOCK.indexOf(a.href) - DOCK.indexOf(b.href))
  // (Tasks only for a contractor who can work on theirs, as on their top bar.)
  return navFor(user)
    .filter((item) => CONTRACTOR_DOCK.includes(item.href) && (item.href !== "/tasks" || can(user, PERMISSIONS.tasksEdit)))
    .sort((a, b) => CONTRACTOR_DOCK.indexOf(a.href) - CONTRACTOR_DOCK.indexOf(b.href))
}

// `more`: the contractor's last button, { open, onOpen }, in place of Search.
export function Dock({ user, searching = false, onSearch, agentOpen = false, onAgent, unread = 0, more = null }) {
  const pathname = usePathname()
  const items = dockItems(user)
  const covered = searching || Boolean(more?.open)
  return (
    <nav className="dock" aria-label="Main">
      {items.map((item) => {
        const agent = item.href === "/knowledge"
        const on = !covered && (agent ? agentOpen || pathname === item.href : !agentOpen && docked(item.href, pathname))
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
      {more ? (
        <button type="button" className={more.open ? "dock-link is-on" : "dock-link"} aria-haspopup="dialog" aria-expanded={more.open} onClick={more.onOpen}>
          <span className="dock-icon"><Icon name="more" size={21} /></span>
          <span>More</span>
        </button>
      ) : (
        <button type="button" className={searching ? "dock-link is-on" : "dock-link"} onClick={onSearch}>
          <span className="dock-icon"><Icon name="search" size={21} /></span>
          <span>Search</span>
        </button>
      )}
    </nav>
  )
}
