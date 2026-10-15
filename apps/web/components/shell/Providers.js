"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { homeFor } from "@synergifund/shared"
import { api } from "../../lib/api"

const SessionContext = createContext(null)

export function useSession() {
  return useContext(SessionContext)
}

// Where to go after signing in: the page a link (like "Open in SynergiFund" in an email) was opening when sign-in was
// needed, or this person's home page.
export function landingFor(user) {
  if (typeof window === "undefined") return homeFor(user)
  const next = new URLSearchParams(window.location.search).get("next") || ""
  const safe = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !/^\/(login|register)\b/.test(next)
  return safe ? next : homeFor(user)
}

export function Providers({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const leaving = useRef(false)

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])

  useEffect(() => {
    api("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready) return
    if (user) leaving.current = false
    const open = pathname === "/login" || pathname === "/register"
    if (!user && !open) {
      // Keep the page that was asked for, to come back to it once signed in (not after logging out).
      const asked = `${pathname}${window.location.search}`
      router.replace(!leaving.current && pathname && pathname !== "/" ? `/login?next=${encodeURIComponent(asked)}` : "/login")
    }
    if (user && open) router.replace(landingFor(user))
  }, [ready, user, pathname, router])

  // Logging out forgets the signed-in person here too, so the sign-in page does not send them straight back in.
  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {})
    leaving.current = true
    setUser(null)
    router.replace("/login")
  }, [router])

  const value = useMemo(() => ({ user, ready, setUser, signOut }), [user, ready, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
