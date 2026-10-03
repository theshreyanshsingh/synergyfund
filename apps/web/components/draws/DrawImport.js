"use client"

import { useState } from "react"
import { StatusPill } from "../ui/StatusPill"
import { api } from "../../lib/api"

const LABELS = {
  new: "Will append",
  added: "Added",
  duplicate: "Duplicate",
  skipped: "Skipped",
}

export function DrawImport({ job, imports, onOpen, onChange, onReload, inputRef }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function upload(event) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setBusy(true)
    setError("")
    try {
      const body = new FormData()
      body.set("file", file)
      const result = await api("/draws/import", { method: "POST", body })
      onOpen(result.import)
      onReload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError("")
    try {
      const result = await api(`/draws/import/${job.id}/confirm`, { method: "POST", body: {} })
      onChange(result.import)
      onReload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={upload} />
      {error && !job && <p className="draws-empty">{error}</p>}
      {job && (
        <section className="panel import-panel">
          <div className="import-head">
            <div>
              <h2>{job.name}</h2>
              <p>
                {count(job, "added") || count(job, "pending")} to append
                {" · "}
                {count(job, "duplicate")} duplicates left as they are
                {" · "}
                {count(job, "skipped")} skipped
              </p>
            </div>
            <div className="import-actions">
              {job.status === "Draft" && (
                <button type="button" className="primary" disabled={busy || !count(job, "pending")} onClick={confirm}>
                  {count(job, "pending") ? "Append new rows" : "Nothing new to add"}
                </button>
              )}
              <button type="button" className="import-button" onClick={() => onOpen(null)}>Close</button>
            </div>
          </div>
          {error && <p className="draws-empty">{error}</p>}
          <p className="import-note">Duplicate rows stay marked and are not saved again. Draws and budgets already on file are not replaced.</p>
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
        </section>
      )}
      {!job && imports.length > 0 && (
        <div className="import-history">
          {imports.map((item) => (
            <button key={item.id} type="button" onClick={async () => {
              const result = await api(`/draws/imports/${item.id}`)
              onOpen(result.import)
            }}>
              {item.name}
              <span>{item.status === "Confirmed" ? `${item.counts?.added || 0} added` : "Not added yet"}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function count(job, key) {
  return Number(job.counts?.[key]) || 0
}
