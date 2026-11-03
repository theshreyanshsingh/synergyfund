"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { navFor } from "@synergifund/shared"
import { Icon } from "../ui/Icon"

// The pages in the dock along the bottom on phones, tablets and narrow windows (then Search, five in all). The
// sidebar leaves them out there; a computer screen keeps the full sidebar and no dock.
export const DOCK = ["/overview", "/properties", "/draws", "/tasks"]

export function isActive(href, pathname) {
  return pathname === href || (href !== "/overview" && pathname.startsWith(href))
}

export function Dock({ user, searching, onSearch }) {
  const pathname = usePathname()
  const items = navFor(user).filter((item) => DOCK.includes(item.href)).sort((a, b) => DOCK.indexOf(a.href) - DOCK.indexOf(b.href))
  return (
    <nav className="dock" aria-label="Main">
      {items.map((item) => {
        const on = !searching && isActive(item.href, pathname)
        return (
          <Link key={item.href} href={item.href} className={on ? "dock-link is-on" : "dock-link"} aria-current={on ? "page" : undefined}>
            <span className="dock-icon"><Icon name={item.icon} size={21} /></span>
            <span>{item.label}</span>
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
