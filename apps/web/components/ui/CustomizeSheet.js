"use client"

import { useState } from "react"
import { api } from "../../lib/api"
import { FormSheet } from "./FormSheet"

// Customize a page that is each person's own (Home, Insights): one tick per section. Saved to their account at `path`
// (PATCH { hidden }), so it follows them to every device; nobody else's page changes. Sections this account can't see
// right now (in `hidden` but not in `sections`) stay as they were.
export function CustomizeSheet({ eyebrow, title, hint, path, sections, hidden, onClose, onSaved }) {
  const [off, setOff] = useState(hidden)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const ids = sections.map((section) => section.id)

  async function save(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const kept = hidden.filter((id) => !ids.includes(id))
      const result = await api(path, { method: "PATCH", body: { hidden: [...kept, ...off.filter((id) => ids.includes(id))] } })
      onSaved(result.hidden)
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  const toggle = (id) => setOff((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))
  return (
    <FormSheet eyebrow={eyebrow} title={title} hint={hint} onClose={onClose} onSubmit={save} submitLabel="Save" pending={pending} error={error}>
      <div className="customize-sections">
        {sections.map((section) => (
          <label key={section.id} className="customize-choice">
            <input type="checkbox" checked={!off.includes(section.id)} onChange={() => toggle(section.id)} />
            <span>
              <strong>{section.name}</strong>
              <small>{section.hint}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="customize-all">
        <button type="button" className="tool" onClick={() => setOff([])} disabled={!off.length}>Show everything</button>
        <span>{ids.length - off.filter((id) => ids.includes(id)).length} of {ids.length} shown</span>
      </div>
    </FormSheet>
  )
}
