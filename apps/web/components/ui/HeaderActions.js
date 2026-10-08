"use client"

import { Children, useEffect, useRef, useState } from "react"
import { Icon } from "./Icon"

export function HeaderActions({ children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const grouped = Children.toArray(children).filter(Boolean).length > 1

  useEffect(() => {
    if (!open) return
    function onDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (!grouped) return <div className="draws-actions">{children}</div>

  return (
    <div ref={ref} className={open ? "header-actions is-open" : "header-actions"}>
      <button type="button" className="import-button header-actions-toggle" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        Options
        <Icon name="chevron" size={14} />
      </button>
      <div className="draws-actions header-actions-menu" onClick={() => setOpen(false)}>
        {children}
      </div>
    </div>
  )
}
