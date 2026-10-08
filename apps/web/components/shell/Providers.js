"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { homeFor } from "@synergifund/shared"
import { api } from "../../lib/api"

const SessionContext = createContext(null)

export function useSession() {
  return useContext(SessionContext)
}

export function Providers({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

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
    const open = pathname === "/login" || pathname === "/register"
    if (!user && !open) router.replace("/login")
    if (user && open) router.replace(homeFor(user))
  }, [ready, user, pathname, router])

  const value = useMemo(() => ({ user, ready, setUser }), [user, ready])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
