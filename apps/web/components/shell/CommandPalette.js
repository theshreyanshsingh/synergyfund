"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { navFor } from "@synergifund/shared"
import { api } from "../../lib/api"
import { Icon } from "../ui/Icon"

export function CommandPalette({ user, open, onClose }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [properties, setProperties] = useState([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setActive(0)
      return undefined
    }
    api("/properties").then((data) => setProperties(data.items || [])).catch(() => {})
    function onKey(event) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const match = (item) => !needle || `${item.label} ${item.hint}`.toLowerCase().includes(needle)
    const pages = navFor(user)
      .map((item) => ({ id: item.href, label: item.label, hint: item.section || "", href: item.href, icon: item.icon }))
      .filter(match)
    const deals = properties
      .map((property) => ({ id: property.id, label: property.address, hint: property.city || property.stage || "Property", href: `/properties/${property.id}`, icon: "building" }))
      .filter(match)
      .slice(0, 8)
    return [
      pages.length ? { label: "Pages", items: pages } : null,
      deals.length ? { label: "Properties", items: deals } : null,
    ].filter(Boolean)
  }, [query, properties, user])

  const flat = groups.flatMap((group) => group.items)

  useEffect(() => {
    setActive(0)
  }, [query])

  function openItem(item) {
    if (!item) return
    router.push(item.href)
    onClose()
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(flat.length - 1, 0)))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      openItem(flat[active])
    }
  }

  if (!open) return null
  let cursor = 0
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(event) => event.stopPropagation()}>
        <label className="palette-search">
          <Icon name="search" size={16} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Search properties and pages" />
          <kbd>esc</kbd>
        </label>
        <div className="palette-list">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="palette-label">{group.label}</div>
              {group.items.map((item) => {
                const index = cursor
                cursor += 1
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={index === active ? "palette-row is-active" : "palette-row"}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => openItem(item)}
                  >
                    <Icon name={item.icon} size={16} />
                    <strong>{item.label}</strong>
                    <span>{item.hint}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {!flat.length && <p className="palette-empty">No matches for “{query.trim()}”.</p>}
        </div>
      </div>
    </div>
  )
}
