"use client"

import { useState } from "react"
import { TASK_LABELS, initials } from "@synergifund/shared"
import { Icon } from "../ui/Icon"
import { Popover } from "../ui/Popover"
import { PRIORITY_TONE, STATUS_TONE, TASK_PRIORITIES, TASK_STATUSES } from "./taskFormat"

// A cell (or field) that opens a small picker when clicked. `pick(close)` draws the picker.
export function PickerCell({ className = "", disabled = false, label, title, children, pick, width = null, align = "start" }) {
  const [anchor, setAnchor] = useState(null)
  if (disabled) return <span className={`${className} is-locked`.trim()} title={title}>{children}</span>
  return (
    <>
      <button type="button" className={className} aria-label={label} title={title} aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
        {children}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={width} align={align}>
          {pick(() => setAnchor(null))}
        </Popover>
      )}
    </>
  )
}

export function StatusPill({ status }) {
  return <span className={`task-status tone-${STATUS_TONE[status] || "grey"}`}>{status}</span>
}

export function PriorityPill({ priority }) {
  return <span className={`task-priority tone-${PRIORITY_TONE[priority] || "medium"}`}>{priority}</span>
}

export function Avatar({ name, size = "" }) {
  return <span className={`task-avatar ${size}`.trim()} aria-hidden="true">{name ? initials(name) : <Icon name="users" size={13} />}</span>
}

export function StatusOptions({ value, onPick }) {
  return (
    <div className="task-options" role="listbox" aria-label="Status">
      {TASK_STATUSES.map((status) => (
        <button key={status} type="button" role="option" aria-selected={status === value} className={`task-option-pill task-status tone-${STATUS_TONE[status]}${status === value ? " is-on" : ""}`} onClick={() => onPick(status)}>{status}</button>
      ))}
    </div>
  )
}

export function PriorityOptions({ value, onPick }) {
  return (
    <div className="task-options" role="listbox" aria-label="Priority">
      {TASK_PRIORITIES.map((priority) => (
        <button key={priority} type="button" role="option" aria-selected={priority === value} className={`task-option-pill task-priority tone-${PRIORITY_TONE[priority]}${priority === value ? " is-on" : ""}`} onClick={() => onPick(priority)}>{priority}</button>
      ))}
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <label className="task-pick-search">
      <Icon name="search" size={14} />
      <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  )
}

// Who to assign: search the team; Unassigned at the top.
export function PeopleOptions({ people, value, onPick, noneLabel = "Unassigned" }) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const shown = people.filter((person) => !needle || `${person.name} ${person.email || ""}`.toLowerCase().includes(needle))
  return (
    <div className="task-pick">
      <SearchBox value={query} onChange={setQuery} placeholder="Search names" />
      <div className="task-pick-list">
        {!needle && (
          <button type="button" className={!value ? "task-pick-row is-on" : "task-pick-row"} onClick={() => onPick("")}>
            <Avatar name="" />
            <span>{noneLabel}</span>
          </button>
        )}
        {shown.map((person) => (
          <button key={person.id} type="button" className={person.id === value ? "task-pick-row is-on" : "task-pick-row"} onClick={() => onPick(person.id)}>
            <Avatar name={person.name} />
            <span>{person.name}{person.email && <small>{person.email}</small>}</span>
          </button>
        ))}
        {!shown.length && <p className="task-pick-none">Nobody by that name.</p>}
      </div>
    </div>
  )
}

export function PropertyOptions({ properties, value, onPick, loading = false }) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const shown = properties.filter((property) => !needle || `${property.address} ${property.city || ""}`.toLowerCase().includes(needle)).slice(0, 80)
  return (
    <div className="task-pick">
      <SearchBox value={query} onChange={setQuery} placeholder="Search properties" />
      <div className="task-pick-list">
        {!needle && (
          <button type="button" className={!value ? "task-pick-row is-on" : "task-pick-row"} onClick={() => onPick("")}>
            <span className="task-pick-icon"><Icon name="close" size={13} /></span>
            <span>No property</span>
          </button>
        )}
        {shown.map((property) => (
          <button key={property.id} type="button" className={property.id === value ? "task-pick-row is-on" : "task-pick-row"} onClick={() => onPick(property.id, property)}>
            <span className="task-pick-icon"><Icon name="building" size={14} /></span>
            <span>{property.address}{property.city && <small>{property.city}</small>}</span>
          </button>
        ))}
        {loading && <p className="task-pick-none">Loading properties…</p>}
        {!loading && !shown.length && <p className="task-pick-none">No property matches that.</p>}
      </div>
    </div>
  )
}

// The preset labels (and any already in use), ticked on and off; a new one can be typed.
export function LabelOptions({ value, known = [], onChange }) {
  const [draft, setDraft] = useState("")
  const all = [...TASK_LABELS, ...known, ...value].filter((label, index, list) => list.findIndex((other) => other.toLowerCase() === label.toLowerCase()) === index)
  const on = (label) => value.some((item) => item.toLowerCase() === label.toLowerCase())
  const toggle = (label) => onChange(on(label) ? value.filter((item) => item.toLowerCase() !== label.toLowerCase()) : [...value, label].slice(0, 8))
  return (
    <div className="task-pick">
      <div className="task-label-options">
        {all.map((label) => (
          <button key={label} type="button" className={on(label) ? "task-label is-on" : "task-label"} aria-pressed={on(label)} onClick={() => toggle(label)}>
            {on(label) && <Icon name="tick" size={12} />}{label}
          </button>
        ))}
      </div>
      <form className="task-label-new" onSubmit={(event) => {
        event.preventDefault()
        const label = draft.trim().replace(/\s+/g, " ").slice(0, 32)
        if (label && !on(label)) onChange([...value, label].slice(0, 8))
        setDraft("")
      }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a label" aria-label="Add a label" maxLength={32} />
      </form>
    </div>
  )
}
