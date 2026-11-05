"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { can, PERMISSIONS } from "@synergifund/shared"
import { useSession } from "./Providers"
import { Sidebar, useChatBadges } from "./Sidebar"
import { CommandPalette } from "./CommandPalette"
import { Loader } from "../ui/Loader"
import { Icon } from "../ui/Icon"
import { InstallCard } from "../pwa/InstallCard"
import { CallLayer } from "../calls/CallLayer"
import { SoundAlerts } from "./SoundAlerts"
import { DownloadTray } from "./DownloadTray"
import { Dock } from "./Dock"
import { MoreSheet, useTheme } from "./MoreSheet"
import { AgentSheet } from "../agent/AgentSheet"
import { notePage } from "../../lib/back"

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
  // What is waiting on Channels and Messages: on the contractor's top bar, and on Messages in the dock.
  const badges = useChatBadges(session?.user?.id, Boolean(session?.user && can(session.user, PERMISSIONS.chatUse)))
  // Phones: Agent in the menu slides up over the page instead of opening its own page.
  const [agentOpen, setAgentOpen] = useState(false)
  const openAgent = useCallback(() => {
    setMenuOpen(false)
    setAgentOpen(true)
  }, [])
  const closeAgent = useCallback(() => setAgentOpen(false), [])
  // A contractor's More (from the dock on phones and tablets).
  const [moreOpen, setMoreOpen] = useState(false)
  const signedIn = Boolean(session?.ready && session.user)

  // While the app (not sign-in) is showing, phones paint the edges above and below it the color of its top bar and
  // dock: in the phone app that is the strip behind the clock and the home bar, so the dock reaches the bottom edge.
  useEffect(() => {
    if (!signedIn) return undefined
    document.documentElement.classList.add("has-shell")
    return () => document.documentElement.classList.remove("has-shell")
  }, [signedIn])

  // Notes each page opened, so a detail page's Back can say where it goes ("← Calendar").
  useEffect(() => {
    setMenuOpen(false)
    setAgentOpen(false)
    setMoreOpen(false)
    notePage(pathname)
  }, [pathname])

  useEffect(() => {
    if (session?.user?.role !== "contractor") return
    const allowed = pathname === "/properties" || pathname.startsWith("/properties/") || pathname === "/expenses" || pathname === "/tasks" || pathname === "/settings" || pathname === "/chat" || pathname === "/messages" || pathname === "/calls" || pathname.startsWith("/calls/")
    if (!allowed) router.replace("/properties")
  }, [pathname, session, router])

  // A notification tapped in the phone app opens its page here without reloading, so a call in progress carries on.
  useEffect(() => {
    function onOpen(event) {
      const path = String(event.detail || "")
      if (!path.startsWith("/") || path.startsWith("//")) return
      event.preventDefault()
      router.push(path)
    }
    window.addEventListener("synergifund:open", onOpen)
    return () => window.removeEventListener("synergifund:open", onOpen)
  }, [router])

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
      <div className="app is-contractor has-dock">
        <SkipLink />
        <header className="contractor-bar">
          <Link href="/properties" className="contractor-brand">
            <span className="mark">S</span>
            <span>SynergiFund</span>
          </Link>
          <nav className="contractor-nav" aria-label="Main">
            <Link href="/expenses" className={pathname === "/expenses" ? "contractor-link is-on" : "contractor-link"}>Expenses</Link>
            {/* Tasks assigned to them, which their "Task assigned" emails open. */}
            {can(session.user, PERMISSIONS.tasksEdit) && <Link href="/tasks" className={pathname === "/tasks" ? "contractor-link is-on" : "contractor-link"}>Tasks</Link>}
            {can(session.user, PERMISSIONS.chatUse) && <Link href="/chat" className={pathname === "/chat" ? "contractor-link is-on" : "contractor-link"}>Channels{badges.channels > 0 && <em className="contractor-count">{badges.channels}</em>}</Link>}
            {can(session.user, PERMISSIONS.chatUse) && <Link href="/messages" className={pathname === "/messages" ? "contractor-link is-on" : "contractor-link"}>Messages{badges.direct > 0 && <em className="contractor-count">{badges.direct}</em>}</Link>}
            {can(session.user, PERMISSIONS.chatUse) && <Link href="/calls" className={pathname === "/calls" ? "contractor-link is-on" : "contractor-link"}>Calls</Link>}
            <Link href="/settings" className={pathname === "/settings" ? "contractor-link is-on" : "contractor-link"}>Settings</Link>
          </nav>
          <div className="contractor-tools">
            <span className="contractor-person">{session.user.name}</span>
            <ThemeToggle />
            <button type="button" className="tool" onClick={() => session.signOut()}>Logout</button>
          </div>
        </header>
        <main className="main" id="main" tabIndex={-1}>
          <InstallCard className="bar-install" />
          {children}
        </main>
        {/* Phones and tablets: their pages along the bottom, and More for the rest (the links above are hidden there). */}
        <Dock user={session.user} unread={badges.channels + badges.direct} more={{ open: moreOpen, onOpen: () => setMoreOpen(true) }} />
        {moreOpen && <MoreSheet user={session.user} badges={badges} onClose={() => setMoreOpen(false)} onSignOut={() => session.signOut()} />}
        {can(session.user, PERMISSIONS.chatUse) && <CallLayer user={session.user} />}
        <SoundAlerts user={session.user} chat={can(session.user, PERMISSIONS.chatUse)} />
        <DownloadTray />
      </div>
    )
  }

  const shellClass = `app has-dock${menuOpen ? " menu-open" : ""}${collapsed ? " menu-collapsed" : ""}`

  return (
    <div className={shellClass}>
      {/* Keyboard and screen-reader users jump past the menu to the page. */}
      <SkipLink />
      <button type="button" className="nav-toggle" aria-label="Open sidebar" onClick={toggleMenu}>
        <Icon name="menu" size={18} />
      </button>
      <button type="button" className="menu-backdrop" aria-label="Close sidebar" onClick={() => setMenuOpen(false)} />
      <Sidebar user={session.user} onSearch={openSearch} onToggle={toggleMenu} onNavigate={() => setMenuOpen(false)} onAgent={openAgent} />
      <main className="main" id="main" tabIndex={-1}>
        <InstallCard className="bar-install main-install" />
        {children}
      </main>
      {/* Phones, tablets and narrow windows: the main pages and Search along the bottom; the sidebar keeps the rest. */}
      <Dock user={session.user} searching={searchOpen} onSearch={openSearch} agentOpen={agentOpen} onAgent={openAgent} unread={badges.channels + badges.direct} />
      {agentOpen && <AgentSheet onClose={closeAgent} />}
      <CommandPalette user={session.user} open={searchOpen} onClose={closeSearch} />
      {can(session.user, PERMISSIONS.chatUse) && <CallLayer user={session.user} />}
      <SoundAlerts user={session.user} chat={can(session.user, PERMISSIONS.chatUse)} />
      <DownloadTray />
    </div>
  )
}

function ThemeToggle() {
  const [dark, toggle] = useTheme()
  return (
    <button type="button" className="icon-btn contractor-theme" aria-label={dark ? "Light mode" : "Dark mode"} onClick={toggle}>
      <Icon name={dark ? "sun" : "moon"} size={16} />
    </button>
  )
}

// "Skip to content": moves focus to the page (without adding #main to the address or a step to Back).
function SkipLink() {
  return (
    <a
      href="#main"
      className="skip-link"
      onClick={(event) => {
        event.preventDefault()
        document.getElementById("main")?.focus()
      }}
    >
      Skip to content
    </a>
  )
}
