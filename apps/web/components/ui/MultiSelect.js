"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Icon } from "./Icon"

const CHIPS_SHOWN = 8

// Pick several from a long list: the chosen ones show as chips (× removes one); typing searches; the list opens
// under the box and stays open while you pick, with Select all / Clear. Works with the keyboard: arrows move,
// Enter picks, Backspace in the empty box removes the last chip, Escape closes the list.
export function MultiSelect({ options, selected, onChange, placeholder = "Search to add…", noun = ["item", "items"], emptyText = "Nothing to choose from yet." }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const box = useRef(null)
  const input = useRef(null)
  // The latest choices, so quick taps in a row each build on the one before (never on a stale copy).
  const latest = useRef(selected)
  latest.current = selected
  const listId = useId()
  const chosen = useMemo(() => new Set(selected), [selected])
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options])
  const needle = query.trim().toLowerCase()
  const shown = useMemo(() => options.filter((option) => !needle || `${option.label} ${option.hint || ""}`.toLowerCase().includes(needle)), [options, needle])
  const picked = selected.map((id) => byId.get(id)).filter(Boolean)
  const allShownPicked = shown.length > 0 && shown.every((option) => chosen.has(option.id))
  const many = (count) => `${count} ${count === 1 ? noun[0] : noun[1]}`

  useEffect(() => {
    if (!open) return undefined
    function away(event) {
      if (!box.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener("mousedown", away)
    document.addEventListener("touchstart", away, { passive: true })
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("touchstart", away)
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [needle])

  useEffect(() => {
    if (!open) return
    box.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, open])

  function change(next) {
    latest.current = next
    onChange(next)
  }

  function toggle(id) {
    const current = latest.current
    change(current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleShown() {
    const ids = shown.map((option) => option.id)
    const current = latest.current
    change(allShownPicked ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])])
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      // Picks in the list; never submits the form around it.
      event.preventDefault()
      if (open && shown[active]) toggle(shown[active].id)
      else setOpen(true)
    } else if (event.key === "Escape" && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    } else if (event.key === "Backspace" && !query && latest.current.length) {
      change(latest.current.slice(0, -1))
    }
  }

  if (!options.length) return <p className="muted">{emptyText}</p>
  const visibleChips = showAll ? picked : picked.slice(0, CHIPS_SHOWN)
  return (
    <div className={open ? "multi is-open" : "multi"} ref={box}>
      <div className="multi-box" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); input.current?.focus(); setOpen(true) } }}>
        {visibleChips.map((option) => (
          <span key={option.id} className="multi-chip">
            <span>{option.label}</span>
            <button type="button" aria-label={`Remove ${option.label}`} onClick={() => toggle(option.id)}><Icon name="close" size={12} /></button>
          </span>
        ))}
        {!showAll && picked.length > CHIPS_SHOWN && (
          <button type="button" className="multi-more" onClick={() => setShowAll(true)}>+{picked.length - CHIPS_SHOWN} more</button>
        )}
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          placeholder={picked.length ? "Add more…" : placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="multi-toggle" aria-label={open ? "Close the list" : "Open the list"} onClick={() => { setOpen((value) => !value); input.current?.focus() }}>
          <Icon name="chevron" size={14} />
        </button>
      </div>
      <div className="multi-summary">
        <span>{picked.length ? `${picked.length} of ${options.length} selected` : "None selected"}</span>
        {picked.length > 0 && <button type="button" onClick={() => { change([]); setShowAll(false) }}>Clear</button>}
        {showAll && picked.length > CHIPS_SHOWN && <button type="button" onClick={() => setShowAll(false)}>Show fewer</button>}
      </div>
      {open && (
        <div className="multi-panel">
          {shown.length > 1 && (
            <div className="multi-panel-bar">
              <button type="button" onClick={toggleShown}>{allShownPicked ? (needle ? "Unselect these" : "Clear all") : needle ? `Select these (${shown.length})` : `Select all (${shown.length})`}</button>
              <span>{needle ? `${many(shown.length)} match` : many(options.length)}</span>
            </div>
          )}
          <ul className="multi-list" role="listbox" id={listId} aria-multiselectable="true">
            {shown.map((option, index) => (
              <li
                key={option.id}
                role="option"
                aria-selected={chosen.has(option.id)}
                data-index={index}
                className={[chosen.has(option.id) ? "is-picked" : "", index === active ? "is-active" : ""].filter(Boolean).join(" ") || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => toggle(option.id)}
              >
                <span className="multi-check" aria-hidden="true">{chosen.has(option.id) && <Icon name="check" size={12} />}</span>
                <span className="multi-option">
                  <span>{option.label}</span>
                  {option.hint && <small>{option.hint}</small>}
                </span>
              </li>
            ))}
            {!shown.length && <li className="multi-empty">No {noun[1]} match “{query.trim()}”.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
