"use client"

import { memo, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { initials, navFor } from "@synergifund/shared"
import { api } from "../../lib/api"
import { Icon } from "../ui/Icon"

export const Sidebar = memo(function Sidebar({ user, onSearch, onToggle, onNavigate }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const items = navFor(user)
  const primary = items.filter((item) => item.zone === "primary")
  const sections = []
  for (const item of items.filter((entry) => entry.section)) {
    const found = sections.find((section) => section.label === item.section)
    if (found) found.items.push(item)
    else sections.push({ label: item.section, items: [item] })
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" })
    router.replace("/login")
    router.refresh()
  }

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <span className="mark">S</span>
        <span className="brand-name">SynergiFund</span>
        <button type="button" className="sidebar-dismiss" aria-label="Menu" onClick={onToggle}>
          <Icon name="menu" size={16} />
        </button>
      </div>
      <button type="button" className="quick" onClick={onSearch}>
        <Icon name="search" size={15} />
        <span>Quick Actions</span>
        <kbd>⌘K</kbd>
      </button>
      <SidebarNav primary={primary} sections={sections} onNavigate={onNavigate} />
      <div className="user-dock">
        {open && (
          <div className="user-pop">
            <div className="user-pop-id">
              <span className="avatar lg">{initials(user.name)}</span>
              <span>
                <strong>{user.name}</strong>
                <em>{user.email}</em>
              </span>
            </div>
            <ThemeButton />
            <button type="button" onClick={logout}><Icon name="logout" size={15} /> Logout</button>
          </div>
        )}
        <button type="button" className="user-button" onClick={() => setOpen((value) => !value)}>
          <span className="avatar">{initials(user.name)}</span>
          <span>
            <strong>{user.name}</strong>
            <em>{user.email}</em>
          </span>
        </button>
      </div>
    </aside>
  )
})

function ThemeButton() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark")
  }, [])
  function toggle() {
    const next = !dark
    document.documentElement.dataset.theme = next ? "dark" : "light"
    localStorage.setItem("synergifund-theme", next ? "dark" : "light")
    setDark(next)
  }
  return (
    <button type="button" onClick={toggle}>
      <Icon name={dark ? "sun" : "moon"} size={15} />
      {dark ? "Light mode" : "Dark mode"}
    </button>
  )
}

function SidebarNav({ primary, sections, onNavigate }) {
  const [counts, setCounts] = useState({ notifications: 0 })
  useEffect(() => {
    api("/counts").then(setCounts).catch(() => {})
  }, [])
  return (
    <nav className="nav">
      {primary.map((item) => (
        <NavLink key={item.label} item={item} count={counts[item.countKey] || 0} onNavigate={onNavigate} />
      ))}
      {sections.map((section) => (
        <div key={section.label} className="nav-section">
          <div className="nav-label">{section.label}</div>
          {section.items.map((item) => (
            <NavLink key={item.href + item.label} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  )
}

function NavLink({ item, count = 0, onNavigate }) {
  const pathname = usePathname()
  const active = pathname === item.href || (item.href !== "/overview" && pathname.startsWith(item.href))
  return (
    <Link href={item.href} className={active ? "nav-link is-active" : "nav-link"} onClick={() => onNavigate?.()}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {item.badge && <em className="nav-badge">{item.badge}</em>}
      {count > 0 && <em className="nav-count">{count}</em>}
    </Link>
  )
}
