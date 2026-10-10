"use client"

import Link from "next/link"
import { useMemo, useRef, useState } from "react"
import { can, drawFigures, drawHealth, drawPulled, isPendingDraw, resolveBudget } from "@synergifund/shared"
import { DrawEditor, ScopeEditor } from "../../../components/draws/DrawEditor"
import { DrawImport } from "../../../components/draws/DrawImport"
import { FormSheet, InfoSheet } from "../../../components/ui/FormSheet"
import { HeaderActions } from "../../../components/ui/HeaderActions"
import { Icon } from "../../../components/ui/Icon"
import { PageSpinner } from "../../../components/ui/Spinner"
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
  const [importBusy, setImportBusy] = useState("")
  const [workbook, setWorkbook] = useState(null)
  const [view, setView] = useState("properties")
  const [moneyView, setMoneyView] = useState("calendar")
  const [sort, setSort] = useState("pending")
  const [query, setQuery] = useState("")
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState([])
  const [bulkBusy, setBulkBusy] = useState("")
  const [bulkNote, setBulkNote] = useState(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")
  const [report, setReport] = useState(null)
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const projects = useMemo(
    () => sortProjects(buildProjects(data.data), sort, query),
    [data.data, sort, query],
  )
  const totals = useMemo(() => sumProjects(projects), [projects])

  const [addFor, setAddFor] = useState("")
  const addProject = projects.find((project) => project.id === addFor)

  function chooseProperty(event) {
    event.preventDefault()
    const id = new FormData(event.currentTarget).get("propertyId")
    if (!id) return
    setAdding(false)
    setAddFor(String(id))
  }

  async function forecast(id, requestedDate) {
    await api(`/draws/${id}`, { method: "PATCH", body: { requestedDate } })
    data.reload()
  }

  async function savePulled(id, fundedAmount) {
    const draw = (data.data?.draws || []).find((item) => item.id === id)
    const zero = !String(fundedAmount ?? "").replace(/[$,\s0.]/g, "")
    if (zero && draw && (draw.status === "Funded" || draw.status === "Partial") && !window.confirm(`Set ${draw.title} to $0 received? It will move back to pending.`)) return
    await api(`/draws/${id}`, { method: "PATCH", body: { fundedAmount } })
    data.reload()
  }

  function toggleSelected(id) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function stopSelecting() {
    setSelecting(false)
    setSelected([])
  }

  async function clearSelected() {
    const chosen = projects.filter((project) => selected.includes(project.id))
    if (!chosen.length) return
    const lines = chosen.reduce((total, project) => total + project.scopeLines.length, 0)
    const draws = chosen.reduce((total, project) => total + project.draws.length, 0)
    if (!window.confirm(`Clear draw data for ${chosen.length === 1 ? chosen[0].address : `${chosen.length} properties`}?\n\nThis deletes ${draws} draws and ${lines} line items. The properties, budgets and lender funding stay. You can import the workbook again afterwards.`)) return
    setBulkBusy("clear")
    setBulkNote(null)
    try {
      const result = await api("/draws/clear", { method: "POST", body: { propertyIds: chosen.map((project) => project.id) } })
      setBulkNote({ ok: true, text: `Cleared ${result.draws} draws and ${result.lines} line items from ${result.properties} ${result.properties === 1 ? "property" : "properties"}.` })
      stopSelecting()
      await data.reload()
    } catch (err) {
      setBulkNote({ ok: false, text: err.message })
    } finally {
      setBulkBusy("")
    }
  }

  async function deleteSelected() {
    const chosen = projects.filter((project) => selected.includes(project.id))
    if (!chosen.length) return
    const names = chosen.slice(0, 5).map((project) => project.address).join("\n")
    if (!window.confirm(`Delete ${chosen.length === 1 ? "this property" : `${chosen.length} properties`} for good?\n\n${names}${chosen.length > 5 ? `\n…and ${chosen.length - 5} more` : ""}\n\nThis removes each property with its draws, costs, documents links and chat room. It cannot be undone.`)) return
    setBulkBusy("delete")
    setBulkNote(null)
    const failed = []
    for (const project of chosen) {
      try {
        await api(`/properties/${project.id}`, { method: "DELETE" })
      } catch (err) {
        failed.push(`${project.address}: ${err.message}`)
      }
    }
    setBulkBusy("")
    setBulkNote(failed.length
      ? { ok: false, text: `${chosen.length - failed.length} deleted. ${failed.length} failed — ${failed.join("; ")}` }
      : { ok: true, text: `Deleted ${chosen.length} ${chosen.length === 1 ? "property" : "properties"}.` })
    stopSelecting()
    await data.reload()
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
      else if (column === "funding" && project.budgetId) await api(`/draws/budgets/${project.budgetId}`, { method: "PATCH", body: { fundingLimit: null } })
      else if (draw) {
        if (!window.confirm(`Delete ${draw.title} from ${project.address}?`)) return
        await api(`/draws/${draw.id}`, { method: "DELETE" })
      }
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
            <button type="button" className="import-button import-trigger" disabled={Boolean(importBusy)} aria-busy={Boolean(importBusy) || undefined} onClick={() => { if (!importBusy) importInput.current?.click() }}>
              {importBusy && <span className="spinner spinner-sm tw:animate-spin" />}
              {importBusy === "reading" ? "Reading…" : importBusy === "saving" ? "Saving…" : "Import Excel"}
            </button>
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
        <article className="stat"><div className="stat-label">Remaining</div><div className="stat-value">{cash(totals.remaining)}</div><div className="stat-hint">Budget left after drawn and pending</div></article>
        <article className="stat"><div className="stat-label">Forecasted</div><div className="stat-value">{cash(totals.forecast)}</div><div className="stat-hint">{cash(totals.pending)} requested, not funded yet</div></article>
        <article className="stat"><div className="stat-label">Received</div><div className="stat-value">{cash(totals.received)}</div><div className="stat-hint">{cash(totals.available)} available to withdraw</div></article>
        <article className="stat"><div className="stat-label">Total budget</div><div className="stat-value">{cash(totals.budget)}</div><div className="stat-hint">{totals.estimated ? `${totals.estimated} ${totals.estimated === 1 ? "property" : "properties"} estimated from line items` : `${cash(totals.drawn)} drawn · ${Math.round(totals.used * 100)}% used`}</div></article>
      </div>

      <div className="panel draws-toolbar">
        <div className="seg">
          <button type="button" className={view === "properties" ? "on" : ""} onClick={() => setView("properties")}>Properties</button>
          <button type="button" className={view === "money" ? "on" : ""} onClick={() => setView("money")}>Money</button>
        </div>
        {view === "properties" && selecting ? (
          <div className="draws-bulk">
            <span><b>{selected.length}</b> selected</span>
            <button type="button" className="import-button" onClick={() => setSelected(selected.length === projects.length ? [] : projects.map((project) => project.id))}>
              {selected.length === projects.length ? "Select none" : "Select all"}
            </button>
            {writable && (
              <button type="button" className="import-button" disabled={!selected.length || Boolean(bulkBusy)} onClick={clearSelected}>
                {bulkBusy === "clear" ? "Clearing…" : "Clear draw data"}
              </button>
            )}
            {canDeleteProperty && (
              <button type="button" className="import-button is-danger" disabled={!selected.length || Boolean(bulkBusy)} onClick={deleteSelected}>
                {bulkBusy === "delete" ? "Deleting…" : "Delete properties"}
              </button>
            )}
            <button type="button" className="primary" onClick={stopSelecting}>Done</button>
          </div>
        ) : view === "properties" ? (
          <div className="draws-filters">
            <label className="draws-search">
              <Icon name="search" size={14} />
              <input value={query} placeholder="Search properties" aria-label="Search properties" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <select value={sort} aria-label="Sort properties" onChange={(event) => setSort(event.target.value)}>
              <option value="pending">Pending first</option>
              <option value="remaining">Most remaining</option>
              <option value="available">Lowest funds</option>
              <option value="address">Address</option>
            </select>
            {(writable || canDeleteProperty) && projects.length > 0 && (
              <button type="button" className="import-button" onClick={() => { setSelecting(true); setBulkNote(null) }}>Select</button>
            )}
          </div>
        ) : (
          <div className="seg">
            <button type="button" className={moneyView === "calendar" ? "on" : ""} onClick={() => setMoneyView("calendar")}>Calendar</button>
            <button type="button" className={moneyView === "timeline" ? "on" : ""} onClick={() => setMoneyView("timeline")}>Timeline</button>
          </div>
        )}
      </div>

      {canImport && (
        <DrawImport
          job={workbook}
          inputRef={importInput}
          onBusy={setImportBusy}
          onOpen={setWorkbook}
          onChange={setWorkbook}
          onReload={data.reload}
        />
      )}

      {data.error && <p className="draws-empty">{data.error}</p>}

      {bulkNote && <p className={bulkNote.ok ? "draws-bulk-note is-ok" : "draws-bulk-note"}>{bulkNote.text}</p>}

      {view === "properties" && (
        <DrawBoard
          selecting={selecting}
          selected={selected}
          onSelect={toggleSelected}
          onChanged={data.reload}
          projects={projects}
          writable={writable}
          canDelete={canDeleteProperty}
          onSave={saveSheetValue}
          onRemove={removeProperty}
          onForecast={forecast}
          onPull={pull}
          onPulled={savePulled}
        />
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
        <FormSheet eyebrow="Draws" title="Add a draw" hint="Pick the property. Next you’ll split the draw across its line items." onClose={() => setAdding(false)} onSubmit={chooseProperty} submitLabel="Next: line items" error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Property</span>
              <select name="propertyId" required>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.address} · {project.scopeLines.length} line items</option>)}
              </select>
            </label>
          </div>
        </FormSheet>
      )}
      {addProject && (
        <DrawEditor project={addProject} onClose={() => setAddFor("")} onSaved={() => { setAddFor(""); data.reload() }} />
      )}
    </div>
  )
}

function DrawBoard({ projects, selecting, selected, onSelect, onChanged, writable, canDelete, onSave, onRemove, onForecast, onPull, onPulled }) {
  const [openIds, setOpenIds] = useState([])
  const toggle = (id) => setOpenIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  if (!projects.length) return <p className="draws-empty">No draw data yet. Import a workbook to add it.</p>
  return (
    <div className="draw-board">
      {projects.map((project) => (
        <DrawProperty
          key={project.id}
          project={project}
          open={openIds.includes(project.id)}
          onToggle={() => (selecting ? onSelect(project.id) : toggle(project.id))}
          selecting={selecting}
          checked={selected.includes(project.id)}
          onCheck={() => onSelect(project.id)}
          writable={writable}
          canDelete={canDelete}
          onSave={onSave}
          onRemove={onRemove}
          onForecast={onForecast}
          onPull={onPull}
          onPulled={onPulled}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function DrawProperty({ project, open, onToggle, selecting, checked, onCheck, ...actions }) {
  const figures = project.figures
  const used = figures.budget ? Math.min(1, figures.drawn / figures.budget) : 0
  const queued = figures.budget ? Math.min(1 - used, figures.pending / figures.budget) : 0
  const count = project.draws.filter((draw) => !isPendingDraw(draw)).length
  return (
    <article className={`draw-property${open && !selecting ? " is-open" : ""}${selecting ? " is-selecting" : ""}${checked ? " is-checked" : ""}`}>
      <div className="draw-property-row">
      {selecting && (
        <label className="draw-select">
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${project.address}`} />
        </label>
      )}
      <button type="button" className="draw-property-head" aria-expanded={open} onClick={onToggle}>
        <span className="draw-property-name">
          <b>{project.address || "Untitled property"}</b>
          <small>{[project.city, count ? `${count} ${count === 1 ? "draw" : "draws"} funded` : "No draws yet"].filter(Boolean).join(" · ")}</small>
          <span className="draw-property-progress">
            <em className={`draw-health ${healthTone(project.health)}`}>{project.health}</em>
            <span className="draw-progress-bar" aria-hidden="true">
              <i style={{ width: `${used * 100}%` }} />
              <i className="is-pending" style={{ width: `${queued * 100}%` }} />
            </span>
            <small>{Math.round(used * 100)}% used</small>
          </span>
        </span>
        <span className="draw-figures">
          <Figure label={figures.budgetEstimated ? "Remaining · est." : "Remaining"} value={figures.remaining} tone="strong" />
          <Figure label={figures.budgetEstimated ? "Total budget · est." : "Total budget"} value={figures.budget} />
          <Figure label="Drawn" value={figures.drawn} />
          <Figure label="Pulled" value={figures.received} tone="good" />
          <Figure label="Pending" value={figures.pending} tone={figures.pending > 0 ? "warn" : "quiet"} />
        </span>
        <i className="draw-property-chevron" aria-hidden="true"><Icon name="chevron" size={16} /></i>
      </button>
      </div>
      {open && !selecting && <DrawPropertyBody project={project} {...actions} />}
    </article>
  )
}

function Figure({ label, value, tone }) {
  return (
    <span className={tone ? `draw-figure is-${tone}` : "draw-figure"}>
      <small>{label}</small>
      <b>{cash(value)}</b>
    </span>
  )
}

function DrawPropertyBody({ project, writable, canDelete, onSave, onRemove, onForecast, onPull, onPulled, onChanged }) {
  const sheet = useMemo(() => lineSheet(project), [project])
  const [editor, setEditor] = useState(null)
  const [managing, setManaging] = useState(false)
  const [error, setError] = useState("")
  const figures = project.figures

  async function run(task) {
    setError("")
    try {
      await task()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(draw) {
    if (!window.confirm(`Remove ${draw.title} from ${project.address}?`)) return
    await run(() => onSave({ project, column: drawIndex(draw.title), draw, value: "" }))
  }

  const openDraw = writable ? (draw) => setEditor({ kind: "draw", draw }) : null
  const editScope = writable ? () => setEditor({ kind: "scope" }) : null
  const saved = () => {
    setEditor(null)
    onChanged?.()
  }

  return (
    <div className="draw-property-body">
      <div className="draw-summary">
        <div className="draw-summary-figures">
          <span><small>Lender funding</small><b>{cash(figures.lenderFunding)}</b></span>
          <span><small>Lender share</small><b>{figures.fundedShare != null ? `${Math.round(figures.fundedShare * 100)}%` : "—"}</b></span>
          <span><small>After pending</small><b>{cash(figures.availableAfterPending)}</b></span>
          <span><small>Funds left</small><b>{figures.fundsAvailable != null ? `${Math.round(figures.fundsAvailable * 100)}%` : "—"}</b></span>
        </div>
        <div className="draw-summary-actions">
          {writable && (
            <button type="button" className="draw-step-add" onClick={() => setEditor({ kind: "draw", draw: null })}>
              <Icon name="plus" size={14} />
              New draw
            </button>
          )}
          {writable && (
            <button type="button" className="draw-step-add" onClick={editScope}>Line items</button>
          )}
          {writable && project.draws.length > 0 && (
            <button type="button" className="draw-step-add" aria-expanded={managing} onClick={() => setManaging((current) => !current)}>
              {managing ? "Done" : "Manage draws"}
            </button>
          )}
          <Link href={`/properties/${project.id}`}>Open property</Link>
          {canDelete && <button type="button" className="sheet-remove" onClick={() => onRemove(project)}>Remove</button>}
        </div>
      </div>
      {error && <p className="draw-schedule-error">{error}</p>}
      {managing && (
        <div className="draw-manage">
          {project.draws.map((draw) => (
            <DrawControls
              key={draw.id}
              draw={draw}
              label={`${project.address} ${draw.title}`}
              onEdit={() => openDraw?.(draw)}
              onPulled={(text) => run(() => onPulled(draw.id, text))}
              onForecast={(date) => run(() => onForecast(draw.id, date))}
              onPull={() => run(() => onPull(draw.id))}
              onRemove={() => remove(draw)}
            />
          ))}
        </div>
      )}
      <LineSheet sheet={sheet} onDraw={openDraw} onScope={editScope} />
      <LineCards sheet={sheet} onDraw={openDraw} onScope={editScope} />
      {editor?.kind === "draw" && <DrawEditor project={project} draw={editor.draw} onClose={() => setEditor(null)} onSaved={saved} />}
      {editor?.kind === "scope" && <ScopeEditor project={project} onClose={() => setEditor(null)} onSaved={saved} />}
    </div>
  )
}

function LineSheet({ sheet, onDraw, onScope }) {
  const { draws, rows, total } = sheet
  const described = rows.some((item) => item.description) || !rows.length
  return (
    <div className="excel-wrap line-sheet">
      <table className="excel-sheet">
        <thead>
          <tr>
            <th className="row-number">#</th>
            <th className="pin-col">Line item</th>
            {described && <th className="line-description">Description</th>}
            <th className="num">Budget</th>
            {draws.map((draw) => (
              <th key={draw.id} className={isPendingDraw(draw) ? "num is-pending" : "num"}>
                {onDraw ? (
                  <button type="button" className="line-draw-head is-button" title={`Edit ${draw.title} line items`} onClick={() => onDraw(draw)}>{draw.title}<small>{drawLabel(draw)} · edit</small></button>
                ) : (
                  <span className="line-draw-head">{draw.title}<small>{drawLabel(draw)}</small></span>
                )}
              </th>
            ))}
            <th className="num">Drawn</th>
            <th className="num">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item.key} className={item.other ? "is-other" : undefined}>
              <th className="row-number">{item.other ? "" : index + 1}</th>
              <td className="pin-col">{item.title}</td>
              {described && <td className="line-description" title={item.description}>{item.description || ""}</td>}
              <td className={item.estimated ? "num is-estimate" : "num"} title={item.estimated ? "No budget set for this line. Showing what has been drawn so far." : undefined}>{cell(item.budget)}</td>
              {draws.map((draw) => (
                <td key={draw.id} className={isPendingDraw(draw) ? "num is-pending" : "num"}>{cell(item.amounts[draw.id])}</td>
              ))}
              <td className="num">{cell(item.drawn)}</td>
              <td className={item.remaining < -0.5 ? "num is-over" : "num"}>{item.remaining == null ? "" : cash(item.remaining)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr className="is-other">
              <th className="row-number" />
              <td className="pin-col">No line items yet</td>
              <td className="line-description">
                {onScope ? <button type="button" className="line-empty-action" onClick={onScope}>Add the scope of work</button> : "Import the workbook to see each line of the budget."}
              </td>
              <td className="num" />
              {draws.map((draw) => <td key={draw.id} />)}
              <td />
              <td />
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th className="row-number" />
            <td className="pin-col">TOTAL</td>
            {described && <td className="line-description" />}
            <td className={total.estimated ? "num is-estimate" : "num"} title={total.estimated ? "Estimated from line items. Add line budgets for exact figures." : undefined}>{cash(total.budget)}{total.estimated ? " est." : ""}</td>
            {draws.map((draw) => (
              <td key={draw.id} className={isPendingDraw(draw) ? "num is-pending" : "num"}>{cash(draw.amount)}</td>
            ))}
            <td className="num">{cash(total.drawn)}</td>
            <td className={total.remaining < -0.5 ? "num is-over" : "num"}>{cash(total.remaining)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function LineCards({ sheet, onDraw, onScope }) {
  const { draws, rows, total } = sheet
  return (
    <div className="line-cards">
      <p className="line-cards-label">Line items</p>
      {rows.map((item) => <LineCard key={item.key} item={item} draws={draws} />)}
      {!rows.length && (
        <div className="line-cards-empty">
          <p>No line items yet. Every draw is split across the scope of work, so add the line items first.</p>
          {onScope ? <button type="button" className="draw-step-add" onClick={onScope}><Icon name="plus" size={14} />Add line items</button> : <p>Import the workbook to load them.</p>}
        </div>
      )}
      <div className="line-card is-total">
        <div className="line-card-head">
          <span><b>Total</b><small>Budget {cash(total.budget)} · Drawn {cash(total.drawn)}{total.pending ? ` · Pending ${cash(total.pending)}` : ""}</small></span>
          <span className={total.remaining < -0.5 ? "line-card-left is-over" : "line-card-left"}><small>Remaining</small>{cash(total.remaining)}</span>
        </div>
      </div>
      {draws.length > 0 && <p className="line-cards-label">Draws</p>}
      {draws.map((draw) => <DrawLinesCard key={draw.id} draw={draw} onEdit={onDraw ? () => onDraw(draw) : null} />)}
    </div>
  )
}

function DrawLinesCard({ draw, onEdit }) {
  const [open, setOpen] = useState(false)
  const lines = (draw.lines || []).filter((line) => Number(line.amount))
  const lined = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const loose = (Number(draw.amount) || 0) - lined
  return (
    <div className={`draw-lines-card${isPendingDraw(draw) ? " is-pending" : ""}${open ? " is-open" : ""}`}>
      <button type="button" className="draw-lines-head" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span><b>{draw.title}</b><small>{drawLabel(draw)} · {lines.length} {lines.length === 1 ? "line item" : "line items"}</small></span>
        <strong>{cash(draw.amount)}</strong>
        <i aria-hidden="true"><Icon name="chevron" size={14} /></i>
      </button>
      {open && (
        <div className="draw-lines-body">
          {lines.map((line, index) => (
            <div key={line.id || `${line.title}-${index}`}><span>{line.title}{line.description ? <small>{line.description}</small> : null}</span><b>{cash(line.amount)}</b></div>
          ))}
          {loose > 0.5 && <div className="is-loose"><span>Not split into line items<small>Edit the draw to assign it</small></span><b>{cash(loose)}</b></div>}
          {onEdit && <button type="button" className="draw-step-add" onClick={onEdit}><Icon name="edit" size={13} />Edit line items</button>}
        </div>
      )}
    </div>
  )
}

function LineCard({ item, draws }) {
  const [open, setOpen] = useState(false)
  const budget = Number(item.budget) || 0
  const scale = Math.max(budget, item.drawn + item.pending)
  const shares = draws.filter((draw) => item.amounts[draw.id])
  return (
    <div className={open ? "line-card is-open" : "line-card"}>
      <button type="button" className="line-card-head" aria-expanded={open} onClick={() => setOpen((current) => !current)} disabled={!shares.length && !item.description}>
        <span>
          <b>{item.title}</b>
          <small>{item.budget != null ? `Budget ${cash(item.budget)}` : "No budget"} · Drawn {cash(item.drawn)}{item.pending ? ` · Pending ${cash(item.pending)}` : ""}</small>
        </span>
        <span className={item.remaining < -0.5 ? "line-card-left is-over" : "line-card-left"}><small>Remaining</small>{item.remaining == null ? "—" : cash(item.remaining)}</span>
      </button>
      <span className="draw-progress-bar" aria-hidden="true">
        <i style={{ width: `${scale ? (item.drawn / scale) * 100 : 0}%` }} />
        <i className="is-pending" style={{ width: `${scale ? (item.pending / scale) * 100 : 0}%` }} />
      </span>
      {open && (
        <div className="line-card-body">
          {item.description && <p>{item.description}</p>}
          {shares.map((draw) => (
            <div key={draw.id} className={isPendingDraw(draw) ? "is-pending" : undefined}>
              <span>{draw.title}<small> · {drawLabel(draw)}</small></span>
              <b>{cash(item.amounts[draw.id])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DrawControls({ draw, label, onEdit, onPulled, onForecast, onPull, onRemove }) {
  const pending = isPendingDraw(draw)
  return (
    <div className={pending ? "draw-control is-pending" : "draw-control"}>
      <span className="draw-control-title"><b>{draw.title}</b><small>{drawLabel(draw)}</small></span>
      <label><small>Amount</small><button type="button" className="draw-control-lines" onClick={onEdit} title="Edit this draw's line items">{cash(draw.amount)}<span>{(draw.lines || []).length ? `${draw.lines.length} lines · edit` : "Split into lines"}</span></button></label>
      <label><small>Pulled</small><SheetMoneyCell value={drawPulled(draw)} label={`${label} pulled`} onSave={onPulled} /></label>
      {draw.status !== "Funded" ? (
        <label><small>Forecast</small><input type="date" defaultValue={draw.requestedDate || ""} onChange={(event) => onForecast(event.target.value)} /></label>
      ) : <span />}
      <span className="draw-control-actions">
        {draw.status !== "Funded" && <button type="button" onClick={onPull}>Pull draw</button>}
        <button type="button" className="draw-step-remove" aria-label={`Remove ${draw.title}`} onClick={onRemove}><Icon name="close" size={14} /></button>
      </span>
    </div>
  )
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

function lineSheet(project) {
  const draws = project.draws
  const figures = project.figures
  const pendingIds = new Set(draws.filter(isPendingDraw).map((draw) => draw.id))
  const rows = []
  const byKey = new Map()
  const row = (title, description) => {
    const key = lineKey(title)
    let item = byKey.get(key)
    if (!item) {
      item = { key, title: String(title || "").trim() || "Untitled line", description: description || "", budget: null, amounts: {} }
      byKey.set(key, item)
      rows.push(item)
    } else if (!item.description && description) {
      item.description = description
    }
    return item
  }
  for (const scope of project.scopeLines) {
    const item = row(scope.title, scope.description)
    if (scope.budget != null && scope.budget !== "") item.budget = (item.budget || 0) + (Number(scope.budget) || 0)
  }
  for (const draw of draws) {
    for (const line of draw.lines || []) {
      const amount = Number(line.amount) || 0
      if (!amount) continue
      const item = row(line.title, line.description)
      item.amounts[draw.id] = (item.amounts[draw.id] || 0) + amount
    }
  }
  const split = (item) => {
    item.drawn = 0
    item.pending = 0
    for (const [id, amount] of Object.entries(item.amounts)) {
      if (pendingIds.has(id)) item.pending += amount
      else item.drawn += amount
    }
  }
  for (const item of rows) {
    split(item)
    if (item.budget == null && figures.budgetEstimated && item.drawn + item.pending > 0) {
      item.budget = item.drawn + item.pending
      item.estimated = true
    }
  }
  if (rows.length) {
    const other = { key: "__other", title: "Not in line items", description: "Budget or draw money without a line item", budget: null, amounts: {}, other: true }
    const lineBudget = rows.reduce((sum, item) => sum + (Number(item.budget) || 0), 0)
    if (figures.budget != null && Math.abs(figures.budget - lineBudget) > 0.5) other.budget = figures.budget - lineBudget
    for (const draw of draws) {
      const lined = rows.reduce((sum, item) => sum + (item.amounts[draw.id] || 0), 0)
      const gap = (Number(draw.amount) || 0) - lined
      if (Math.abs(gap) > 0.5) other.amounts[draw.id] = gap
    }
    if (other.budget != null || Object.keys(other.amounts).length) {
      split(other)
      if (figures.budgetEstimated && other.budget != null) other.estimated = true
      rows.push(other)
    }
  }
  for (const item of rows) {
    item.remaining = item.budget == null ? null : item.budget - item.drawn - item.pending
  }
  return {
    draws,
    rows,
    total: {
      estimated: figures.budgetEstimated,
      budget: figures.budget,
      drawn: figures.drawn,
      pending: figures.pending,
      remaining: figures.budget == null ? null : figures.budget - figures.drawn - figures.pending,
    },
  }
}

function lineKey(title) {
  return String(title || "").toLowerCase().replace(/\s+/g, " ").trim()
}

function drawLabel(draw) {
  if (isPendingDraw(draw)) return draw.requestedDate ? `Pending · ${shortDate(draw.requestedDate)}` : "Pending"
  if (draw.status === "Funded") return draw.fundedDate ? `Funded ${shortDate(draw.fundedDate)}` : "Funded"
  return draw.status || "Open"
}

function healthTone(health) {
  if (/budget missing/i.test(health)) return "is-warn"
  if (/low funds/i.test(health)) return "is-bad"
  if (/pending/i.test(health)) return "is-warn"
  if (/not started/i.test(health)) return "is-quiet"
  return "is-good"
}

function cell(value) {
  if (value == null || Math.abs(Number(value)) < 0.005) return ""
  return cash(value)
}

function orderDraws(draws) {
  return [...draws].sort((a, b) => {
    const left = drawIndex(a.title) || Number.MAX_SAFE_INTEGER
    const right = drawIndex(b.title) || Number.MAX_SAFE_INTEGER
    if (left !== right) return left - right
    return String(a.title).localeCompare(String(b.title))
  })
}

function ReceivedMoney({ projects }) {
  const rows = projects.flatMap((project) => {
    const draws = orderDraws(project.lines.filter((line) => Number(line.pulled) > 0))
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
    const resolved = resolveBudget({ rehabBudget: property.rehabBudget, recordBudget: budget?.budget, scopeLines: property.scopeLines || [], draws: lines })
    const figures = drawFigures({
      budget: resolved.budget,
      lenderFunding: firstNumber(budget?.fundingLimit),
      fundedPercent: budget?.fundingPercent,
      draws: lines,
      budgetEstimated: resolved.estimated,
    })
    const forecast = lines.reduce((sum, line) => {
      if (line.status === "Funded" || !(isPendingDraw(line) || line.requestedDate)) return sum
      return sum + Math.max(0, (Number(line.amount) || 0) - (Number(line.fundedAmount) || 0))
    }, 0)
    return {
      ...property,
      scopeLines: property.scopeLines || [],
      lines,
      draws: orderDraws(lines),
      figures,
      health: drawHealth(figures),
      budgetId: budget?.id || "",
      totalBudget: figures.budget,
      lenderFunding: figures.lenderFunding,
      received: figures.received,
      forecast,
      spent: Number(property.spent) || 0,
    }
  })
}

const SORTS = {
  pending: (a, b) => b.figures.pending - a.figures.pending || (b.figures.remaining || 0) - (a.figures.remaining || 0),
  remaining: (a, b) => (b.figures.remaining || 0) - (a.figures.remaining || 0),
  available: (a, b) => (a.figures.fundsAvailable ?? 2) - (b.figures.fundsAvailable ?? 2),
  address: (a, b) => String(a.address).localeCompare(String(b.address), undefined, { numeric: true }),
}

function sortProjects(projects, sort, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean)
  const found = words.length ? projects.filter((project) => words.every((word) => `${project.address} ${project.city} ${project.health}`.toLowerCase().includes(word))) : projects
  return [...found].sort(SORTS[sort] || SORTS.pending)
}

function sumProjects(projects) {
  const add = (key) => projects.reduce((sum, project) => sum + (Number(project.figures[key]) || 0), 0)
  const budget = add("budget")
  const drawn = add("drawn")
  return {
    budget,
    drawn,
    received: add("received"),
    pending: add("pending"),
    available: add("available"),
    remaining: add("remaining"),
    forecast: projects.reduce((sum, project) => sum + project.forecast, 0),
    used: budget ? drawn / budget : 0,
    estimated: projects.filter((project) => project.figures.budgetEstimated).length,
  }
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
