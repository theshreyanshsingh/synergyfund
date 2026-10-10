"use client"

import { useMemo, useState } from "react"
import { isPendingDraw } from "@synergifund/shared"
import { FormSheet } from "../ui/FormSheet"
import { Icon } from "../ui/Icon"
import { api } from "../../lib/api"

function key(title) {
  return String(title || "").toLowerCase().replace(/\s+/g, " ").trim()
}

function money(value) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value))
}

function parseMoney(text) {
  const clean = String(text ?? "").replace(/[$,\s]/g, "")
  if (!clean) return null
  const value = Number(clean)
  return Number.isFinite(value) ? value : NaN
}

function usedByOthers(project, skipId) {
  const used = new Map()
  for (const draw of project.draws) {
    if (draw.id === skipId) continue
    for (const line of draw.lines || []) {
      const amount = Number(line.amount) || 0
      if (amount) used.set(key(line.title), (used.get(key(line.title)) || 0) + amount)
    }
  }
  return used
}

async function saveScope(project, rows) {
  const lines = rows.filter((row) => row.title.trim()).map((row) => ({ id: row.id || undefined, title: row.title.trim(), description: row.description || "", budget: row.budget === "" ? null : row.budget }))
  const data = await api(`/draws/scope/${project.id}`, { method: "PUT", body: { lines } })
  return data.scopeLines
}

export function nextDrawTitle(project) {
  const highest = project.draws.reduce((max, draw) => {
    const match = String(draw.title || "").match(/^draw\s+(\d+)$/i)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `Draw ${highest + 1}`
}

export function DrawEditor({ project, draw, onClose, onSaved }) {
  const editing = Boolean(draw)
  const used = useMemo(() => usedByOthers(project, draw?.id), [project, draw])
  const [title, setTitle] = useState(draw?.title || nextDrawTitle(project))
  const [status, setStatus] = useState("Requested")
  const [forecast, setForecast] = useState(draw?.requestedDate || "")
  const [received, setReceived] = useState(draw ? String(draw.pulled ?? draw.fundedAmount ?? "") : "")
  const [rows, setRows] = useState(() => {
    const amounts = new Map((draw?.lines || []).map((line) => [key(line.title), line.amount ?? ""]))
    const fromScope = project.scopeLines.map((line) => ({
      id: line.id,
      title: line.title,
      description: line.description || "",
      budget: line.budget ?? "",
      amount: amounts.has(key(line.title)) ? String(amounts.get(key(line.title))) : "",
    }))
    const scopeKeys = new Set(fromScope.map((row) => key(row.title)))
    const extra = (draw?.lines || []).filter((line) => !scopeKeys.has(key(line.title))).map((line) => ({ title: line.title, description: line.description || "", budget: "", amount: String(line.amount ?? ""), loose: true }))
    return [...fromScope, ...extra]
  })
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const unassigned = editing && !(draw.lines || []).length ? Number(draw.amount) || 0 : 0
  const total = rows.reduce((sum, row) => sum + (Number(parseMoney(row.amount)) || 0), 0)

  function update(index, patch) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  }

  function addLine() {
    setRows((current) => [...current, { title: "", description: "", budget: "", amount: "", isNew: true }])
  }

  async function submit(event) {
    event.preventDefault()
    setError("")
    const bad = rows.find((row) => row.amount !== "" && (Number.isNaN(parseMoney(row.amount)) || parseMoney(row.amount) < 0))
    if (bad) return setError(`Enter a valid amount for ${bad.title || "the new line item"}.`)
    const newRows = rows.filter((row) => row.isNew)
    if (newRows.some((row) => !row.title.trim() && parseMoney(row.amount))) return setError("Name every new line item you draw against.")
    const titles = rows.filter((row) => row.title.trim()).map((row) => key(row.title))
    if (new Set(titles).size !== titles.length) return setError("Two line items have the same name. Give each its own name.")
    const lines = rows.filter((row) => row.title.trim() && parseMoney(row.amount) > 0).map((row) => ({ title: row.title.trim(), description: row.description || "", amount: parseMoney(row.amount) }))
    if (!lines.length) return setError("Enter an amount on at least one line item.")
    if (!title.trim()) return setError("Give the draw a name.")
    if (editing && received !== "" && (Number.isNaN(parseMoney(received)) || parseMoney(received) < 0)) return setError("Received needs to be zero or more.")
    setPending(true)
    try {
      const scopeChanged = newRows.some((row) => row.title.trim()) || rows.some((row) => row.loose && parseMoney(row.amount) > 0)
      if (scopeChanged) {
        const scopeRows = rows.filter((row) => row.title.trim() && (!row.loose || parseMoney(row.amount) > 0))
        await saveScope(project, scopeRows.map((row) => ({ ...row, budget: row.isNew || row.loose ? (row.budget === "" ? "" : parseMoney(row.budget)) : row.budget })))
      }
      if (editing) {
        const body = { title: title.trim(), requestedDate: forecast, lines }
        const before = Number(draw.pulled ?? draw.fundedAmount ?? 0) || 0
        if (received !== "" && parseMoney(received) !== before) body.fundedAmount = parseMoney(received)
        await api(`/draws/${draw.id}`, { method: "PATCH", body })
      } else {
        await api("/draws", { method: "POST", body: { propertyId: project.id, title: title.trim(), status, requestedDate: forecast, lines } })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet
      eyebrow={project.address}
      title={editing ? `Edit ${draw.title}` : `New draw · ${title}`}
      hint="A draw is made of line items. Enter how much of each line this draw takes."
      onClose={onClose}
      onSubmit={submit}
      submitLabel={editing ? "Save draw" : `Create draw · ${money(total)}`}
      pending={pending}
      error={error}
    >
      <div className="form-grid draw-editor-fields">
        <label className="field"><span>Name</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
        {!editing && (
          <label className="field"><span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="Requested">Pending (requested)</option>
              <option value="Funded">Funded (cash received)</option>
            </select>
          </label>
        )}
        {editing && (
          <label className="field"><span>Received <em>· cash in</em></span><input inputMode="decimal" value={received} placeholder="$0" onChange={(event) => setReceived(event.target.value)} /></label>
        )}
        <label className={editing ? "field" : "field wide"}><span>Forecast finish <em>· optional</em></span><input type="date" value={forecast} onChange={(event) => setForecast(event.target.value)} /></label>
      </div>
      {unassigned > 0 && (
        <p className="draw-editor-note">This draw has {money(unassigned)} that isn’t tied to a line item yet. Split it across the lines below; the draw total becomes the sum of its lines.</p>
      )}
      <div className="draw-editor-lines">
        <div className="draw-editor-head"><span>Line items</span><b>{money(total)}</b></div>
        {!rows.length && <p className="draw-editor-empty">This property has no line items yet. Add the scope of work below, then enter this draw’s amount for each line.</p>}
        {rows.map((row, index) => {
          const budget = parseMoney(row.budget)
          const left = budget == null || Number.isNaN(budget) ? null : budget - (used.get(key(row.title)) || 0)
          const amount = Number(parseMoney(row.amount)) || 0
          const over = left != null && amount > left + 0.5
          return (
            <div key={row.id || `row-${index}`} className={`draw-editor-line${row.isNew ? " is-new" : ""}${over ? " is-over" : ""}`}>
              {row.isNew ? (
                <div className="draw-editor-newline">
                  <input value={row.title} placeholder="Line item, e.g. Roofing" aria-label="Line item name" onChange={(event) => update(index, { title: event.target.value })} />
                  <input value={row.description} placeholder="Description (optional)" aria-label="Line item description" onChange={(event) => update(index, { description: event.target.value })} />
                  <input value={row.budget} inputMode="decimal" placeholder="Budget" aria-label="Line item budget" onChange={(event) => update(index, { budget: event.target.value })} />
                </div>
              ) : (
                <div className="draw-editor-copy">
                  <b>{row.title}</b>
                  {row.description && <small>{row.description}</small>}
                  <em>{budget != null && !Number.isNaN(budget) ? `Budget ${money(budget)} · ${money(left)} left` : row.loose ? "Not in the line items yet. It will be added." : "No budget set"}</em>
                </div>
              )}
              <div className="draw-editor-amount">
                <input
                  value={row.amount}
                  inputMode="decimal"
                  placeholder="$0"
                  aria-label={`${row.title || "New line"} amount`}
                  onChange={(event) => update(index, { amount: event.target.value })}
                />
                {left > 0 && !row.isNew && (
                  <button type="button" onClick={() => update(index, { amount: String(Math.round(left * 100) / 100) })}>Rest</button>
                )}
                {row.isNew && (
                  <button type="button" aria-label="Remove line" onClick={() => setRows((current) => current.filter((_, at) => at !== index))}><Icon name="close" size={12} /></button>
                )}
              </div>
              {over && <p className="draw-editor-warn">{money(amount - left)} over this line’s budget</p>}
            </div>
          )
        })}
        <button type="button" className="draw-step-add" onClick={addLine}><Icon name="plus" size={14} />Add a line item</button>
      </div>
      {project.draws.some((item) => isPendingDraw(item) && item.id !== draw?.id) && !editing && status === "Requested" && (
        <p className="draw-editor-note">This property already has a pending draw. Make sure this isn’t the same request.</p>
      )}
    </FormSheet>
  )
}

export function ScopeEditor({ project, onClose, onSaved }) {
  const [rows, setRows] = useState(() => (project.scopeLines.length ? project.scopeLines : [{ title: "", description: "", budget: "" }]).map((line) => ({ id: line.id, title: line.title || "", description: line.description || "", budget: line.budget ?? "" })))
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const total = rows.reduce((sum, row) => sum + (Number(parseMoney(row.budget)) || 0), 0)
  const budget = Number(project.figures.budget) || 0

  function update(index, patch) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  }

  async function submit(event) {
    event.preventDefault()
    setError("")
    const bad = rows.find((row) => row.title.trim() && row.budget !== "" && (Number.isNaN(parseMoney(row.budget)) || parseMoney(row.budget) < 0))
    if (bad) return setError(`Enter a valid budget for ${bad.title}.`)
    setPending(true)
    try {
      await saveScope(project, rows.map((row) => ({ ...row, budget: row.budget === "" ? "" : parseMoney(row.budget) })))
      onSaved()
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet
      eyebrow={project.address}
      title="Line items"
      hint="The scope of work. Every draw is split across these lines."
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Save line items"
      pending={pending}
      error={error}
    >
      <div className="draw-editor-lines">
        <div className="draw-editor-head">
          <span>{rows.filter((row) => row.title.trim()).length} line items</span>
          <b className={budget && Math.abs(total - budget) > 1 ? "is-off" : undefined}>{money(total)}{budget ? ` of ${money(budget)}` : ""}</b>
        </div>
        {rows.map((row, index) => (
          <div key={row.id || `new-${index}`} className="draw-editor-line is-scope">
            <div className="draw-editor-newline">
              <input value={row.title} placeholder="Line item, e.g. Roofing" aria-label="Line item name" onChange={(event) => update(index, { title: event.target.value })} />
              <input value={row.description} placeholder="Description (optional)" aria-label="Line item description" onChange={(event) => update(index, { description: event.target.value })} />
              <input value={row.budget} inputMode="decimal" placeholder="Budget" aria-label="Line item budget" onChange={(event) => update(index, { budget: event.target.value })} />
            </div>
            <button type="button" className="draw-editor-remove" aria-label={`Remove ${row.title || "line"}`} onClick={() => setRows((current) => current.filter((_, at) => at !== index))}><Icon name="close" size={12} /></button>
          </div>
        ))}
        <button type="button" className="draw-step-add" onClick={() => setRows((current) => [...current, { title: "", description: "", budget: "" }])}><Icon name="plus" size={14} />Add a line item</button>
        {budget > 0 && Math.abs(total - budget) > 1 && <p className="draw-editor-warn">Line budgets add up to {money(total)}, but the property budget is {money(budget)}.</p>}
      </div>
    </FormSheet>
  )
}
