"use client"

import { useState } from "react"
import { FormSheet } from "../ui/FormSheet"

export const REPORT_SECTIONS = [
  { key: "summary", label: "Property summary", hint: "Address, status, purchase, size, rehab budget and ARV" },
  { key: "arv", label: "ARV and valuation", hint: "Suggested value, how it was worked out and the range" },
  { key: "comps", label: "Comparable sales", hint: "Address, sale price, dates, days to sell and $/sq ft" },
  { key: "compPhotos", label: "Comp photos", hint: "Photos added to each comp" },
  { key: "map", label: "Map", hint: "This property and every comp on one map" },
  { key: "scope", label: "Rehab budget and line items", hint: "Each line item with its budget, drawn and remaining" },
  { key: "draws", label: "Draw history", hint: "Every draw with its line items and status" },
  { key: "photos", label: "Site photos", hint: "The latest photos filed on site" },
  { key: "financing", label: "Financing", hint: "Loans and lenders on this property" },
  { key: "notes", label: "Notes for the reader", hint: "Anything you type below" },
]

const DEFAULTS = ["summary", "arv", "comps", "compPhotos", "map", "scope"]

export function reportKey(id) {
  return `synergifund-report:${id}`
}

export function readReport(id) {
  try {
    const saved = JSON.parse(localStorage.getItem(reportKey(id)) || "null")
    if (saved && Array.isArray(saved.sections)) return saved
  } catch {}
  return null
}

export function ReportSheet({ property, detail, onClose }) {
  const saved = typeof window !== "undefined" ? readReport(property.id) : null
  const [sections, setSections] = useState(saved?.sections || DEFAULTS)
  const [preparedFor, setPreparedFor] = useState(saved?.preparedFor || "")
  const [title, setTitle] = useState(saved?.title || "Property report")
  const [notes, setNotes] = useState(saved?.notes || "")
  const [error, setError] = useState("")
  const counts = {
    comps: (property.comps || []).length,
    compPhotos: (property.comps || []).reduce((sum, comp) => sum + (comp.photoIds || []).length, 0),
    map: (property.comps || []).length,
    scope: (property.scopeLines || []).length,
    draws: (detail.draws?.items || []).length,
    photos: (detail.photos || []).length,
    financing: (detail.loans || []).length,
    arv: property.arv != null || (property.comps || []).length ? 1 : 0,
  }
  const empty = (key) => key in counts && !counts[key]
  const emptyText = { comps: "No comps yet", compPhotos: "No comp photos yet", map: "No comps to map", scope: "No line items", draws: "No draws", photos: "No site photos", financing: "No loans on file", arv: "No ARV or comps yet" }

  function toggle(key) {
    setSections((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
  }

  function submit(event) {
    event.preventDefault()
    const chosen = REPORT_SECTIONS.map((section) => section.key).filter((key) => sections.includes(key) && !(empty(key) && key !== "notes"))
    if (!chosen.length) {
      setError("Pick at least one section that has information.")
      return
    }
    if (chosen.includes("notes") && !notes.trim()) {
      setError("Type the notes, or untick “Notes for the reader”.")
      return
    }
    try {
      localStorage.setItem(reportKey(property.id), JSON.stringify({ sections: chosen, preparedFor: preparedFor.trim(), title: title.trim() || "Property report", notes: notes.trim() }))
    } catch {}
    window.open(`/properties/${property.id}/report`, "_blank", "noopener")
    onClose()
  }

  return (
    <FormSheet eyebrow={property.address} title="Make a report" hint="Choose what goes in. It opens as a printable page you can save as a PDF and send to a lender or appraiser." onClose={onClose} onSubmit={submit} submitLabel="Create report" error={error}>
      <div className="form-grid">
        <label className="field wide"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field wide"><span>Prepared for <em>· optional</em></span><input value={preparedFor} placeholder="e.g. Kiavi underwriting, or the appraiser’s name" onChange={(event) => setPreparedFor(event.target.value)} /></label>
      </div>
      <div className="report-pick">
        <div className="report-pick-head">
          <span>Include</span>
          <button type="button" onClick={() => setSections(REPORT_SECTIONS.map((section) => section.key).filter((key) => !empty(key) && key !== "notes"))}>Select all</button>
          <button type="button" onClick={() => setSections([])}>Clear</button>
        </div>
        {REPORT_SECTIONS.map((section) => {
          const off = empty(section.key)
          return (
            <label key={section.key} className={off ? "report-option is-off" : "report-option"}>
              <input type="checkbox" checked={sections.includes(section.key) && !off} disabled={off} onChange={() => toggle(section.key)} />
              <span><b>{section.label}</b><small>{off ? emptyText[section.key] : section.hint}</small></span>
            </label>
          )
        })}
      </div>
      {sections.includes("notes") && (
        <label className="field report-notes"><span>Notes for the reader</span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Scope summary, timeline, anything the lender or appraiser should know." /></label>
      )}
    </FormSheet>
  )
}
