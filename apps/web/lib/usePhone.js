"use client"

import { useEffect, useState } from "react"

export const PHONE = "(max-width: 760px)"

// True while the screen matches `query` (a phone by default), and again whenever it starts or stops matching.
export function usePhone(query = PHONE) {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setPhone(list.matches)
    update()
    list.addEventListener("change", update)
    return () => list.removeEventListener("change", update)
  }, [query])
  return phone
}
