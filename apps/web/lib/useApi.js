"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"

export function useApi(path) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const requestId = useRef(0)
  const reload = useCallback(async () => {
    const id = ++requestId.current
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
