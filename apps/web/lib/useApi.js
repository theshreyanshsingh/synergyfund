"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"

// Pass no path (null or "") to skip the request, for example when this person may not see it.
export function useApi(path) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(Boolean(path))
  const requestId = useRef(0)
  const reload = useCallback(async () => {
    const id = ++requestId.current
    if (!path) {
      setData(null)
      setError("")
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const next = await api(path)
      if (id !== requestId.current) return
      setData(next)
      setError("")
    } catch (err) {
      if (id !== requestId.current) return
      setError(err.message)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [path])
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload }
}
