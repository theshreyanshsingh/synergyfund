"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { can, PERMISSIONS } from "@synergifund/shared"
import { useSession } from "./Providers"
import { Sidebar } from "./Sidebar"
import { CommandPalette } from "./CommandPalette"
import { Loader } from "../ui/Loader"
import { Icon } from "../ui/Icon"
import { InstallCard } from "../pwa/InstallCard"
import { CallLayer } from "../calls/CallLayer"
import { SoundAlerts } from "./SoundAlerts"
import { DownloadTray } from "./DownloadTray"

const NARROW = "(max-width: 1100px)"

export function AppShell({ children }) {
  const session = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (session?.user?.role !== "contractor") return
    const allowed = pathname === "/properties" || pathname.startsWith("/properties/") || pathname === "/expenses" || pathname === "/tasks" || pathname === "/settings" || pathname === "/chat" || pathname === "/calls" || pathname.startsWith("/calls/")
    if (!allowed) router.replace("/properties")
  }, [pathname, session, router])

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") setMenuOpen(false)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function toggleMenu() {
    if (window.matchMedia(NARROW).matches) setMenuOpen((open) => !open)
    else setCollapsed((closed) => !closed)
  }

  if (!session?.ready || !session.user) {
    return <Loader />
  }

  if (session.user.role === "contractor") {
    return (
      <div className="app is-contractor">
        <header className="contractor-bar">
          <Link href="/properties" className="contractor-brand">
            <span className="mark">S</span>
            <span>SynergiFund</span>
          </Link>
          <nav className="contractor-nav" aria-label="Main">
            <Link href="/expenses" className={pathname === "/expenses" ? "contractor-link is-on" : "contractor-link"}>Expenses</Link>
            {/* Tasks assigned to them, which their "Task assigned" emails open. */}
            {can(session.user, PERMISSIONS.tasksEdit) && <Link href="/tasks" className={pathname === "/tasks" ? "contractor-link is-on" : "contractor-link"}>To-do</Link>}
            {can(session.user, PERMISSIONS.chatUse) && <Link href="/chat" className={pathname === "/chat" ? "contractor-link is-on" : "contractor-link"}>Chat</Link>}
            {can(session.user, PERMISSIONS.chatUse) && <Link href="/calls" className={pathname === "/calls" ? "contractor-link is-on" : "contractor-link"}>Calls</Link>}
            <Link href="/settings" className={pathname === "/settings" ? "contractor-link is-on" : "contractor-link"}>Settings</Link>
          </nav>
          <div className="contractor-tools">
            <span className="contractor-person">{session.user.name}</span>
            <ThemeToggle />
            <button type="button" className="tool" onClick={() => session.signOut()}>Logout</button>
          </div>
        </header>
        <main className="main">
          <InstallCard className="bar-install" />
          {children}
        </main>
        {can(session.user, PERMISSIONS.chatUse) && <CallLayer user={session.user} />}
        <SoundAlerts user={session.user} chat={can(session.user, PERMISSIONS.chatUse)} />
        <DownloadTray />
      </div>
    )
  }

  const shellClass = `app${menuOpen ? " menu-open" : ""}${collapsed ? " menu-collapsed" : ""}`

  return (
    <div className={shellClass}>
      <button type="button" className="nav-toggle" aria-label="Open sidebar" onClick={toggleMenu}>
        <Icon name="menu" size={18} />
      </button>
      <button type="button" className="menu-backdrop" aria-label="Close sidebar" onClick={() => setMenuOpen(false)} />
      <Sidebar user={session.user} onSearch={openSearch} onToggle={toggleMenu} onNavigate={() => setMenuOpen(false)} />
      <main className="main">
        <InstallCard className="bar-install main-install" />
        {children}
      </main>
      <CommandPalette user={session.user} open={searchOpen} onClose={closeSearch} />
      {can(session.user, PERMISSIONS.chatUse) && <CallLayer user={session.user} />}
      <SoundAlerts user={session.user} chat={can(session.user, PERMISSIONS.chatUse)} />
      <DownloadTray />
    </div>
  )
}

function ThemeToggle() {
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
    <button type="button" className="icon-btn contractor-theme" aria-label={dark ? "Light mode" : "Dark mode"} onClick={toggle}>
      <Icon name={dark ? "sun" : "moon"} size={16} />
    </button>
  )
}
