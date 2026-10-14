"use client"

import { useState } from "react"
import { FormSheet } from "../ui/FormSheet"
import { api } from "../../lib/api"

const STATUS = {
  new: { label: "New", tone: "good" },
  update: { label: "Fill in", tone: "info" },
  same: { label: "No change", tone: "muted" },
  error: { label: "Fix", tone: "bad" },
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

// Import companies from Excel: download the template, choose a workbook, check every row, then import.
export function ImportCompanies({ onClose, onImported }) {
  const [preview, setPreview] = useState(null)
  const [fileName, setFileName] = useState("")
  const [reading, setReading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function read(event) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setError("")
    setPreview(null)
    setFileName(file.name)
    setReading(true)
    const body = new FormData()
    body.set("file", file)
    try {
      setPreview(await api("/companies/import/preview", { method: "POST", body }))
    } catch (err) {
      setError(err.message)
    } finally {
      setReading(false)
    }
  }

  const rows = preview?.rows || []
  const ready = rows.filter((row) => row.status === "new" || row.status === "update")
  const count = (status) => rows.filter((row) => row.status === status).length

  async function submit(event) {
    event.preventDefault()
    if (!ready.length) {
      setError(preview ? "No row is ready to import. Fix the rows marked Fix and choose the file again." : "Choose a workbook first.")
      return
    }
    setPending(true)
    setError("")
    try {
      const result = await api("/companies/import", { method: "POST", body: { rows: ready.map((row) => ({ row: row.row, fields: row.fields })) } })
      onImported(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <FormSheet
      eyebrow="Companies"
      title="Import from Excel"
      hint="One company per row, in the Companies template format. Required: Company Name, Entity Type, State of Formation, Effective Date, Authorized Member, Address, City, State and Zip. Owned Properties, wire instructions and EIN are optional."
      onClose={pending ? () => {} : onClose}
      onSubmit={submit}
      submitLabel={ready.length ? `Import ${plural(ready.length, "company", "companies")}` : "Import"}
      pending={pending}
      pendingLabel="Importing…"
      error={error}
    >
      <div className="import-steps">
        <a className="tool import-template" href="/api/companies/import-template" download>Download the template</a>
        <label className="import-choose">
          <span>{reading ? "Reading…" : fileName ? "Choose another file" : "Choose a workbook"}</span>
          <input type="file" accept=".xlsx,.xls,.xlsm,.csv" onChange={read} disabled={reading || pending} />
        </label>
        {fileName && !reading && <small className="doc-picked">{fileName}{preview?.sheet ? ` · sheet “${preview.sheet}”` : ""}</small>}
      </div>
      {preview && (
        <>
          <p className="import-summary">
            {[count("new") && `${count("new")} new`, count("update") && `${count("update")} to fill in`, count("same") && `${count("same")} already up to date`, count("error") && `${count("error")} to fix`].filter(Boolean).join(" · ")}
            {preview.truncated ? " · only the first 500 rows were read" : ""}
          </p>
          <p className="import-note">Companies already saved (same name) only get their blank details filled in. Nothing is overwritten.</p>
          <ul className="import-rows">
            {rows.map((row) => (
              <li key={row.row} className={`is-${row.status}`}>
                <span className="import-row-number">Row {row.row}</span>
                <span className="import-row-copy">
                  <strong>{row.name || "No company name"}</strong>
                  <em>{row.status === "new" ? [row.fields.entityType, row.fields.stateOfFormation, row.fields.city].filter(Boolean).join(" · ") : row.message}</em>
                  {row.status === "new" && (row.links || []).length > 0 && <small className="import-row-link">Links {row.links.join(", ")}</small>}
                  {(row.notes || []).map((note) => <small key={note} className="import-row-note">{note}</small>)}
                </span>
                <span className={`import-status is-${STATUS[row.status].tone}`}>{STATUS[row.status].label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </FormSheet>
  )
}
