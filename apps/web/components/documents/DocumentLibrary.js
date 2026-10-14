"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { COMPANY_DOCUMENT_LABELS, DOCUMENT_LABELS, allowedDocument, documentAccept, documentType, folderName, foldersFor } from "@synergifund/shared"
import { FormSheet } from "../ui/FormSheet"
import { api, uploadForm } from "../../lib/api"

const PREVIEW_ROWS = 6

const TYPES = [
  { id: "all", label: "All types" },
  { id: "documents", label: "Documents" },
  { id: "receipts", label: "Receipts" },
  { id: "photos", label: "Photos & videos" },
  { id: "workbooks", label: "Workbooks" },
]

export function fileType(file) {
  const name = (file.name || "").toLowerCase()
  if (file.kind === "receipt") return "Receipt"
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) return "Excel"
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "Word"
  if (name.endsWith(".pdf")) return "PDF"
  if (file.mime?.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif|avif)$/.test(name)) return "Photo"
  if (file.mime?.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(name)) return "Video"
  return "File"
}

function typeGroup(file) {
  if (file.kind === "receipt") return "receipts"
  if (file.kind === "photo" || fileType(file) === "Photo" || fileType(file) === "Video") return "photos"
  if (fileType(file) === "Excel") return "workbooks"
  return "documents"
}

export function isImage(file) {
  return fileType(file) === "Photo" || (file.kind === "receipt" && file.mime?.startsWith("image/"))
}

export function sizeLabel(bytes) {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function dateLabel(value) {
  if (!value) return ""
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function count(list, test) {
  return list.reduce((total, item) => total + (test(item) ? 1 : 0), 0)
}

// The whole document library: search, a "filed under" filter, type and label filters, grouped by property or company.
// Receipts and weekly site photos belong to an expense or photo set, so they stay where they were filed.
export function attached(file) {
  return file.kind === "receipt" || file.kind === "photo"
}

// Where a property's files are browsed in folders: the property's own Documents tab.
export function propertyHome(file) {
  return `/properties/${file.propertyId}?tab=documents`
}

export function fileFolder(file) {
  return file.folder ? folderName(file.propertyId ? "property" : file.companyId ? "company" : "", file.folder) : ""
}

// Where a file is filed: a property id, "company:<id>", or "none". A file is filed under one place at most.
const COMPANY = "company:"

function placeOf(file) {
  if (file.propertyId) return file.propertyId
  if (file.companyId) return `${COMPANY}${file.companyId}`
  return "none"
}

function isCompanyPlace(value) {
  return String(value || "").startsWith(COMPANY)
}

// The filed-under value as the API expects it: a property id and a company id, at most one of them set.
function placeBody(value) {
  if (!value || value === "none") return { propertyId: "", companyId: "" }
  if (isCompanyPlace(value)) return { propertyId: "", companyId: value.slice(COMPANY.length) }
  return { propertyId: value, companyId: "" }
}

export function DocumentLibrary({ files, properties = [], companies = [], fixedPropertyId = "", fixedCompanyId = "", labelOptions = DOCUMENT_LABELS, writable, canDelete, onChanged, initialProperty = "all", emptyText, uploadOpen, onUploadOpenChange, toolbarUpload = true, requireProperty = false, canEdit = () => true }) {
  const fixedPlace = fixedPropertyId || (fixedCompanyId ? `${COMPANY}${fixedCompanyId}` : "")
  const [query, setQuery] = useState("")
  const [propertyFilter, setPropertyFilter] = useState(fixedPlace || initialProperty)
  const [type, setType] = useState("all")
  const [label, setLabel] = useState("")
  const [uploadingState, setUploadingState] = useState(false)
  const uploading = uploadOpen ?? uploadingState
  const setUploading = onUploadOpenChange || setUploadingState
  const [editing, setEditing] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [error, setError] = useState("")

  const knownPlace = (value) => {
    if (isCompanyPlace(value)) {
      const id = value.slice(COMPANY.length)
      return companies.some((company) => company.id === id) || files.some((file) => file.companyId === id)
    }
    return properties.some((property) => property.id === value) || files.some((file) => file.propertyId === value)
  }
  const activeProperty = fixedPlace || (propertyFilter === "all" || propertyFilter === "none" || knownPlace(propertyFilter) ? propertyFilter : "all")

  const byProperty = useMemo(() => files.filter((file) => activeProperty === "all" || placeOf(file) === activeProperty), [files, activeProperty])

  const byType = useMemo(() => byProperty.filter((file) => type === "all" || typeGroup(file) === type), [byProperty, type])

  const labelCounts = useMemo(() => {
    const counts = new Map()
    for (const file of byType) for (const item of file.labels || []) counts.set(item, (counts.get(item) || 0) + 1)
    const ordered = [...labelOptions.filter((item) => counts.has(item)), ...[...counts.keys()].filter((item) => !labelOptions.includes(item)).sort()]
    return ordered.map((item) => ({ label: item, count: counts.get(item) }))
  }, [byType, labelOptions])
  const activeLabel = label === "__none" || labelCounts.some((item) => item.label === label) ? label : ""

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return byType.filter((file) => {
      if (activeLabel === "__none" && (file.labels || []).length) return false
      if (activeLabel && activeLabel !== "__none" && !(file.labels || []).includes(activeLabel)) return false
      if (!needle) return true
      return [file.name, file.property, file.company, fileFolder(file), ...(file.labels || []), fileType(file), file.uploadedBy].join(" ").toLowerCase().includes(needle)
    })
  }, [byType, activeLabel, query])

  const noneLabel = companies.length || files.some((file) => file.companyId) ? "Not linked to a property or company" : "Not linked to a property"

  const groups = useMemo(() => {
    if (fixedPlace || activeProperty !== "all") return [{ key: activeProperty, title: "", files: shown }]
    const map = new Map()
    for (const file of shown) {
      const key = placeOf(file)
      if (!map.has(key)) {
        map.set(key, file.propertyId
          ? { key, order: 0, href: propertyHome(file), title: file.property || "Property", files: [] }
          : file.companyId
            ? { key, order: 1, href: `/companies/${file.companyId}?tab=documents`, title: file.company || "Company", company: true, files: [] }
            : { key, order: 2, href: "", title: noneLabel, files: [] })
      }
      map.get(key).files.push(file)
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, undefined, { numeric: true }))
  }, [shown, fixedPlace, activeProperty, noneLabel])

  const propertyOptions = useMemo(() => {
    const seen = new Map(properties.map((property) => [property.id, property.address]))
    for (const file of files) if (file.propertyId && !seen.has(file.propertyId)) seen.set(file.propertyId, file.property || "Property")
    return [...seen.entries()]
      .map(([id, address]) => ({ id, address, count: count(files, (file) => file.propertyId === id) }))
      .sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }))
  }, [properties, files])

  const companyOptions = useMemo(() => {
    const seen = new Map(companies.map((company) => [company.id, company.name]))
    for (const file of files) if (file.companyId && !seen.has(file.companyId)) seen.set(file.companyId, file.company || "Company")
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name, count: count(files, (file) => file.companyId === id) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [companies, files])

  const unlabeled = count(byType, (file) => !(file.labels || []).length)
  const filtering = query || type !== "all" || activeLabel || (!fixedPlace && activeProperty !== "all")

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
        {!fixedPlace && (
          <label className="doc-select">
            <span>{companyOptions.length ? "Filed under" : "Property"}</span>
            <select value={activeProperty} onChange={(event) => { setPropertyFilter(event.target.value); setLabel("") }}>
              <option value="all">{companyOptions.length ? "All files" : "All properties"} ({files.length})</option>
              {companyOptions.length ? (
                <>
                  {propertyOptions.length > 0 && <optgroup label="Properties">{propertyOptions.map((option) => <option key={option.id} value={option.id}>{option.address} ({option.count})</option>)}</optgroup>}
                  <optgroup label="Companies">{companyOptions.map((option) => <option key={option.id} value={`${COMPANY}${option.id}`}>{option.name} ({option.count})</option>)}</optgroup>
                </>
              ) : propertyOptions.map((option) => <option key={option.id} value={option.id}>{option.address} ({option.count})</option>)}
              <option value="none">{noneLabel} ({count(files, (file) => placeOf(file) === "none")})</option>
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
            <button type="button" className="tool" onClick={() => { setQuery(""); setType("all"); setLabel(""); if (!fixedPlace) setPropertyFilter("all") }}>Clear filters</button>
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
                {group.href ? <Link href={group.href}>{group.title}</Link> : <span>{group.title}</span>}
                {group.company && <span className="doc-group-kind">Company</span>}
                <em>{group.files.length} {group.files.length === 1 ? "file" : "files"}</em>
              </header>
            )}
            <ul className="doc-list">
              {visible.map((file) => (
                <DocumentRow key={file.id} file={file} showProperty={fixedPlace ? false : !group.title} writable={writable && canEdit(file)} canDelete={canDelete} onEdit={() => setEditing(file)} onDelete={() => remove(file)} onLabel={(item) => setLabel(item)} />
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
          companies={companyOptions}
          fixedPlace={fixedPlace}
          defaultPlace={fixedPlace || (activeProperty !== "all" && activeProperty !== "none" ? activeProperty : "")}
          labelOptions={labelOptions}
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
          companies={companyOptions}
          fixedPlace={fixedPlace || (attached(editing) ? placeOf(editing) : "")}
          requireProperty={requireProperty}
          labelOptions={labelOptions}
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
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : kind === "Excel" ? "XLS" : kind === "Word" ? "DOC" : kind === "Receipt" ? "RCT" : kind === "Video" ? "VID" : kind.toUpperCase().slice(0, 3)}
        </span>
        <span className="doc-copy">
          <strong>{file.name}</strong>
          <small>{[kind, sizeLabel(file.size), dateLabel(file.createdAt), file.uploadedBy].filter(Boolean).join(" · ")}</small>
        </span>
      </Link>
      <span className="doc-tags">
        {showProperty && file.property && <Link href={propertyHome(file)} className="doc-tag is-property">{file.property}</Link>}
        {showProperty && file.company && <Link href={`/companies/${file.companyId}?tab=documents`} className="doc-tag is-company">{file.company}</Link>}
        {fileFolder(file) && <span className="doc-tag is-folder">{fileFolder(file)}</span>}
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

export function LabelPicker({ value, onChange, suggestions = [], base = DOCUMENT_LABELS }) {
  const [draft, setDraft] = useState("")
  const options = [...new Set([...base, ...suggestions])]
  const has = (item) => value.some((existing) => existing.toLowerCase() === item.toLowerCase())
  function add(item) {
    const text = String(item || "").trim().replace(/\s+/g, " ").slice(0, 40)
    if (!text || has(text) || value.length >= 8) return
    const standard = [...base, ...DOCUMENT_LABELS, ...COMPANY_DOCUMENT_LABELS].find((label) => label.toLowerCase() === text.toLowerCase())
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

// Where the file is filed: one property, one company (staff only), or neither.
function PlaceField({ properties, companies, value, onChange, fixedPlace, requireProperty }) {
  if (fixedPlace) return null
  const withCompanies = companies.length > 0 && !requireProperty
  return (
    <label className="field wide">
      <span>{withCompanies ? "Filed under" : "Property"}{requireProperty ? "" : <em> · optional</em>}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required={requireProperty}>
        <option value="" disabled={requireProperty}>{requireProperty ? "Choose a property" : withCompanies ? "Not linked to a property or company" : "Not linked to a property"}</option>
        {withCompanies ? (
          <>
            {properties.length > 0 && <optgroup label="Properties">{properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}</optgroup>}
            <optgroup label="Companies">{companies.map((company) => <option key={company.id} value={`${COMPANY}${company.id}`}>{company.name}</option>)}</optgroup>
          </>
        ) : properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
      </select>
    </label>
  )
}

const MAX_UPLOAD_MB = 95

// "property", "company" or "" for a filed-under value.
export function placeType(value) {
  if (!value || value === "none") return ""
  return isCompanyPlace(value) ? "company" : "property"
}

// The folder a file goes in, inside the property or company it is filed under.
function FolderField({ place, value, onChange }) {
  const folders = foldersFor(placeType(place))
  if (!folders.length) return null
  return (
    <label className="field wide">
      <span>Folder</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required>
        <option value="" disabled>Choose a folder</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
    </label>
  )
}

function sizeProblem(file) {
  return file.size > MAX_UPLOAD_MB * 1024 * 1024 ? `${file.name} is larger than ${MAX_UPLOAD_MB} MB.` : ""
}

function typeProblem(file, place) {
  if (allowedDocument(file.name, placeType(place))) return ""
  if (documentType(file.name) === "video") return `${file.name}: videos can only be added to a property.`
  return `${file.name}: only PDF, Word, Excel${placeType(place) === "property" ? ", image and video" : " and image"} files can be uploaded.`
}

export function UploadSheet({ properties = [], companies = [], fixedPlace, defaultPlace, defaultFolder = "", initialFiles = [], defaultLabels = [], title = "", placeName = "", labelOptions = DOCUMENT_LABELS, suggestions = [], requireProperty, onUploaded, onClose, onDone }) {
  const [files, setFiles] = useState(initialFiles)
  const [place, setPlace] = useState(defaultPlace || "")
  const [folder, setFolder] = useState(defaultFolder)
  const [labels, setLabels] = useState(defaultLabels)
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")
  const where = fixedPlace || place
  const kind = placeType(where)
  const folders = foldersFor(kind)
  const activeFolder = folders.some((item) => item.id === folder) ? folder : ""
  const problems = files.map((file) => typeProblem(file, where) || sizeProblem(file)).filter(Boolean)

  function changePlace(value) {
    setPlace(value)
    // A folder from a property does not exist in a company, and the other way round.
    if (placeType(value) !== kind) setFolder("")
  }

  async function submit(event) {
    event.preventDefault()
    if (!files.length) {
      setError("Choose at least one file.")
      return
    }
    if (problems.length) {
      setError(problems.join(" "))
      return
    }
    if (folders.length && !activeFolder) {
      setError("Choose the folder these files go in.")
      return
    }
    setError("")
    setPending(true)
    const failed = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const counter = files.length > 1 ? `${index + 1} of ${files.length} · ` : ""
      setProgress(`Uploading ${counter}0%`)
      const body = new FormData()
      const target = placeBody(where)
      body.set("file", file)
      body.set("propertyId", target.propertyId)
      if (target.companyId) body.set("companyId", target.companyId)
      if (activeFolder) body.set("folder", activeFolder)
      body.set("labels", JSON.stringify(labels))
      try {
        await uploadForm("/documents", body, (share) => setProgress(`Uploading ${counter}${Math.round(share * 100)}%`))
      } catch (err) {
        failed.push({ file, message: `${file.name}: ${err.message}` })
      }
    }
    setPending(false)
    setProgress("")
    if (failed.length) {
      if (failed.length < files.length) onUploaded?.()
      setFiles(failed.map((item) => item.file))
      setError(`${failed.length} of ${files.length} could not upload. ${failed.map((item) => item.message).join(" ")}`)
      return
    }
    onDone()
  }

  const placeLabel = isCompanyPlace(fixedPlace) ? "company" : "property"
  const folderLabel = folders.find((item) => item.id === activeFolder)?.name
  return (
    <FormSheet
      eyebrow="Documents"
      title={title || (fixedPlace && (placeName || folderLabel) ? `Upload to ${[placeName, folderLabel].filter(Boolean).join(" › ")}` : "Upload files")}
      hint={fixedPlace
        ? `PDF, Word, Excel${kind === "property" ? ", images or videos" : " or images"}, up to ${MAX_UPLOAD_MB} MB each. They are filed under this ${placeLabel}.`
        : companies.length && !requireProperty
          ? "File them under a property or a company, in one of its folders. PDF, Word, Excel or images (videos on properties only)."
          : `Link them to a property, in one of its folders. PDF, Word, Excel, images or videos, up to ${MAX_UPLOAD_MB} MB each.`}
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
          <input type="file" multiple accept={documentAccept(kind || "property")} onChange={(event) => { setFiles([...(event.target.files || [])]); setError("") }} />
          {files.length > 0 && <small className="doc-picked">{files.map((file) => file.name).join(", ")}</small>}
          {problems.length > 0 && <small className="doc-problem">{problems.join(" ")}</small>}
        </label>
        <PlaceField properties={properties} companies={companies} value={place} onChange={changePlace} fixedPlace={fixedPlace} requireProperty={requireProperty} />
        <FolderField place={where} value={activeFolder} onChange={setFolder} />
        <div className="field wide">
          <span>Labels <em>· optional</em></span>
          <LabelPicker value={labels} onChange={setLabels} suggestions={suggestions} base={labelOptions} />
        </div>
      </div>
    </FormSheet>
  )
}

export function EditSheet({ file, properties = [], companies = [], fixedPlace, requireProperty, labelOptions = DOCUMENT_LABELS, suggestions = [], onClose, onDone }) {
  const [name, setName] = useState(file.name)
  const [place, setPlace] = useState(placeOf(file) === "none" ? "" : placeOf(file))
  const [folder, setFolder] = useState(file.folder || "")
  const [labels, setLabels] = useState(file.labels || [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const where = fixedPlace && fixedPlace !== "none" ? fixedPlace : place
  const folders = foldersFor(placeType(where))
  const activeFolder = folders.some((item) => item.id === folder) ? folder : ""

  function changePlace(value) {
    setPlace(value)
    if (placeType(value) !== placeType(place)) setFolder("")
  }

  async function submit(event) {
    event.preventDefault()
    if (folders.length && !activeFolder) {
      setError("Choose the folder this file goes in.")
      return
    }
    setError("")
    setPending(true)
    try {
      const body = { name, labels, folder: activeFolder }
      if (!fixedPlace) {
        const target = placeBody(place)
        body.propertyId = target.propertyId
        // Only staff see companies; a contractor's edit never touches the company.
        if (companies.length || file.companyId) body.companyId = target.companyId
      }
      await api(`/documents/${file.id}`, { method: "PATCH", body })
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow="Documents" title="Edit file" hint={attached(file) ? "This file belongs to an expense or weekly photo set, so it stays on its property. You can rename it, move it to another folder and change its labels." : fixedPlace ? "Change its name, its folder or its labels." : companies.length && !requireProperty ? "Change its name, where it is filed, its folder or its labels." : "Change its name, the property it belongs to, its folder or its labels."} onClose={onClose} onSubmit={submit} submitLabel="Save" pending={pending} error={error}>
      <div className="form-grid">
        <label className="field wide"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} /></label>
        <PlaceField properties={properties} companies={companies} value={place} onChange={changePlace} fixedPlace={fixedPlace} requireProperty={requireProperty} />
        <FolderField place={where} value={activeFolder} onChange={setFolder} />
        <div className="field wide">
          <span>Labels <em>· optional</em></span>
          <LabelPicker value={labels} onChange={setLabels} suggestions={suggestions} base={labelOptions} />
        </div>
      </div>
    </FormSheet>
  )
}
