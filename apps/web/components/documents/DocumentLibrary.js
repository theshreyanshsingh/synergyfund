"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { DOCUMENT_LABELS } from "@synergifund/shared"
import { FormSheet } from "../ui/FormSheet"
import { api } from "../../lib/api"

const PREVIEW_ROWS = 6

const TYPES = [
  { id: "all", label: "All types" },
  { id: "documents", label: "Documents" },
  { id: "receipts", label: "Receipts" },
  { id: "photos", label: "Photos" },
  { id: "workbooks", label: "Workbooks" },
]

export function fileType(file) {
  const name = (file.name || "").toLowerCase()
  if (file.kind === "receipt") return "Receipt"
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) return "Excel"
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "Word"
  if (name.endsWith(".pdf")) return "PDF"
  if (file.mime?.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/.test(name)) return "Photo"
  return "File"
}

function typeGroup(file) {
  if (file.kind === "receipt") return "receipts"
  if (file.kind === "photo" || fileType(file) === "Photo") return "photos"
  if (fileType(file) === "Excel") return "workbooks"
  return "documents"
}

function isImage(file) {
  return fileType(file) === "Photo" || (file.kind === "receipt" && file.mime?.startsWith("image/"))
}

function sizeLabel(bytes) {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function dateLabel(value) {
  if (!value) return ""
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function count(list, test) {
  return list.reduce((total, item) => total + (test(item) ? 1 : 0), 0)
}

// The whole document library: search, a property filter, type and label filters, grouped by property.
// Receipts and weekly site photos belong to an expense or photo set, so they stay where they were filed.
function attached(file) {
  return file.kind === "receipt" || file.kind === "photo"
}

export function DocumentLibrary({ files, properties = [], fixedPropertyId = "", writable, canDelete, onChanged, initialProperty = "all", emptyText, uploadOpen, onUploadOpenChange, toolbarUpload = true, requireProperty = false, canEdit = () => true }) {
  const [query, setQuery] = useState("")
  const [propertyFilter, setPropertyFilter] = useState(fixedPropertyId ? fixedPropertyId : initialProperty)
  const [type, setType] = useState("all")
  const [label, setLabel] = useState("")
  const [uploadingState, setUploadingState] = useState(false)
  const uploading = uploadOpen ?? uploadingState
  const setUploading = onUploadOpenChange || setUploadingState
  const [editing, setEditing] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [error, setError] = useState("")

  const knownProperty = (id) => properties.some((property) => property.id === id) || files.some((file) => file.propertyId === id)
  const activeProperty = fixedPropertyId || (propertyFilter === "all" || propertyFilter === "none" || knownProperty(propertyFilter) ? propertyFilter : "all")

  const byProperty = useMemo(() => files.filter((file) => {
    if (activeProperty === "all") return true
    if (activeProperty === "none") return !file.propertyId
    return file.propertyId === activeProperty
  }), [files, activeProperty])

  const byType = useMemo(() => byProperty.filter((file) => type === "all" || typeGroup(file) === type), [byProperty, type])

  const labelCounts = useMemo(() => {
    const counts = new Map()
    for (const file of byType) for (const item of file.labels || []) counts.set(item, (counts.get(item) || 0) + 1)
    const ordered = [...DOCUMENT_LABELS.filter((item) => counts.has(item)), ...[...counts.keys()].filter((item) => !DOCUMENT_LABELS.includes(item)).sort()]
    return ordered.map((item) => ({ label: item, count: counts.get(item) }))
  }, [byType])
  const activeLabel = label === "__none" || labelCounts.some((item) => item.label === label) ? label : ""

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return byType.filter((file) => {
      if (activeLabel === "__none" && (file.labels || []).length) return false
      if (activeLabel && activeLabel !== "__none" && !(file.labels || []).includes(activeLabel)) return false
      if (!needle) return true
      return [file.name, file.property, ...(file.labels || []), fileType(file), file.uploadedBy].join(" ").toLowerCase().includes(needle)
    })
  }, [byType, activeLabel, query])

  const groups = useMemo(() => {
    if (fixedPropertyId || activeProperty !== "all") return [{ key: activeProperty, title: "", files: shown }]
    const map = new Map()
    for (const file of shown) {
      const key = file.propertyId || "none"
      if (!map.has(key)) map.set(key, { key, propertyId: file.propertyId, title: file.propertyId ? file.property || "Property" : "Not linked to a property", files: [] })
      map.get(key).files.push(file)
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === "none") return 1
      if (b.key === "none") return -1
      return a.title.localeCompare(b.title, undefined, { numeric: true })
    })
  }, [shown, fixedPropertyId, activeProperty])

  const propertyOptions = useMemo(() => {
    const seen = new Map(properties.map((property) => [property.id, property.address]))
    for (const file of files) if (file.propertyId && !seen.has(file.propertyId)) seen.set(file.propertyId, file.property || "Property")
    return [...seen.entries()]
      .map(([id, address]) => ({ id, address, count: count(files, (file) => file.propertyId === id) }))
      .sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }))
  }, [properties, files])

  const unlabeled = count(byType, (file) => !(file.labels || []).length)
  const filtering = query || type !== "all" || activeLabel || (!fixedPropertyId && activeProperty !== "all")

  async function remove(file) {
    if (!window.confirm(`Delete ${file.name}? This cannot be undone.`)) return
    setError("")
    try {
      await api(`/documents/${file.id}`, { method: "DELETE" })
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="doc-library">
      <div className="doc-toolbar">
        <label className="doc-search">
          <span className="sr-only">Search files</span>
          <input type="search" value={query} placeholder="Search by name, label or property" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {!fixedPropertyId && (
          <label className="doc-select">
            <span>Property</span>
            <select value={activeProperty} onChange={(event) => { setPropertyFilter(event.target.value); setLabel("") }}>
              <option value="all">All properties ({files.length})</option>
              {propertyOptions.map((option) => <option key={option.id} value={option.id}>{option.address} ({option.count})</option>)}
              <option value="none">Not linked to a property ({count(files, (file) => !file.propertyId)})</option>
            </select>
          </label>
        )}
        <label className="doc-select">
          <span>Type</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {TYPES.map((option) => <option key={option.id} value={option.id}>{option.label}{option.id === "all" ? "" : ` (${count(byProperty, (file) => typeGroup(file) === option.id)})`}</option>)}
          </select>
        </label>
        {writable && toolbarUpload && <button type="button" className="primary doc-upload" onClick={() => setUploading(true)}>Upload</button>}
      </div>

      {(labelCounts.length > 0 || unlabeled > 0) && byType.length > 0 && (
        <div className="doc-chips" role="group" aria-label="Filter by label">
          <button type="button" className={!activeLabel ? "doc-chip is-on" : "doc-chip"} onClick={() => setLabel("")}>All <em>{byType.length}</em></button>
          {labelCounts.map((item) => (
            <button key={item.label} type="button" className={activeLabel === item.label ? "doc-chip is-on" : "doc-chip"} onClick={() => setLabel(activeLabel === item.label ? "" : item.label)}>{item.label} <em>{item.count}</em></button>
          ))}
          {unlabeled > 0 && labelCounts.length > 0 && (
            <button type="button" className={activeLabel === "__none" ? "doc-chip is-on" : "doc-chip"} onClick={() => setLabel(activeLabel === "__none" ? "" : "__none")}>No label <em>{unlabeled}</em></button>
          )}
        </div>
      )}

      {error && <p className="banner">{error}</p>}

      {shown.length === 0 && (
        <div className="doc-empty">
          <strong>{filtering ? "No files match these filters." : emptyText || "No files yet."}</strong>
          {filtering ? (
            <button type="button" className="tool" onClick={() => { setQuery(""); setType("all"); setLabel(""); if (!fixedPropertyId) setPropertyFilter("all") }}>Clear filters</button>
          ) : writable ? (
            <button type="button" className="tool" onClick={() => setUploading(true)}>Upload a file</button>
          ) : null}
        </div>
      )}

      {groups.filter((group) => group.files.length).map((group) => {
        const open = expanded[group.key] || group.files.length <= PREVIEW_ROWS + 1
        const visible = open ? group.files : group.files.slice(0, PREVIEW_ROWS)
        return (
          <section key={group.key} className="doc-group">
            {group.title && (
              <header className="doc-group-head">
                {group.propertyId ? <Link href={`/properties/${group.propertyId}?tab=documents`}>{group.title}</Link> : <span>{group.title}</span>}
                <em>{group.files.length} {group.files.length === 1 ? "file" : "files"}</em>
              </header>
            )}
            <ul className="doc-list">
              {visible.map((file) => (
                <DocumentRow key={file.id} file={file} showProperty={Boolean(fixedPropertyId) ? false : !group.title} writable={writable && canEdit(file)} canDelete={canDelete} onEdit={() => setEditing(file)} onDelete={() => remove(file)} onLabel={(item) => setLabel(item)} />
              ))}
            </ul>
            {!open && (
              <button type="button" className="doc-more" onClick={() => setExpanded((current) => ({ ...current, [group.key]: true }))}>Show all {group.files.length} files</button>
            )}
          </section>
        )
      })}

      {uploading && (
        <UploadSheet
          properties={propertyOptions}
          fixedPropertyId={fixedPropertyId}
          defaultPropertyId={fixedPropertyId || (activeProperty !== "all" && activeProperty !== "none" ? activeProperty : "")}
          suggestions={labelCounts.map((item) => item.label)}
          requireProperty={requireProperty}
          onUploaded={() => onChanged?.()}
          onClose={() => setUploading(false)}
          onDone={() => { setUploading(false); onChanged?.() }}
        />
      )}
      {editing && (
        <EditSheet
          file={editing}
          properties={propertyOptions}
          fixedPropertyId={fixedPropertyId || (attached(editing) ? editing.propertyId || "none" : "")}
          requireProperty={requireProperty}
          suggestions={labelCounts.map((item) => item.label)}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); onChanged?.() }}
        />
      )}
    </div>
  )
}

function DocumentRow({ file, showProperty, writable, canDelete, onEdit, onDelete, onLabel }) {
  const kind = fileType(file)
  const thumb = isImage(file) ? file.url || `/api/documents/${file.id}/raw` : ""
  return (
    <li className="doc-row">
      <Link href={`/documents/${file.id}`} className="doc-open">
        <span className={`doc-badge is-${kind.toLowerCase()}`} aria-hidden="true">
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : kind === "Excel" ? "XLS" : kind === "Word" ? "DOC" : kind === "Receipt" ? "RCT" : kind.toUpperCase().slice(0, 3)}
        </span>
        <span className="doc-copy">
          <strong>{file.name}</strong>
          <small>{[kind, sizeLabel(file.size), dateLabel(file.createdAt), file.uploadedBy].filter(Boolean).join(" · ")}</small>
        </span>
      </Link>
      <span className="doc-tags">
        {showProperty && file.property && <Link href={`/properties/${file.propertyId}?tab=documents`} className="doc-tag is-property">{file.property}</Link>}
        {(file.labels || []).map((item) => <button key={item} type="button" className="doc-tag" onClick={() => onLabel(item)}>{item}</button>)}
      </span>
      <span className="doc-actions">
        <a href={`/api/documents/${file.id}/download`}>Download</a>
        {writable && <button type="button" onClick={onEdit}>Edit</button>}
        {canDelete && !attached(file) && <button type="button" className="is-danger" onClick={onDelete}>Delete</button>}
      </span>
    </li>
  )
}

export function LabelPicker({ value, onChange, suggestions = [] }) {
  const [draft, setDraft] = useState("")
  const options = [...new Set([...DOCUMENT_LABELS, ...suggestions])]
  const has = (item) => value.some((existing) => existing.toLowerCase() === item.toLowerCase())
  function add(item) {
    const text = String(item || "").trim().replace(/\s+/g, " ").slice(0, 40)
    if (!text || has(text) || value.length >= 8) return
    const standard = DOCUMENT_LABELS.find((label) => label.toLowerCase() === text.toLowerCase())
    onChange([...value, standard || text])
  }
  return (
    <div className="label-editor-wrap">
      <div className="label-editor">
        {value.map((item) => <button key={item} type="button" className="label-chip" onClick={() => onChange(value.filter((existing) => existing !== item))} aria-label={`Remove label ${item}`}>{item} ×</button>)}
        <input
          value={draft}
          placeholder={value.length ? "Add another label" : "Type a label, or pick one below"}
          maxLength={40}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault()
              add(draft)
              setDraft("")
            } else if (event.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => { if (draft.trim()) { add(draft); setDraft("") } }}
        />
      </div>
      <div className="label-suggestions">
        {options.filter((item) => !has(item)).map((item) => <button key={item} type="button" onClick={() => add(item)}>{item}</button>)}
      </div>
    </div>
  )
}

function PropertyField({ properties, value, onChange, fixedPropertyId, requireProperty }) {
  if (fixedPropertyId) return null
  return (
    <label className="field wide">
      <span>Property{requireProperty ? "" : <em> · optional</em>}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required={requireProperty}>
        <option value="" disabled={requireProperty}>{requireProperty ? "Choose a property" : "Not linked to a property"}</option>
        {properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
      </select>
    </label>
  )
}

function UploadSheet({ properties, fixedPropertyId, defaultPropertyId, suggestions, requireProperty, onUploaded, onClose, onDone }) {
  const [files, setFiles] = useState([])
  const [propertyId, setPropertyId] = useState(defaultPropertyId || "")
  const [labels, setLabels] = useState([])
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")

  async function submit(event) {
    event.preventDefault()
    if (!files.length) {
      setError("Choose at least one file.")
      return
    }
    setError("")
    setPending(true)
    const failed = []
    for (let index = 0; index < files.length; index += 1) {
      setProgress(`Uploading ${index + 1} of ${files.length}…`)
      const body = new FormData()
      body.set("file", files[index])
      body.set("propertyId", fixedPropertyId || propertyId)
      body.set("labels", JSON.stringify(labels))
      try {
        await api("/documents", { method: "POST", body })
      } catch (err) {
        failed.push(`${files[index].name}: ${err.message}`)
      }
    }
    setPending(false)
    setProgress("")
    if (failed.length) {
      if (failed.length < files.length) onUploaded?.()
      setFiles((current) => current.filter((file) => failed.some((line) => line.startsWith(`${file.name}:`))))
      setError(`${failed.length} of ${files.length} could not upload. ${failed.join(" ")}`)
      return
    }
    onDone()
  }

  return (
    <FormSheet
      eyebrow="Documents"
      title="Upload files"
      hint={fixedPropertyId ? "These files are filed under this property. Labels are optional." : "Link them to a property and add labels so they are easy to find. Both are optional."}
      onClose={pending ? () => {} : onClose}
      onSubmit={submit}
      submitLabel={files.length > 1 ? `Upload ${files.length} files` : "Upload"}
      pending={pending}
      pendingLabel={progress || "Uploading…"}
      error={error}
    >
      <div className="form-grid">
        <label className="field wide">
          <span>Files</span>
          <input type="file" multiple onChange={(event) => setFiles([...(event.target.files || [])])} />
          {files.length > 0 && <small className="doc-picked">{files.map((file) => file.name).join(", ")}</small>}
        </label>
        <PropertyField properties={properties} value={propertyId} onChange={setPropertyId} fixedPropertyId={fixedPropertyId} requireProperty={requireProperty} />
        <div className="field wide">
          <span>Labels <em>· optional</em></span>
          <LabelPicker value={labels} onChange={setLabels} suggestions={suggestions} />
        </div>
      </div>
    </FormSheet>
  )
}

function EditSheet({ file, properties, fixedPropertyId, requireProperty, suggestions, onClose, onDone }) {
  const [name, setName] = useState(file.name)
  const [propertyId, setPropertyId] = useState(file.propertyId || "")
  const [labels, setLabels] = useState(file.labels || [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function submit(event) {
    event.preventDefault()
    setError("")
    setPending(true)
    try {
      const body = { name, labels }
      if (!fixedPropertyId) body.propertyId = propertyId
      await api(`/documents/${file.id}`, { method: "PATCH", body })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow="Documents" title="Edit file" hint={attached(file) ? "This file belongs to an expense or weekly photo set, so it stays on its property. You can rename it and change its labels." : "Change its name, the property it belongs to, or its labels."} onClose={onClose} onSubmit={submit} submitLabel="Save" pending={pending} error={error}>
      <div className="form-grid">
        <label className="field wide"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} /></label>
        <PropertyField properties={properties} value={propertyId} onChange={setPropertyId} fixedPropertyId={fixedPropertyId} requireProperty={requireProperty} />
        <div className="field wide">
          <span>Labels <em>· optional</em></span>
          <LabelPicker value={labels} onChange={setLabels} suggestions={suggestions} />
        </div>
      </div>
    </FormSheet>
  )
}
