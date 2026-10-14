"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { COMPANY_DOCUMENT_LABELS, COMPANY_FOLDERS, DOCUMENT_LABELS, PROPERTY_FOLDERS, QUICK_ACCESS, quickAccessFiles } from "@synergifund/shared"
import { api } from "../../lib/api"
import { Icon } from "../ui/Icon"
import { EditSheet, UploadSheet, attached, dateLabel, fileType, isImage, sizeLabel } from "./DocumentLibrary"

const ZIP_MAX_FILES = 150
const ZIP_MAX_BYTES = 1500 * 1024 * 1024

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function newestFirst(a, b) {
  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
}

function folderLabel(file) {
  const list = file.propertyId ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  return list.find((item) => item.id === file.folder)?.name || "Miscellaneous"
}

function folderSummary(list) {
  return list.length ? `${plural(list.length, "file", "files")} · ${dateLabel(list[0].createdAt)}` : "Empty"
}

// Starts a download without leaving the page: one file as it is, several as a zip.
function startDownload(files, name) {
  const link = document.createElement("a")
  link.href = files.length === 1
    ? `/api/documents/${files[0].id}/download`
    : `/api/documents/zip?ids=${files.map((file) => file.id).join(",")}&name=${encodeURIComponent(name)}`
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// A company's Documents as folders: its own folders, then one folder per property it owns, each with the property folders.
// With `onlyProperty`, the same folders for one property on its own page (the same files the company shows).
// Open a folder, tick files, download or view them, upload into it.
export function FolderBrowser({ companyId = "", companyName = "", properties: owned = [], onlyProperty = null, files, writable, canDelete, canEdit = () => true, onChanged, initialProperty = "", initialFolder = "" }) {
  const properties = onlyProperty ? [onlyProperty] : owned
  const top = onlyProperty ? onlyProperty.id : ""
  const startProperty = onlyProperty ? onlyProperty.id : properties.some((item) => item.id === initialProperty) ? initialProperty : ""
  const startFolders = startProperty ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  const [at, setAt] = useState({ propertyId: startProperty, folder: startFolders.some((item) => item.id === initialFolder) ? initialFolder : "" })
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState([])
  const [uploading, setUploading] = useState(null)
  const [editing, setEditing] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const property = properties.find((item) => item.id === at.propertyId) || null
  const folders = property ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  const current = folders.find((item) => item.id === at.folder) || null
  const companyPlace = `company:${companyId}`
  const herePlace = property ? property.id : companyPlace

  // Files by where they sit: the company's folders, and each property's folders.
  const tree = useMemo(() => {
    const company = new Map(COMPANY_FOLDERS.map((item) => [item.id, []]))
    const owned = new Map(properties.map((item) => [item.id, new Map(PROPERTY_FOLDERS.map((folder) => [folder.id, []]))]))
    for (const file of files) {
      const box = file.propertyId ? owned.get(file.propertyId) : company
      if (!box) continue
      const key = box.has(file.folder) ? file.folder : "other"
      box.get(key).push(file)
    }
    for (const box of [company, ...owned.values()]) for (const list of box.values()) list.sort(newestFirst)
    return { company, owned }
  }, [files, properties])

  const box = property ? tree.owned.get(property.id) : tree.company
  const needle = query.trim().toLowerCase()
  const listed = useMemo(() => {
    let pool = []
    if (at.folder) pool = box?.get(at.folder) || []
    else if (needle) pool = property ? [...box.values()].flat() : [...tree.company.values(), ...[...tree.owned.values()].flatMap((folderMap) => [...folderMap.values()])].flat()
    pool = [...pool].sort(newestFirst)
    if (!needle) return pool
    return pool.filter((file) => [file.name, ...(file.labels || []), fileType(file), file.uploadedBy, folderLabel(file), file.property].join(" ").toLowerCase().includes(needle))
  }, [at.folder, needle, box, property, tree])

  const picked = listed.filter((file) => selected.includes(file.id))
  const allPicked = listed.length > 0 && picked.length === listed.length
  // Files can move between folders of the same property, or between the company's folders.
  const pickedPlaces = new Set(picked.map((file) => file.propertyId || companyPlace))
  const movable = picked.length > 0 && writable && pickedPlaces.size === 1 && picked.every((file) => canEdit(file))
  const moveFolders = picked[0]?.propertyId ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  const suggestions = [...new Set(files.flatMap((file) => file.labels || []))]

  function go(next) {
    setAt(onlyProperty ? { ...next, propertyId: onlyProperty.id } : next)
    setSelected([])
    setQuery("")
    setError("")
  }

  function toggle(id) {
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))
  }

  function download(list) {
    setError("")
    if (!list.length) return
    if (list.length > ZIP_MAX_FILES) {
      setError(`Download up to ${ZIP_MAX_FILES} files at a time. Tick fewer files.`)
      return
    }
    if (list.reduce((total, file) => total + (file.size || 0), 0) > ZIP_MAX_BYTES) {
      setError("That is too much to download at once. Tick fewer files.")
      return
    }
    startDownload(list, [companyName, property?.address, current?.name].filter(Boolean).join(" - ") || "Documents")
  }

  async function moveTo(target) {
    if (!target || !picked.length) return
    setBusy("Moving…")
    setError("")
    const failed = []
    for (const file of picked) {
      try {
        await api(`/documents/${file.id}`, { method: "PATCH", body: { folder: target } })
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`)
      }
    }
    setBusy("")
    setSelected([])
    if (failed.length) setError(failed.join(" "))
    onChanged?.()
  }

  async function remove(file) {
    if (!window.confirm(`Delete ${file.name}? This cannot be undone.`)) return
    setError("")
    try {
      await api(`/documents/${file.id}`, { method: "DELETE" })
      setSelected((list) => list.filter((id) => id !== file.id))
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  function openUpload(dropped = []) {
    setError("")
    setUploading({ place: herePlace, folder: at.folder, files: dropped, where: onlyProperty ? "" : property?.address || "" })
  }

  // Quick Access: upload straight into the document's main folder, labeled as that document.
  function uploadQuick(item) {
    setError("")
    setUploading({ place: property.id, folder: item.folder, files: [], where: onlyProperty ? "" : property.address, labels: [item.name], title: `Upload ${item.name}` })
  }

  const dropProps = writable ? {
    onDragOver: (event) => {
      if (![...(event.dataTransfer?.types || [])].includes("Files")) return
      event.preventDefault()
      setDragging(true)
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
    },
    onDrop: (event) => {
      if (![...(event.dataTransfer?.types || [])].includes("Files")) return
      event.preventDefault()
      setDragging(false)
      const dropped = [...(event.dataTransfer.files || [])]
      if (dropped.length) openUpload(dropped)
    },
  } : {}

  const whereNow = current?.name || (onlyProperty ? "" : property?.address) || ""
  const showTiles = !at.folder && !needle
  return (
    <div className={dragging ? "folders is-dragging" : "folders"} {...dropProps}>
      <div className="folders-bar">
        <nav className="folders-crumbs" aria-label="Folders">
          {at.propertyId !== top || at.folder ? <button type="button" onClick={() => go({ propertyId: top, folder: "" })}>All folders</button> : <strong>All folders</strong>}
          {property && !onlyProperty && (
            <>
              <span aria-hidden="true">›</span>
              {at.folder ? <button type="button" onClick={() => go({ propertyId: property.id, folder: "" })}>{property.address}</button> : <strong>{property.address}</strong>}
            </>
          )}
          {current && (
            <>
              <span aria-hidden="true">›</span>
              <strong>{current.name}</strong>
            </>
          )}
        </nav>
        <label className="folders-search">
          <Icon name="search" size={14} />
          <span className="sr-only">Search files</span>
          <input type="search" value={query} placeholder={whereNow ? `Search ${whereNow}` : "Search all folders"} onChange={(event) => { setQuery(event.target.value); setSelected([]) }} />
        </label>
        {writable && (
          <button type="button" className="primary folders-upload" onClick={() => openUpload()}>
            <Icon name="upload" size={14} /> {at.folder ? "Upload here" : "Upload"}
          </button>
        )}
      </div>

      {error && <p className="banner">{error}</p>}

      {showTiles && (
        <>
          {property && !onlyProperty && <p className="folders-note">Documents for {property.address}.</p>}
          <ul className="folder-grid">
            {folders.map((item) => {
              const list = box?.get(item.id) || []
              return (
                <li key={item.id}>
                  <FolderTile name={item.name} meta={list.length || !item.required ? folderSummary(list) : ""} filled={list.length > 0} status={item.required ? (list.length ? "ok" : "missing") : ""} icon={item.required ? "file" : "folder"} onOpen={() => go({ propertyId: at.propertyId, folder: item.id })} />
                </li>
              )
            })}
          </ul>
          {property && (
            <QuickAccess
              files={[...(box?.values() || [])].flat()}
              writable={writable}
              viewHref={(file) => `/documents/${file.id}${onlyProperty ? "" : "?in=company"}`}
              onOpenFolder={(folder) => go({ propertyId: property.id, folder })}
              onUpload={uploadQuick}
            />
          )}
          {!property && (
            <>
              <h3 className="folders-heading">Properties <em>{properties.length ? `· ${properties.length}` : ""}</em></h3>
              {properties.length === 0 ? (
                <p className="folders-note">Properties assigned to {companyName} show here, each with its own folders: {PROPERTY_FOLDERS.map((item) => item.name).join(", ")}.</p>
              ) : (
                <ul className="folder-grid">
                  {properties.map((item) => {
                    const list = [...(tree.owned.get(item.id)?.values() || [])].flat().sort(newestFirst)
                    return (
                      <li key={item.id}>
                        <FolderTile name={item.address} meta={folderSummary(list)} filled={list.length > 0} building onOpen={() => go({ propertyId: item.id, folder: "" })} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {!showTiles && (
        <>
          {listed.length > 0 && (
            <div className={picked.length ? "folders-select is-on" : "folders-select"}>
              <label className="folders-check">
                <input type="checkbox" checked={allPicked} ref={(element) => { if (element) element.indeterminate = picked.length > 0 && !allPicked }} onChange={() => setSelected(allPicked ? [] : listed.map((file) => file.id))} />
                <span>{picked.length ? `${picked.length} selected` : "Select all"}</span>
              </label>
              {picked.length > 0 ? (
                <>
                  <button type="button" className="tool" onClick={() => download(picked)}><Icon name="download" size={14} /> {picked.length === 1 ? "Download" : `Download ${picked.length} as zip`}</button>
                  {movable && (
                    <label className="folders-move">
                      <span className="sr-only">Move to folder</span>
                      <select value="" disabled={Boolean(busy)} onChange={(event) => moveTo(event.target.value)}>
                        <option value="">{busy || "Move to…"}</option>
                        {moveFolders.filter((item) => !(at.folder && item.id === at.folder)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                  )}
                  <button type="button" className="tool" onClick={() => setSelected([])}>Clear</button>
                </>
              ) : (
                at.folder && <button type="button" className="tool" onClick={() => download(listed)}><Icon name="download" size={14} /> Download {listed.length === 1 ? "file" : `all (${listed.length})`}</button>
              )}
            </div>
          )}

          {listed.length === 0 && (
            <div className="doc-empty">
              <strong>{needle ? `No files match “${query.trim()}”.` : `Nothing in ${current?.name} yet.`}</strong>
              {needle ? (
                <button type="button" className="tool" onClick={() => setQuery("")}>Clear search</button>
              ) : writable ? (
                <>
                  <span>Drop files here, or</span>
                  <button type="button" className="tool" onClick={() => openUpload()}>Upload a file</button>
                </>
              ) : null}
            </div>
          )}

          <ul className="folder-files">
            {listed.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                where={at.folder ? "" : [property ? "" : file.property, folderLabel(file)].filter(Boolean).join(" › ")}
                viewHref={`/documents/${file.id}${onlyProperty ? "" : "?in=company"}`}
                checked={selected.includes(file.id)}
                onToggle={() => toggle(file.id)}
                writable={writable && canEdit(file)}
                canDelete={canDelete && !attached(file)}
                onEdit={() => setEditing(file)}
                onDelete={() => remove(file)}
              />
            ))}
          </ul>
        </>
      )}

      {dragging && <div className="folders-drop" aria-hidden="true"><Icon name="upload" size={22} /> Drop to upload{whereNow ? ` to ${whereNow}` : ""}</div>}

      {uploading && (
        <UploadSheet
          fixedPlace={uploading.place}
          defaultFolder={uploading.folder}
          initialFiles={uploading.files}
          defaultLabels={uploading.labels || []}
          title={uploading.title || ""}
          placeName={uploading.where}
          labelOptions={uploading.place === companyPlace ? COMPANY_DOCUMENT_LABELS : DOCUMENT_LABELS}
          suggestions={suggestions}
          onUploaded={() => onChanged?.()}
          onClose={() => setUploading(null)}
          onDone={() => { setUploading(null); onChanged?.() }}
        />
      )}
      {editing && (
        <EditSheet
          file={editing}
          fixedPlace={editing.propertyId || companyPlace}
          labelOptions={editing.propertyId ? DOCUMENT_LABELS : COMPANY_DOCUMENT_LABELS}
          suggestions={suggestions}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); onChanged?.() }}
        />
      )}
    </div>
  )
}

// Key documents of a property in one place: each shows its newest file, or that it is not uploaded yet.
function QuickAccess({ files, writable, viewHref, onOpenFolder, onUpload }) {
  return (
    <section className="quick-access" aria-label="Quick Access Documents">
      <h3 className="folders-heading">Quick Access Documents</h3>
      <ul className="quick-list">
        {QUICK_ACCESS.map((item) => {
          const list = quickAccessFiles(files, item).sort(newestFirst)
          const latest = list[0]
          const folder = PROPERTY_FOLDERS.find((entry) => entry.id === item.folder)
          return (
            <li key={item.id} className={latest ? "" : "is-empty"}>
              <span className={latest ? "quick-icon" : "quick-icon is-empty"} aria-hidden="true"><Icon name="file" size={18} /></span>
              <span className="quick-copy">
                <strong>{item.name}</strong>
                <em>
                  {latest ? <Link href={viewHref(latest)}>{latest.name}</Link> : "Not uploaded yet"}
                  {latest && ` · ${dateLabel(latest.createdAt)}`}
                  {list.length > 1 && ` · ${list.length} files`}
                  {" · in "}
                  <button type="button" onClick={() => onOpenFolder(item.folder)}>{folder?.name}</button>
                </em>
              </span>
              <DocStatus missing={false} label={latest ? "On file" : "Not uploaded"} tone={latest ? "ok" : "none"} />
              <span className="quick-actions">
                {latest && <Link href={viewHref(latest)}>View</Link>}
                {latest && <a href={`/api/documents/${latest.id}/download`}>Download</a>}
                {writable && <button type="button" onClick={() => onUpload(item)}>Upload</button>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// A required company document shows Missing until a file is in its folder, then On file.
// The four required company documents show a document icon; ordinary folders a folder.
function FolderTile({ name, meta, filled, status = "", building = false, icon = "folder", onOpen }) {
  return (
    <button type="button" className={status === "missing" ? "folder-tile is-missing" : "folder-tile"} onClick={onOpen} title={name}>
      <span className={`folder-icon${filled ? "" : " is-empty"}${building ? " is-property" : ""}`}><Icon name={building ? "building" : icon} size={22} /></span>
      <span className="folder-copy">
        <strong>{name}</strong>
        <span className="folder-meta">
          {status && <DocStatus missing={status === "missing"} />}
          {meta && <em>{meta}</em>}
        </span>
      </span>
      <Icon name="chevron" size={14} />
    </button>
  )
}

export function DocStatus({ missing, label, tone = "" }) {
  return <span className={`doc-status is-${tone || (missing ? "missing" : "ok")}`}>{label || (missing ? "Missing" : "On file")}</span>
}

function FileRow({ file, where, viewHref, checked, onToggle, writable, canDelete, onEdit, onDelete }) {
  const kind = fileType(file)
  const thumb = isImage(file) ? file.url || `/api/documents/${file.id}/raw` : ""
  return (
    <li className={checked ? "folder-file is-selected" : "folder-file"}>
      <label className="folders-check">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="sr-only">Select {file.name}</span>
      </label>
      <Link href={viewHref} className="doc-open">
        <span className={`doc-badge is-${kind.toLowerCase()}`} aria-hidden="true">
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : kind === "Excel" ? "XLS" : kind === "Word" ? "DOC" : kind === "Receipt" ? "RCT" : kind === "Video" ? "VID" : kind.toUpperCase().slice(0, 3)}
        </span>
        <span className="doc-copy">
          <strong>{file.name}</strong>
          <small>{[kind, sizeLabel(file.size), dateLabel(file.createdAt), file.uploadedBy].filter(Boolean).join(" · ")}</small>
        </span>
      </Link>
      <span className="doc-tags">
        {where && <span className="doc-tag is-folder">{where}</span>}
        {(file.labels || []).map((item) => <span key={item} className="doc-tag">{item}</span>)}
      </span>
      <span className="doc-actions">
        <Link href={viewHref}>View</Link>
        <a href={`/api/documents/${file.id}/download`}>Download</a>
        {writable && <button type="button" onClick={onEdit}>Edit</button>}
        {canDelete && <button type="button" className="is-danger" onClick={onDelete}>Delete</button>}
      </span>
    </li>
  )
}
