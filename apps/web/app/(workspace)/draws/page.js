"use client"

import Link from "next/link"
import { Fragment, useMemo, useRef, useState } from "react"
import { can } from "@synergifund/shared"
import { DrawImport } from "../../../components/draws/DrawImport"
import { FormSheet, InfoSheet } from "../../../components/ui/FormSheet"
import { HeaderActions } from "../../../components/ui/HeaderActions"
import { Icon } from "../../../components/ui/Icon"
import { PageSpinner } from "../../../components/ui/Spinner"
import { StatusPill } from "../../../components/ui/StatusPill"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useApi } from "../../../lib/useApi"

const FUND_WINDOW = [4, 5]

export default function DrawsPage() {
  const session = useSession()
  const data = useApi("/draws")
  const writable = session?.user && can(session.user, "draws.write")
  const canDeleteProperty = session?.user && can(session.user, "properties.write")
  const canImport = writable && can(session.user, "imports.run")
  const importInput = useRef(null)
  const [workbook, setWorkbook] = useState(null)
  const [view, setView] = useState("sheet")
  const [moneyView, setMoneyView] = useState("calendar")
  const [sort, setSort] = useState("forecast")
  const [openId, setOpenId] = useState("")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")
  const [report, setReport] = useState(null)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const projects = useMemo(
    () => sortProjects(buildProjects(data.data), sort),
    [data.data, sort],
  )
  const totals = useMemo(() => sumProjects(projects), [projects])

  async function create(event) {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await api("/draws", { method: "POST", body: form })
      setAdding(false)
      setError("")
      data.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function forecast(id, requestedDate) {
    await api(`/draws/${id}`, { method: "PATCH", body: { requestedDate } })
    data.reload()
  }

  async function savePulled(id, fundedAmount) {
    await api(`/draws/${id}`, { method: "PATCH", body: { fundedAmount } })
    data.reload()
  }

  async function removeProperty(project) {
    if (!window.confirm(`Delete ${project.address}? This removes the property, its draws, and its records.`)) return
    await api(`/properties/${project.id}`, { method: "DELETE" })
    data.reload()
  }

  async function saveSheetValue({ project, column, draw, value }) {
    const text = String(value ?? "").trim()
    if (!text) {
      if (column === "budget") await api(`/properties/${project.id}`, { method: "PATCH", body: { rehabBudget: null } })
      else if (column === "funding" && project.budgetId) await api(`/draws/budgets/${project.budgetId}`, { method: "PATCH", body: { fundingLimit: 0 } })
      else if (draw) await api(`/draws/${draw.id}`, { method: "DELETE" })
      await data.reload()
      return
    }
    const amount = Number(text.replace(/[$,\s]/g, ""))
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid amount.")
    if (column === "budget") {
      await api(`/properties/${project.id}`, { method: "PATCH", body: { rehabBudget: amount } })
    } else if (column === "funding") {
      if (project.budgetId) {
        await api(`/draws/budgets/${project.budgetId}`, { method: "PATCH", body: { fundingLimit: amount } })
      } else {
        await api("/draws/budgets", {
          method: "POST",
          body: { propertyId: project.id, title: "Lender funding", budget: project.totalBudget, fundingLimit: amount },
        })
      }
    } else if (draw) {
      await api(`/draws/${draw.id}`, { method: "PATCH", body: { amount } })
    } else if (amount > 0) {
      await api("/draws", {
        method: "POST",
        body: { propertyId: project.id, title: `Draw ${column}`, amount },
      })
    }
    await data.reload()
  }

  async function pull(id) {
    const result = await api(`/draws/${id}/pull`, { method: "POST", body: {} })
    setReport(result.report)
    data.reload()
  }

  if (data.loading && !data.data) {
    return (
      <div className="draws workspace">
        <div className="workspace-top">
          <div className="page-heading"><h1 className="page-title">Draws</h1></div>
        </div>
        <PageSpinner />
      </div>
    )
  }

  return (
    <div className="draws workspace">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Draws</h1>
        </div>
        <HeaderActions>
          <a className="import-button" href="/api/draws/export">Export Excel</a>
          {canImport && (
            <button type="button" className="import-button" onClick={() => importInput.current?.click()}>Import Excel</button>
          )}
          {writable && (
            <button type="button" className="primary" onClick={() => { setError(""); setAdding(true) }}>
              <Icon name="plus" size={14} />
              Add draw
            </button>
          )}
        </HeaderActions>
      </div>

      <div className="stats">
        <article className="stat"><div className="stat-label">Received</div><div className="stat-value">{cash(totals.received)}</div><div className="stat-hint">Lender cash already in</div></article>
        <article className="stat"><div className="stat-label">Forecasted</div><div className="stat-value">{cash(totals.forecast)}</div><div className="stat-hint">Open draws with a finish date</div></article>
        <article className="stat"><div className="stat-label">Undrawn</div><div className="stat-value">{cash(totals.remaining)}</div><div className="stat-hint">{cash(totals.total)} on the schedules</div></article>
        <article className="stat"><div className="stat-label">Rehab left</div><div className="stat-value">{cash(totals.rehabLeft)}</div><div className="stat-hint">{cash(totals.spent)} posted in costs</div></article>
      </div>

      <div className="panel draws-toolbar">
        <div className="seg">
          <button type="button" className={view === "sheet" ? "on" : ""} onClick={() => setView("sheet")}>Sheet</button>
          <button type="button" className={view === "properties" ? "on" : ""} onClick={() => setView("properties")}>Cards</button>
          <button type="button" className={view === "money" ? "on" : ""} onClick={() => setView("money")}>Money</button>
        </div>
        {view === "properties" ? (
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="forecast">Money forecasted</option>
            <option value="least">Least complete</option>
            <option value="most">Most complete</option>
          </select>
        ) : view === "money" ? (
          <div className="seg">
            <button type="button" className={moneyView === "calendar" ? "on" : ""} onClick={() => setMoneyView("calendar")}>Calendar</button>
            <button type="button" className={moneyView === "timeline" ? "on" : ""} onClick={() => setMoneyView("timeline")}>Timeline</button>
          </div>
        ) : <span />}
      </div>

      {canImport && (
        <DrawImport
          job={workbook}
          inputRef={importInput}
          onOpen={setWorkbook}
          onChange={setWorkbook}
          onReload={data.reload}
        />
      )}

      {data.error && <p className="draws-empty">{data.error}</p>}

      {view === "sheet" && <DrawSheet projects={projects} writable={writable} canDelete={canDeleteProperty} onSave={saveSheetValue} onRemove={removeProperty} />}

      {view === "properties" && (
        <div className="draw-board">
          {projects.map((project) => (
            <PropertyCard
              key={project.id}
              project={project}
              open={openId === project.id}
              writable={writable}
              onToggle={() => setOpenId(openId === project.id ? "" : project.id)}
              onForecast={forecast}
              onPull={pull}
              onPulled={savePulled}
            />
          ))}
          {!projects.length && !data.error && <p className="draws-empty">No properties yet.</p>}
        </div>
      )}

      {view === "money" && moneyView === "calendar" && (
        <>
          <ReceivedMoney projects={projects} />
          <MoneyCalendar projects={projects} month={month} onMonth={setMonth} />
        </>
      )}
      {view === "money" && moneyView === "timeline" && <MoneyTimeline projects={projects} />}

      {report && (
        <InfoSheet eyebrow="Draws" title="What changed" hint={report.summary} onClose={() => setReport(null)}>
          <ul className="plain-list">{report.changes.map((change) => <li key={change}>{change}</li>)}</ul>
        </InfoSheet>
      )}
      {adding && (
        <FormSheet eyebrow="Draws" title="Add a draw" hint="A draw is lender rehab cash for one property. Set a finish date when you want it in the forecast." onClose={() => setAdding(false)} onSubmit={create} submitLabel="Save draw" error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Property</span>
              <select name="propertyId" required>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.address}</option>)}
              </select>
            </label>
            <label className="field"><span>Name</span><input name="title" required placeholder="Draw 1" /></label>
            <label className="field"><span>Gross amount</span><input name="amount" inputMode="decimal" /></label>
            <label className="field wide"><span>Forecast finish</span><input name="requestedDate" type="date" /></label>
          </div>
        </FormSheet>
      )}
    </div>
  )
}

function DrawSheet({ projects, writable, canDelete, onSave, onRemove }) {
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [hidden, setHidden] = useState([])
  const [openId, setOpenId] = useState("")
  const columns = [
    { id: "property", label: "Property" },
    { id: "budget", label: "Total Budget" },
    { id: "funding", label: "Lender Funding" },
    { id: "drawn", label: "Drawn to Date" },
    { id: "pulled", label: "Cash Received" },
    { id: "remaining", label: "Remaining" },
    { id: "status", label: "Status" },
    { id: "draws", label: "Draws" },
  ]
  const shown = columns.filter((column) => !hidden.includes(column.id))
  const value = (project, column) => {
    const draws = scheduledDraws(project)
    if (column.id === "property") return project.address || project.name || "Untitled property"
    if (column.id === "budget") return cash(project.totalBudget)
    if (column.id === "funding") return cash(project.lenderFunding)
    if (column.id === "drawn" || column.id === "pulled") {
      const total = draws.reduce((sum, line) => sum + Number(column.id === "drawn" ? line.amount : line.pulled) || 0, 0)
      return total ? cash(total) : ""
    }
    if (column.id === "remaining") return cash(Math.max(0, (Number(project.totalBudget) || 0) - draws.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)))
    if (column.id === "status") return project.nextAction || project.stage || "Active"
    return ""
  }
  const cell = (project, column) => {
    if (column.id === "draws") return <DrawsToggle project={project} open={openId === project.id} onToggle={() => setOpenId(openId === project.id ? "" : project.id)} />
    const editable = writable && (column.id === "budget" || column.id === "funding")
    if (!editable) return value(project, column)
    return (
      <SheetMoneyCell
        value={column.id === "budget" ? project.totalBudget : project.lenderFunding}
        label={`${project.address} ${column.label}`}
        onSave={(next) => onSave({ project, column: column.id, value: next })}
      />
    )
  }
  const details = shown.filter((column) => !["property", "remaining", "draws"].includes(column.id) && (column.id !== "budget" || writable))
  const schedule = (project) => (
    <DrawSchedule
      project={project}
      writable={writable}
      onSave={(number, draw, next) => onSave({ project, column: number, draw, value: next })}
    />
  )
  return (
    <section className="draw-sheet panel">
      <div className="sheet-tools">
        <p><b>{projects.length}</b> properties · <b>{projects.reduce((sum, project) => sum + scheduledDraws(project).length, 0)}</b> draws{writable ? <span className="sheet-hint"> · Click a budget to edit it, or open Draws to change a draw</span> : ""}</p>
        <div className="column-picker">
          <button type="button" className="import-button" onClick={() => setColumnsOpen((current) => !current)}>Columns · {shown.length}</button>
          {columnsOpen && (
            <div className="column-menu">
              {columns.map((column) => (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(column.id)}
                    onChange={() => setHidden((current) => current.includes(column.id) ? current.filter((id) => id !== column.id) : [...current, column.id])}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="excel-wrap">
        <table className="excel-sheet">
          <thead><tr><th className="row-number">#</th>{shown.map((column) => <th key={column.id} className={column.id === "property" ? "pin-col" : undefined}>{column.label}</th>)}</tr></thead>
          <tbody>
            {projects.map((project, index) => (
              <Fragment key={project.id}>
                <tr className={openId === project.id ? "is-open" : undefined}>
                  <th className="row-number">{index + 1}</th>
                  {shown.map((column) => (
                    <td key={column.id} className={column.id === "property" ? "pin-col" : column.id === "status" || column.id === "draws" ? undefined : "num"}>
                      {column.id === "property" ? (
                        <span className="sheet-property">
                          <Link href={`/properties/${project.id}`}>{value(project, column)}</Link>
                          {canDelete && <button type="button" className="sheet-remove" onClick={() => onRemove(project)}>Remove</button>}
                        </span>
                      ) : cell(project, column)}
                    </td>
                  ))}
                </tr>
                {openId === project.id && (
                  <tr className="sheet-expand">
                    <td colSpan={shown.length + 1}>{schedule(project)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!projects.length && <p className="draws-empty">No draw data yet. Import a workbook to add it.</p>}
      </div>
      <div className="sheet-list">
        {projects.map((project) => (
          <SheetListItem
            key={project.id}
            project={project}
            name={value(project, columns[0])}
            budget={value(project, columns[1])}
            remaining={value(project, columns[5])}
            fields={details}
            cell={cell}
            schedule={schedule}
            canDelete={canDelete}
            onRemove={onRemove}
          />
        ))}
        {!projects.length && <p className="draws-empty">No draw data yet. Import a workbook to add it.</p>}
      </div>
    </section>
  )
}

function SheetListItem({ project, name, budget, remaining, fields, cell, schedule, canDelete, onRemove }) {
  const [open, setOpen] = useState(false)
  return (
    <article className={open ? "sheet-item is-open" : "sheet-item"}>
      <button type="button" className="sheet-item-head" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <b>{name}</b>
        <span><small>Budget</small>{budget}</span>
        <span><small>Remaining</small>{remaining}</span>
        <i aria-hidden="true"><Icon name="chevron" size={16} /></i>
      </button>
      {open && (
        <div className="sheet-item-body">
          {fields.length > 0 && (
            <dl>
              {fields.map((column) => (
                <div key={column.id}>
                  <dt>{column.label}</dt>
                  <dd>{cell(project, column) || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
          {schedule(project)}
          <div className="sheet-item-actions">
            <Link href={`/properties/${project.id}`}>Open property</Link>
            {canDelete && <button type="button" className="sheet-remove" onClick={() => onRemove(project)}>Remove</button>}
          </div>
        </div>
      )}
    </article>
  )
}

function DrawsToggle({ project, open, onToggle }) {
  const draws = scheduledDraws(project)
  return (
    <button type="button" className="draws-toggle" aria-expanded={open} onClick={onToggle}>
      <span>{draws.length ? `${draws.length} ${draws.length === 1 ? "draw" : "draws"}` : "No draws"}</span>
      <DrawMeter project={project} draws={draws} />
      <i aria-hidden="true"><Icon name="chevron" size={14} /></i>
    </button>
  )
}

function DrawMeter({ project, draws }) {
  const drawn = draws.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const scale = Math.max(Number(project.totalBudget) || 0, drawn)
  return (
    <span className="draw-meter" aria-hidden="true">
      {scale > 0 && draws.map((line) => (
        <i key={line.id} className={drawState(line)} style={{ width: `${((Number(line.amount) || 0) / scale) * 100}%` }} />
      ))}
    </span>
  )
}

function DrawSchedule({ project, writable, onSave }) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")
  const draws = scheduledDraws(project)
  const drawn = draws.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const received = draws.reduce((sum, line) => sum + (Number(line.pulled) || 0), 0)
  const budget = Number(project.totalBudget) || 0
  const next = draws.reduce((max, line) => Math.max(max, drawIndex(line.title)), 0) + 1

  async function add(event) {
    const text = event.currentTarget.value.trim()
    setAdding(false)
    if (!text) return
    setError("")
    try {
      await onSave(next, null, text)
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(line) {
    if (!window.confirm(`Remove ${line.title} from ${project.address}?`)) return
    setError("")
    try {
      await onSave(drawIndex(line.title), line, "")
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="draw-schedule">
      <div className="draw-schedule-head">
        <span><b>{draws.length} {draws.length === 1 ? "draw" : "draws"}</b> · {cash(drawn)}{budget ? ` of ${cash(budget)}` : ""} drawn</span>
        <span>{cash(received)} received{budget ? ` · ${cash(Math.max(0, budget - drawn))} left` : ""}</span>
      </div>
      <DrawMeter project={project} draws={draws} />
      {draws.length === 0 && !adding && <p className="draws-empty">No draws on this property yet.</p>}
      <ol className="draw-steps">
        {draws.map((line) => (
          <li key={line.id} className={drawState(line)}>
            <span className="draw-step-no">{drawIndex(line.title)}</span>
            <span className="draw-step-copy">
              <b>{line.title}</b>
              <small>{drawNote(line)}</small>
            </span>
            <span className="draw-step-amount">
              {writable ? (
                <SheetMoneyCell value={line.amount} label={`${project.address} ${line.title}`} onSave={(text) => onSave(drawIndex(line.title), line, text)} />
              ) : cash(line.amount)}
            </span>
            {writable && (
              <button type="button" className="draw-step-remove" aria-label={`Remove ${line.title}`} onClick={() => remove(line)}>
                <Icon name="close" size={14} />
              </button>
            )}
          </li>
        ))}
        {adding && (
          <li className="is-new">
            <span className="draw-step-no">{next}</span>
            <span className="draw-step-copy"><b>Draw {next}</b><small>Enter the gross amount</small></span>
            <span className="draw-step-amount">
              <input
                className="sheet-money-input"
                autoFocus
                inputMode="decimal"
                aria-label={`Draw ${next} amount`}
                onBlur={add}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur()
                  if (event.key === "Escape") setAdding(false)
                }}
              />
            </span>
          </li>
        )}
      </ol>
      {error && <p className="draw-schedule-error">{error}</p>}
      {writable && !adding && (
        <button type="button" className="draw-step-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          Add draw {next}
        </button>
      )}
    </div>
  )
}

function scheduledDraws(project) {
  return project.lines
    .filter((line) => drawIndex(line.title))
    .sort((a, b) => drawIndex(a.title) - drawIndex(b.title))
}

function drawState(line) {
  const amount = Number(line.amount) || 0
  const pulled = Number(line.pulled) || 0
  if (pulled > 0 && pulled >= amount) return "is-received"
  if (pulled > 0) return "is-partial"
  return "is-open"
}

function drawNote(line) {
  const pulled = Number(line.pulled) || 0
  const amount = Number(line.amount) || 0
  if (pulled > 0 && pulled >= amount) return `Received${line.fundedDate ? ` ${shortDate(line.fundedDate)}` : ""}`
  if (pulled > 0) return `${cash(pulled)} received`
  if (line.requestedDate) return `Forecast ${shortDate(line.requestedDate)}`
  return "Not received"
}

function SheetMoneyCell({ value, label, onSave }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const original = value == null ? "" : String(value)

  async function commit(event) {
    const next = event.currentTarget.value.trim()
    setEditing(false)
    if (next === original) return
    setBusy(true)
    setMessage("")
    try {
      await onSave(next)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <input
        className="sheet-money-input"
        autoFocus
        defaultValue={original}
        inputMode="decimal"
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") setEditing(false)
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className={message ? "sheet-money-value has-error" : "sheet-money-value"}
      disabled={busy}
      title={message || `Edit ${label}`}
      onClick={() => setEditing(true)}
    >
      {busy ? "Saving…" : value == null ? "—" : cash(value)}
    </button>
  )
}

function PropertyCard({ project, open, writable, onToggle, onForecast, onPull, onPulled }) {
  const arrival = forecastWindow(project)
  const pct = project.schedule ? Math.round(project.pct * 100) : null
  return (
    <article className={open ? "draw-card open" : "draw-card"}>
      <button type="button" className="draw-card-head" onClick={onToggle}>
        <div className="draw-card-top">
          <div>
            <h2>{project.address}</h2>
            <p>{[project.city, project.strategy].filter(Boolean).join(" · ")}</p>
          </div>
          <StatusPill>{project.stage}</StatusPill>
        </div>
        <div className="draw-metrics">
          <div><b className={project.received ? "got" : ""}>{cash(project.received)}</b><span>Received</span></div>
          <div><b>{cash(project.undrawn)}</b><span>Undrawn</span></div>
          <div><b>{cash(project.schedule)}</b><span>{project.scheduleLabel}</span></div>
          <div><b>{cash(project.spent)}</b><span>Costs posted</span></div>
        </div>
        {project.schedule != null && (
          <div className="draw-progress">
            <div className="draw-track"><i style={{ width: `${pct}%` }} /></div>
            <span>{pct}%</span>
          </div>
        )}
        <div className="draw-card-foot">
          {project.rehabBudget != null && <span>Rehab budget {cash(project.rehabBudget)} · {cash(project.rehabLeft)} left after costs</span>}
          {project.pending > 0 && <span>{cash(project.pending)} waiting on approval</span>}
          {project.forecast > 0 && arrival && <span className="draw-chip">{cash(project.forecast)} forecast {arrival}</span>}
          {project.schedule == null && <span>No rehab budget or draw schedule on this property.</span>}
        </div>
      </button>
      {open && (
        <div className="draw-body">
          <h3>Draw lines</h3>
          {project.lines.length === 0 && <p className="draws-empty">No draw has been recorded. The schedule above is the figure already stored on the property.</p>}
          {project.lines.map((line) => (
            <DrawRow key={line.id} line={line} writable={writable} onForecast={onForecast} onPull={onPull} onPulled={onPulled} />
          ))}
        </div>
      )}
    </article>
  )
}

function DrawRow({ line, writable, onForecast, onPull, onPulled }) {
  const [open, setOpen] = useState(false)
  const amount = line.amount
  const pulled = line.pulled ?? (line.status === "Funded" ? line.fundedAmount ?? line.amount : line.fundedAmount || 0)
  const remaining = line.remaining ?? (amount == null ? null : Math.max(0, Number(amount) - Number(pulled || 0)))
  return (
    <article className={open ? "draw-fold is-open" : "draw-fold"}>
      <button type="button" className="draw-fold-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span><small>Draw</small><b>{line.title}</b></span>
        <span><small>Amount</small><b>{cash(amount)}</b></span>
        <span><small>Pulled</small><b>{cash(pulled)}</b></span>
        <span><small>Remaining</small><b>{cash(remaining)}</b></span>
        <i>{open ? "Hide" : "Open"}</i>
      </button>
      {open && (
        <div className="draw-fold-body">
          <table className="sow-table">
            <thead><tr><th>Line item</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              {(line.lines || []).length === 0 && <tr><td colSpan="3">No scope lines on this draw yet.</td></tr>}
              {(line.lines || []).map((item) => (
                <tr key={item.id || item.title}><td>{item.title}</td><td>{item.description || "—"}</td><td>{cash(item.amount)}</td></tr>
              ))}
            </tbody>
          </table>
          {writable && (
            <form className="draw-line-actions" onSubmit={(event) => { event.preventDefault(); onPulled(line.id, new FormData(event.currentTarget).get("fundedAmount")) }}>
              <label>Pulled
                <input name="fundedAmount" inputMode="decimal" defaultValue={pulled ?? 0} />
              </label>
              <button type="submit">Save pulled</button>
              {line.status !== "Funded" && (
                <>
                  <label>Forecast finish
                    <input type="date" defaultValue={line.requestedDate || ""} onChange={(event) => onForecast(line.id, event.target.value)} />
                  </label>
                  <button type="button" onClick={() => onPull(line.id)}>Pull draw</button>
                </>
              )}
            </form>
          )}
        </div>
      )}
    </article>
  )
}

function ReceivedMoney({ projects }) {
  const rows = projects.flatMap((project) => {
    const draws = project.lines.filter((line) => drawIndex(line.title) && Number(line.pulled) > 0)
    if (!draws.length) return []
    return [{
      id: project.id,
      address: project.address,
      amount: draws.reduce((sum, line) => sum + Number(line.pulled || 0), 0),
      draws,
    }]
  })
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  return (
    <section className="draws-money money-received">
      <div className="inc-head">
        <span>Cash received</span>
        <b>{cash(total)}</b>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="draw-week">
          <div className="draw-week-h"><span>{row.address}</span><b>{cash(row.amount)}</b></div>
          {row.draws.map((draw) => (
            <div key={draw.id} className="draw-week-row">
              <span>{draw.title}</span>
              <span>{draw.fundedDate ? shortDate(draw.fundedDate) : "No date"}</span>
              <b>{cash(draw.pulled)}</b>
            </div>
          ))}
        </div>
      ))}
      {!rows.length && <p className="draws-empty">No cash has been received yet.</p>}
    </section>
  )
}

function MoneyCalendar({ projects, month, onMonth }) {
  const events = useMemo(() => collectEvents(projects), [projects])
  const cells = monthCells(month)
  const label = month.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  const selected = events.filter((event) => event.date && event.date.slice(0, 7) === iso(month).slice(0, 7))
  return (
    <section className="draws-money">
      <div className="cal-head">
        <button type="button" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>Prev</button>
        <strong>{label}</strong>
        <button type="button" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next</button>
      </div>
      <div className="cal-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day} className="cal-dow">{day}</span>)}
        {cells.map((day, index) => {
          const key = day ? iso(day) : `blank-${index}`
          const dayEvents = day ? events.filter((event) => event.date === key) : []
          return (
            <div key={key} className={day ? "cal-day" : "cal-day empty"}>
              {day && <b>{day.getDate()}</b>}
              {dayEvents.map((event) => (
                <em key={event.id} className={event.kind}>{event.kind === "forecast" ? "Forecast" : "Received"} {cash(event.amount)}</em>
              ))}
            </div>
          )
        })}
      </div>
      <ul className="plain-list">
        {selected.map((event) => (
          <li key={event.id}>{shortDate(event.date)} · {event.address} · {event.title} · {event.kind === "forecast" ? "Forecast" : "Received"} {cash(event.amount)}</li>
        ))}
        {!selected.length && <li>Nothing with a date falls in this month. Received cash without a date is listed above.</li>}
      </ul>
    </section>
  )
}

function MoneyTimeline({ projects }) {
  const events = collectEvents(projects).filter((event) => event.kind === "forecast")
  const received = collectEvents(projects).filter((event) => event.kind === "received")
  const weeks = groupWeeks(events)
  const forecastTotal = events.reduce((sum, event) => sum + event.amount, 0)
  const receivedTotal = received.reduce((sum, event) => sum + event.amount, 0)
  return (
    <section className="draws-money">
      <div className="inc-head">
        <span>Forecasted — if work finishes on the dates you set</span>
        <b>{cash(forecastTotal)}</b>
      </div>
      {weeks.map((week) => (
        <div key={week.key} className="draw-week">
          <div className="draw-week-h"><span>{week.label}<small>{week.span}</small></span><b>{cash(week.amount)}</b></div>
          {week.events.map((event) => (
            <div key={event.id} className="draw-week-row"><span>{event.address}</span><span>{event.title}</span><b>{cash(event.amount)}</b></div>
          ))}
        </div>
      ))}
      {!weeks.length && <p className="draws-empty">No forecast yet. Open a property and set a finish date on a draw that has not been received.</p>}
      <div className="inc-head">
        <span>Received</span>
        <b>{cash(receivedTotal)}</b>
      </div>
      {received.map((event) => (
        <div key={event.id} className="draw-week-row"><span>{event.date ? `${shortDate(event.date)} · ` : ""}{event.address}</span><span>{event.title}</span><b>{cash(event.amount)}</b></div>
      ))}
      {!received.length && <p className="draws-empty">No draws received yet.</p>}
    </section>
  )
}

function buildProjects(payload) {
  if (!payload) return []
  const draws = payload.draws || []
  const budgets = payload.budgets || []
  return (payload.properties || []).map((property) => {
    const lines = draws.filter((draw) => draw.propertyId === property.id)
    const budget = budgets.find((item) => item.propertyId === property.id)
    const lineTotal = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    const lender = firstNumber(budget?.budget)
    const rehab = firstNumber(property.rehabBudget)
    const schedule = lender ?? rehab ?? (lineTotal || null)
    const received = lines
      .filter((line) => line.status === "Funded")
      .reduce((sum, line) => sum + (Number(line.fundedAmount ?? line.amount) || 0), 0)
    const forecast = lines.reduce((sum, line) => {
      if (!line.requestedDate || line.status === "Funded") return sum
      return sum + Math.max(0, (Number(line.amount) || 0) - (Number(line.fundedAmount) || 0))
    }, 0)
    const spent = Number(property.spent) || 0
    return {
      ...property,
      scopeLines: property.scopeLines || [],
      lines,
      schedule,
      budgetId: budget?.id || "",
      totalBudget: rehab ?? lender ?? (lineTotal || null),
      lenderFunding: firstNumber(budget?.fundingLimit) ?? lender,
      scheduleLabel: lender != null ? "Draw schedule" : rehab != null ? "Rehab budget" : "Draw lines",
      received,
      undrawn: schedule == null ? null : Math.max(0, schedule - received),
      forecast,
      spent,
      pending: Number(property.pending) || 0,
      rehabLeft: property.rehabRemaining ?? (rehab == null ? null : Math.max(0, rehab - spent)),
      pct: schedule ? received / schedule : 0,
    }
  })
}

function sortProjects(projects, sort) {
  const funded = projects.filter((project) => project.schedule > 0)
  const empty = projects.filter((project) => !(project.schedule > 0))
  if (sort === "least") funded.sort((a, b) => a.pct - b.pct)
  else if (sort === "most") funded.sort((a, b) => b.pct - a.pct)
  else {
    funded.sort((a, b) => {
      const aOn = a.forecast > 0
      const bOn = b.forecast > 0
      if (aOn !== bOn) return aOn ? -1 : 1
      return b.forecast - a.forecast
    })
  }
  return funded.concat(empty)
}

function sumProjects(projects) {
  const received = projects.reduce((sum, project) => sum + project.received, 0)
  const forecast = projects.reduce((sum, project) => sum + project.forecast, 0)
  const known = projects.filter((project) => project.schedule != null)
  const total = known.reduce((sum, project) => sum + project.schedule, 0)
  const remaining = known.reduce((sum, project) => sum + (project.undrawn || 0), 0)
  const withRehab = projects.filter((project) => project.rehabLeft != null)
  const rehabLeft = withRehab.reduce((sum, project) => sum + project.rehabLeft, 0)
  const spent = projects.reduce((sum, project) => sum + project.spent, 0)
  return { received, forecast, total, remaining, rehabLeft: withRehab.length ? rehabLeft : null, spent, pct: total ? received / total : 0 }
}

function collectEvents(projects) {
  const events = []
  for (const project of projects) {
    for (const line of project.lines) {
      const amount = Number(line.amount) || 0
      const funded = Number(line.fundedAmount) || 0
      const pulled = Number(line.pulled) || funded
      if ((line.status === "Funded" || pulled > 0) && pulled > 0) {
        events.push({ id: `${line.id}-in`, kind: "received", date: line.fundedDate || "", amount: pulled, title: line.title, address: project.address })
      } else if (line.requestedDate && amount > funded) {
        events.push({
          id: `${line.id}-fc`,
          kind: "forecast",
          date: iso(addBiz(line.requestedDate, FUND_WINDOW[0])),
          amount: amount - funded,
          title: line.title,
          address: project.address,
        })
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date))
}

function groupWeeks(events) {
  const today = weekStart(new Date())
  const weeks = []
  for (const event of events) {
    const start = weekStart(new Date(`${event.date}T12:00:00`))
    const key = iso(start)
    let week = weeks.find((item) => item.key === key)
    if (!week) {
      const end = new Date(start)
      end.setDate(end.getDate() + 4)
      const diff = Math.round((start - today) / 864e5 / 7)
      const label = diff < 0 ? "Past due" : diff === 0 ? "This week" : diff === 1 ? "Next week" : `Week of ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      week = { key, label, span: `${fmtDay(start)}–${fmtDay(end)}`, amount: 0, events: [] }
      weeks.push(week)
    }
    week.amount += event.amount
    week.events.push(event)
  }
  return weeks
}

function forecastWindow(project) {
  const dates = project.lines
    .filter((line) => line.requestedDate && line.status !== "Funded")
    .map((line) => line.requestedDate)
  if (!dates.length) return ""
  const start = dates.reduce((earliest, date) => (date < earliest ? date : earliest))
  return `${fmtDay(addBiz(start, FUND_WINDOW[0]))}–${fmtDay(addBiz(start, FUND_WINDOW[1]))}`
}

function drawIndex(title) {
  const match = String(title || "").match(/^draw\s+(\d+)$/i)
  return match ? Number(match[1]) : 0
}

function firstNumber(...values) {
  for (const value of values) {
    if (value == null || value === "") continue
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return null
}

function addBiz(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00`)
  let added = 0
  while (added < days) {
    date.setDate(date.getDate() + 1)
    const weekday = date.getDay()
    if (weekday !== 0 && weekday !== 6) added += 1
  }
  return date
}

function weekStart(date) {
  const next = new Date(date)
  next.setHours(12, 0, 0, 0)
  const offset = (next.getDay() + 6) % 7
  next.setDate(next.getDate() - offset)
  return next
}

function monthCells(month) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const lead = (start.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day))
  while (cells.length % 7) cells.push(null)
  return cells
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function fmtDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function shortDate(value) {
  if (!value) return ""
  const [year, month, day] = value.split("-")
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`
}

function cash(value) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value))
}
