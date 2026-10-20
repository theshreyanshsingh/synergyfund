"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { homeFor } from "@synergifund/shared"
import { api, SIGNED_OUT } from "../../lib/api"
import { disablePush } from "../../lib/pwa"

const SessionContext = createContext(null)
const PUBLIC_PAGES = ["/privacy"]

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

  // A request answered "sign in" means the session is over: go to sign-in, keeping the page to come back to.
  useEffect(() => {
    const ended = () => setUser(null)
    window.addEventListener(SIGNED_OUT, ended)
    return () => window.removeEventListener(SIGNED_OUT, ended)
  }, [])

  // Coming back to the app re-reads who is signed in, so access an admin changed (or a removed account) shows
  // without a reload. At most once a minute.
  useEffect(() => {
    let checked = Date.now()
    function refresh() {
      if (document.visibilityState !== "visible" || Date.now() - checked < 60000) return
      checked = Date.now()
      api("/auth/me")
        .then((data) => setUser((current) => (current && JSON.stringify(current) === JSON.stringify(data.user) ? current : data.user)))
        .catch((err) => { if (err.status === 401) setUser(null) })
    }
    document.addEventListener("visibilitychange", refresh)
    return () => document.removeEventListener("visibilitychange", refresh)
  }, [])

  useEffect(() => {
    if (!ready) return
    if (user) leaving.current = false
    // Pages anyone can read, signed in or not (the app stores link to the privacy policy).
    if (PUBLIC_PAGES.includes(pathname)) return
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
    // This device's notifications belong to the person signing out: stop them before the session ends, so whoever
    // signs in next does not get their messages and calls (they can turn notifications on for themselves).
    if ("serviceWorker" in navigator) {
      await Promise.race([disablePush(), new Promise((resolve) => setTimeout(resolve, 4000))]).catch(() => {})
    }
    await api("/auth/logout", { method: "POST" }).catch(() => {})
    leaving.current = true
    setUser(null)
    router.replace("/login")
  }, [router])

  const value = useMemo(() => ({ user, ready, setUser, signOut }), [user, ready, signOut])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
