"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Icon } from "./Icon"

const ROW_HEIGHT = 36

// A ⋯ button and its small menu. An item can have `divider` (a line above it), `danger` (red), or `items` of its own:
// a submenu ("Move to ▸") that opens in place of the menu, with a way back, so it works on phones too.
// `className` is added to the menu (e.g. "keep-case" for sentence-case items).
export function RowMenu({ items, label = "More actions", className = "" }) {
  const [place, setPlace] = useState(null)
  const [submenu, setSubmenu] = useState(null)
  const button = useRef(null)
  const menu = useRef(null)
  const shown = items.filter(Boolean)

  useEffect(() => {
    if (!place) return
    function onDown(event) {
      if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) close()
    }
    function onKey(event) {
      if (event.key === "Escape") close()
    }
    // The page scrolling moves the button away from the menu; scrolling a long menu itself does not.
    function onScroll(event) {
      if (!menu.current?.contains(event.target)) close()
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [place])

  if (!shown.length) return null

  function close() {
    setPlace(null)
    setSubmenu(null)
  }

  function toggle(event) {
    event.stopPropagation()
    if (place) {
      close()
      return
    }
    const rect = button.current.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    // Below the button when the longest list it can show fits there (a submenu has a back row too), otherwise on
    // the side with more room, scrolling inside if it is still too long.
    const rows = Math.max(shown.length, ...shown.map((item) => (item.items?.length || 0) + 1))
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    setPlace(below >= rows * ROW_HEIGHT + 24 || below >= above ? { top: rect.bottom + 6, right, maxHeight: below } : { bottom: window.innerHeight - rect.top + 6, right, maxHeight: above })
  }

  const list = submenu ? submenu.items : shown
  return (
    <>
      <button ref={button} type="button" className="row-menu-button" aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(place)} onClick={toggle}>
        <Icon name="more" size={18} />
      </button>
      {place && createPortal(
        <div ref={menu} className={["row-menu", className].filter(Boolean).join(" ")} role="menu" style={place} onClick={(event) => event.stopPropagation()}>
          {submenu && (
            <button type="button" role="menuitem" className="row-menu-back" onClick={() => setSubmenu(null)}>
              <Icon name="back" size={14} /> {submenu.label}
            </button>
          )}
          {list.map((item) => (
            <div key={item.label} className="row-menu-entry">
              {item.divider && <hr className="row-menu-divider" />}
              <button
                type="button"
                role="menuitem"
                className={item.danger ? "danger" : undefined}
                aria-haspopup={item.items ? "menu" : undefined}
                disabled={item.items ? !item.items.length : undefined}
                onClick={() => {
                  if (item.items) {
                    setSubmenu(item)
                    return
                  }
                  close()
                  item.onClick()
                }}
              >
                <span>{item.label}</span>
                {item.items && <span className="row-menu-more" aria-hidden="true"><Icon name="chevron" size={12} /></span>}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
