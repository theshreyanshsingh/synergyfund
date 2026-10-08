"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Icon } from "./Icon"

export function RowMenu({ items, label = "More actions" }) {
  const [place, setPlace] = useState(null)
  const button = useRef(null)
  const menu = useRef(null)
  const shown = items.filter(Boolean)

  useEffect(() => {
    if (!place) return
    function onDown(event) {
      if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) setPlace(null)
    }
    function onKey(event) {
      if (event.key === "Escape") setPlace(null)
    }
    function dismiss() {
      setPlace(null)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", dismiss)
    window.addEventListener("scroll", dismiss, true)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", dismiss)
      window.removeEventListener("scroll", dismiss, true)
    }
  }, [place])

  if (!shown.length) return null

  function toggle(event) {
    event.stopPropagation()
    if (place) {
      setPlace(null)
      return
    }
    const rect = button.current.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    setPlace(window.innerHeight - rect.bottom > 180 ? { top: rect.bottom + 6, right } : { bottom: window.innerHeight - rect.top + 6, right })
  }

  return (
    <>
      <button ref={button} type="button" className="row-menu-button" aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(place)} onClick={toggle}>
        <Icon name="more" size={18} />
      </button>
      {place && createPortal(
        <div ref={menu} className="row-menu" role="menu" style={place} onClick={(event) => event.stopPropagation()}>
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : undefined}
              onClick={() => {
                setPlace(null)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
