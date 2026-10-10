"use client"

import { useRef, useState } from "react"
import { StatusPill } from "../ui/StatusPill"
import { api } from "../../lib/api"

const LABELS = {
  new: "Will append",
  added: "Added",
  duplicate: "Duplicate",
  skipped: "Skipped",
}

export function DrawImport({ job, onOpen, onChange, onReload, inputRef, onBusy }) {
  const [error, setError] = useState("")
  const [busy, setBusyState] = useState("")
  const [fileName, setFileName] = useState("")
  const working = useRef(false)

  function setBusy(next) {
    working.current = Boolean(next)
    setBusyState(next)
    onBusy?.(next)
  }

  async function upload(event) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || working.current) return
    setFileName(file.name)
    setBusy("reading")
    setError("")
    onOpen(null)
    try {
      const body = new FormData()
      body.set("file", file)
      const result = await api("/draws/import", { method: "POST", body })
      onOpen(result.import)
      onReload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy("")
    }
  }

  async function confirm() {
    if (working.current) return
    setBusy("saving")
    setError("")
    try {
      const result = await api(`/draws/import/${job.id}/confirm`, { method: "POST", body: {} })
      onChange(result.import)
      await onReload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy("")
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={Boolean(busy)} onChange={upload} />
      {busy === "reading" && (
        <section className="panel import-panel import-working" role="status" aria-live="polite">
          <span className="spinner spinner-md tw:animate-spin" />
          <div>
            <b>Reading {fileName || "the workbook"}…</b>
            <p>Checking every sheet, property and line item. This can take a few seconds for a big workbook.</p>
          </div>
        </section>
      )}
      {error && !job && !busy && <p className="draws-empty import-error">{error}</p>}
      {job && (
        <section className="panel import-panel">
          <div className="import-head">
            <div>
              <h2>Review imported data</h2>
              <p>
                {job.format === "sheet"
                  ? job.status === "Confirmed"
                    ? `Saved ${job.properties?.length || 0} properties · ${count(job, "added")} draws added, ${count(job, "duplicate")} updated${count(job, "removed") ? `, ${count(job, "removed")} removed` : ""} · ${count(job, "lines")} line items`
                    : `${job.properties?.length || 0} properties · ${count(job, "pending")} draws · ${(job.properties || []).reduce((total, property) => total + (property.lines?.length || 0), 0)} line items ready to save`
                  : job.status === "Confirmed"
                    ? `Added ${count(job, "added")} ${count(job, "added") === 1 ? "draw" : "draws"} and ${count(job, "lines")} line items · ${count(job, "duplicate")} left as they were · ${count(job, "skipped")} skipped`
                    : `${count(job, "draws")} ${count(job, "draws") === 1 ? "draw" : "draws"} with ${count(job, "lines")} line items to add · ${count(job, "duplicate")} already on file · ${count(job, "skipped")} skipped`}
              </p>
            </div>
            <div className="import-actions">
              {job.status === "Draft" && (
                <button type="button" className="primary import-save" disabled={Boolean(busy) || !count(job, "pending")} aria-busy={busy === "saving"} onClick={confirm}>
                  {busy === "saving" && <span className="spinner spinner-sm tw:animate-spin" />}
                  {busy === "saving" ? "Saving…" : count(job, "pending") ? (job.format === "sheet" ? "Save properties and draws" : "Append new rows") : "Nothing new to add"}
                </button>
              )}
              <button type="button" className="import-button" disabled={Boolean(busy)} onClick={() => onOpen(null)}>Close</button>
            </div>
          </div>
          {error && <p className="draws-empty">{error}</p>}
          {job.reconciliation && <Reconciliation check={job.reconciliation} />}
          {job.format === "sheet" ? (
            <SheetPreview job={job} />
          ) : (
            <>
          <p className="import-note">Rows for the same property and draw become one draw, with each row as a line item. Draws already on file are not replaced.</p>
          {job.truncated && <p className="import-note">Showing the first {job.rows.length} of {job.totalRows} rows. Append still saves every new row.</p>}
          <div className="import-rows">
            {(job.rows || []).map((row) => {
              const filled = (job.headers || []).filter((header) => String(row.cells?.[header] || "").trim())
              return (
                <article key={`${row.sheet}-${row.row}`} className={row.status === "duplicate" ? "import-row is-duplicate" : "import-row"}>
                  <div className="import-row-top">
                    <StatusPill>{LABELS[row.status] || row.status}</StatusPill>
                    <span>Row {row.row}{row.sheet ? ` · ${row.sheet}` : ""}</span>
                  </div>
                  {row.reason && <p>{row.reason}</p>}
                  {filled.length > 0 && (
                    <dl>
                      {filled.map((header) => (
                        <div key={header}>
                          <dt>{header}</dt>
                          <dd>{row.cells[header]}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              )
            })}
          </div>
            </>
          )}
        </section>
      )}
    </>
  )
}

const CHECKS = [
  ["budget", "Total budget"],
  ["drawn", "Drawn"],
  ["received", "Cash received"],
  ["pending", "Pending"],
  ["available", "Available to withdraw"],
  ["remaining", "Remaining budget"],
]

function Reconciliation({ check }) {
  return (
    <div className={check.matches ? "import-check is-match" : "import-check is-off"}>
      <p>
        <b>{check.matches ? "Every figure matches your workbook." : `${check.differences.length} figures differ from your workbook.`}</b>
        {" "}Checked {check.properties} properties.
      </p>
      <dl>
        {CHECKS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{money(check.app?.[key])}{check.sheet && Math.abs((check.app?.[key] || 0) - (check.sheet[key] || 0)) > 1 ? <small> · sheet {money(check.sheet[key])}</small> : null}</dd>
          </div>
        ))}
      </dl>
      {check.differences.length > 0 && (
        <ul>
          {check.differences.slice(0, 20).map((item) => (
            <li key={`${item.address}-${item.field}`}>{item.address} · {item.field}: app {money(item.app)}, sheet {money(item.sheet)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0)
}

function SheetPreview({ job }) {
  const [tab, setTab] = useState("lines")
  return (
    <>
      <div className="seg import-tabs">
        <button type="button" className={tab === "lines" ? "on" : ""} onClick={() => setTab("lines")}>Line items</button>
        <button type="button" className={tab === "sheet" ? "on" : ""} onClick={() => setTab("sheet")}>Dashboard sheet</button>
      </div>
      {tab === "lines" ? <LinePreview properties={job.properties || []} /> : <DashboardPreview job={job} />}
    </>
  )
}

function LinePreview({ properties }) {
  const [open, setOpen] = useState("")
  const missing = properties.filter((property) => !property.lines?.length)
  const off = properties.filter((property) => property.lines?.length && Math.abs(lineBudget(property) - (Number(property.budget) || 0)) > 1)
  return (
    <div className="import-lines">
      <p className={missing.length || off.length ? "import-lines-note is-warn" : "import-lines-note"}>
        {missing.length || off.length
          ? [missing.length ? `${missing.length} ${missing.length === 1 ? "property has" : "properties have"} no line items in its tab` : "", off.length ? `${off.length} where the lines don't add up to the budget` : ""].filter(Boolean).join(" · ")
          : `Every property's line items add up to its budget.`}
      </p>
      {properties.map((property) => {
        const total = lineBudget(property)
        const matches = property.lines?.length && Math.abs(total - (Number(property.budget) || 0)) <= 1
        const isOpen = open === property.address
        return (
          <div key={property.address} className={isOpen ? "import-line-card is-open" : "import-line-card"}>
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : property.address)}>
              <span className="import-line-name"><b>{property.address}</b><small>{property.city}</small></span>
              <span><small>Line items</small>{property.lines?.length || 0}</span>
              <span><small>Budget</small>{money(property.budget)}</span>
              <span><small>Draws</small>{property.draws}{property.pending ? ` + ${property.pendingTitle} pending` : ""}</span>
              <em className={matches ? "is-ok" : "is-warn"}>{!property.lines?.length ? "No lines" : matches ? "Adds up" : `Lines ${money(total)}`}</em>
            </button>
            {isOpen && (
              <div className="excel-wrap import-line-table">
                <table className="excel-sheet">
                  <thead><tr><th className="row-number">#</th><th>Line item</th><th>Description</th><th className="num">Budget</th><th className="num">Drawn</th><th className="num">Pending</th><th className="num">Remaining</th></tr></thead>
                  <tbody>
                    {(property.lines || []).map((line, index) => {
                      const remaining = line.budget == null ? null : line.budget - line.drawn - line.pending
                      return (
                        <tr key={`${line.title}-${index}`}>
                          <th className="row-number">{index + 1}</th>
                          <td>{line.title}</td>
                          <td className="import-line-description">{line.description}</td>
                          <td className="num">{line.budget == null ? "" : money(line.budget)}</td>
                          <td className="num">{line.drawn ? money(line.drawn) : ""}</td>
                          <td className="num">{line.pending ? money(line.pending) : ""}</td>
                          <td className={remaining < -0.5 ? "num is-over" : "num"}>{remaining == null ? "" : money(remaining)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function lineBudget(property) {
  return (property.lines || []).reduce((total, line) => total + (Number(line.budget) || 0), 0)
}

function DashboardPreview({ job }) {
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [hidden, setHidden] = useState([])
  const columns = (job.columns || []).map((label, index) => ({ id: String(index), label: label || `Column ${index + 1}`, index }))
  const shown = columns.filter((column) => !hidden.includes(column.id))
  return (
    <>
      <div className="sheet-tools">
        <p>Review the workbook below. Saving creates the properties and their draws in MongoDB.</p>
        <div className="column-picker">
          <button type="button" className="import-button" onClick={() => setColumnsOpen((value) => !value)}>Columns · {shown.length}</button>
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
          <thead>
            <tr><th className="row-number">#</th>{shown.map((column) => <th key={column.id}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {(job.grid || []).map((line, rowIndex) => (
              <tr key={rowIndex}>
                <th className="row-number">{rowIndex + 1}</th>
                {shown.map((column) => {
                  const cell = line[column.index] || ""
                  return <td key={column.id} className={isMoney(cell) ? "num" : undefined}>{cell}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function isMoney(value) {
  return /^[$%-]/.test(String(value || "").trim()) || /%$/.test(String(value || "").trim())
}

function count(job, key) {
  return Number(job.counts?.[key]) || 0
}
