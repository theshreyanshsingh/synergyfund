"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { can, initials, navFor, PERMISSIONS } from "@synergifund/shared"
import { api } from "../../lib/api"
import { useChatEvents } from "../../lib/chatSocket"
import { Icon } from "../ui/Icon"
import { InstallCard } from "../pwa/InstallCard"
import { useSession } from "./Providers"

// Unread @mentions in channels and unread direct messages, kept live (for the contractor's top bar).
export function useChatBadges(me, enabled) {
  const [counts, setCounts] = useState({ channels: 0, direct: 0 })
  const timer = useRef(null)
  const refresh = useCallback((delay = 1200) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      api("/chat/unread").then((data) => setCounts({ channels: data.channels || 0, direct: data.direct || 0 })).catch(() => {})
    }, delay)
  }, [])
  useEffect(() => {
    if (enabled) refresh(0)
    return () => clearTimeout(timer.current)
  }, [enabled, refresh])
  useChatEvents({
    "message:new": ({ message, channel }) => {
      if (message && message.userId !== me && (channel?.kind === "direct" || message.mentionsChannel || (message.mentionIds || []).includes(me))) refresh()
    },
    read: () => refresh(),
    "channel:remove": () => refresh(),
    "chat:refresh": () => refresh(),
    reconnect: () => refresh(),
  }, enabled)
  return counts
}

export const Sidebar = memo(function Sidebar({ user, onSearch, onToggle, onNavigate }) {
  const [open, setOpen] = useState(false)
  const items = navFor(user)
  const primary = items.filter((item) => item.zone === "primary")
  const sections = []
  for (const item of items.filter((entry) => entry.section)) {
    const found = sections.find((section) => section.label === item.section)
    if (found) found.items.push(item)
    else sections.push({ label: item.section, items: [item] })
  }

  const session = useSession()
  function logout() {
    session.signOut()
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
      <InstallCard className="sidebar-install" />
      <button type="button" className="quick" onClick={onSearch}>
        <Icon name="search" size={15} />
        <span>Quick Actions</span>
        <kbd>⌘K</kbd>
      </button>
      <SidebarNav primary={primary} sections={sections} onNavigate={onNavigate} chat={can(user, PERMISSIONS.chatUse)} me={user.id} />
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
            <Link href="/settings" onClick={() => setOpen(false)}><Icon name="settings" size={15} /> Settings</Link>
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

function SidebarNav({ primary, sections, onNavigate, chat, me }) {
  const pathname = usePathname()
  const [counts, setCounts] = useState({ notifications: 0, channels: 0, direct: 0 })
  const timer = useRef(null)
  const onNotifications = useRef(pathname === "/notifications")
  onNotifications.current = pathname === "/notifications"
  useEffect(() => {
    // Counted before the Notifications page marks them read, so keep 0 while that page is open.
    api("/counts").then((data) => setCounts({ ...data, ...(onNotifications.current ? { notifications: 0 } : {}) })).catch(() => {})
    return () => clearTimeout(timer.current)
  }, [])
  // Opening Notifications reads them, so the count clears.
  useEffect(() => {
    if (pathname === "/notifications") setCounts((current) => ({ ...current, notifications: 0 }))
  }, [pathname])
  function refreshChat() {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      api("/chat/unread").then((data) => setCounts((current) => ({ ...current, channels: data.channels, direct: data.direct }))).catch(() => {})
    }, 1200)
  }
  function onMessage({ message, channel, read }) {
    if (!message || message.userId === me || read) return
    if (channel?.kind === "direct" || message.mentionsChannel || (message.mentionIds || []).includes(me)) refreshChat()
  }
  function onNotification() {
    if (pathname === "/notifications") return
    setCounts((current) => ({ ...current, notifications: (current.notifications || 0) + 1 }))
  }
  useChatEvents({ "message:new": onMessage, read: refreshChat, "channel:remove": refreshChat, "chat:refresh": refreshChat, reconnect: refreshChat, "notification:new": onNotification }, chat)
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
