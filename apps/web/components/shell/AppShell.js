"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useSession } from "./Providers"
import { Sidebar } from "./Sidebar"
import { CommandPalette } from "./CommandPalette"
import { Loader } from "../ui/Loader"
import { Icon } from "../ui/Icon"

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
    const allowed = pathname === "/properties" || pathname.startsWith("/properties/") || pathname === "/expenses" || pathname === "/settings"
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

  const shellClass = `app${menuOpen ? " menu-open" : ""}${collapsed ? " menu-collapsed" : ""}`

  return (
    <div className={shellClass}>
      <button type="button" className="nav-toggle" aria-label="Open sidebar" onClick={toggleMenu}>
        <Icon name="menu" size={18} />
      </button>
      <button type="button" className="menu-backdrop" aria-label="Close sidebar" onClick={() => setMenuOpen(false)} />
      <Sidebar user={session.user} onSearch={openSearch} onToggle={toggleMenu} onNavigate={() => setMenuOpen(false)} />
      <main className="main">{children}</main>
      <CommandPalette user={session.user} open={searchOpen} onClose={closeSearch} />
    </div>
  )
}
