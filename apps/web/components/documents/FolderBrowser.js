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
// Open a folder, tick files (ticks stay while you move between folders), download them as one zip, view them, upload.
export function FolderBrowser({ companyId = "", companyName = "", properties: owned = [], onlyProperty = null, files, writable, canDelete, canEdit = () => true, onChanged, initialProperty = "", initialFolder = "" }) {
  const properties = onlyProperty ? [onlyProperty] : owned
  const top = onlyProperty ? onlyProperty.id : ""
  const startProperty = onlyProperty ? onlyProperty.id : properties.some((item) => item.id === initialProperty) ? initialProperty : ""
  const startFolders = startProperty ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  const [at, setAt] = useState({ propertyId: startProperty, folder: startFolders.some((item) => item.id === initialFolder) ? initialFolder : "" })
  const [query, setQuery] = useState("")
  // Ticked files, kept while you move between folders: tick a file in Contracts, another in Renovation & Rehab,
  // then download them together with Download zip beside Upload.
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

  const selectedSet = useMemo(() => new Set(selected), [selected])
  // Only files that still exist (a ticked file may have been deleted or moved away since).
  const selectedFiles = useMemo(() => files.filter((file) => selectedSet.has(file.id)), [files, selectedSet])
  const picked = listed.filter((file) => selectedSet.has(file.id))
  const allPicked = listed.length > 0 && picked.length === listed.length
  // Files can move between folders of the same property, or between the company's folders.
  const pickedPlaces = new Set(picked.map((file) => file.propertyId || companyPlace))
  const movable = picked.length > 0 && writable && pickedPlaces.size === 1 && picked.every((file) => canEdit(file))
  const moveFolders = picked[0]?.propertyId ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  const suggestions = [...new Set(files.flatMap((file) => file.labels || []))]

  // Moving between folders keeps what is ticked.
  function go(next) {
    setAt(onlyProperty ? { ...next, propertyId: onlyProperty.id } : next)
    setQuery("")
    setError("")
  }

  function toggle(id) {
    setError("")
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))
  }

  // A group of files (a folder, a whole property, a Quick Access document): how many are ticked.
  function groupState(list) {
    const count = list.filter((file) => selectedSet.has(file.id)).length
    return { count, total: list.length, all: list.length > 0 && count === list.length, some: count > 0 && count < list.length }
  }

  // Ticking a group ticks all its files; ticking it again (when all are ticked) unticks them.
  function toggleGroup(list) {
    setError("")
    const ids = list.map((file) => file.id)
    const all = ids.length > 0 && ids.every((id) => selectedSet.has(id))
    setSelected((current) => (all ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]))
  }

  // "Contracts", "3318 Nolan St › Contracts" or "Operating Agreement": where ticked files sit, for the summary,
  // in the order the folders show (the company's first, then each property's).
  const selectedPlaces = useMemo(() => {
    const order = (file) => {
      const place = file.propertyId ? properties.findIndex((item) => item.id === file.propertyId) : -1
      const folder = (file.propertyId ? PROPERTY_FOLDERS : COMPANY_FOLDERS).findIndex((item) => item.id === file.folder)
      return (place + 1) * 100 + (folder < 0 ? 99 : folder)
    }
    const sorted = [...selectedFiles].sort((a, b) => order(a) - order(b))
    return [...new Set(sorted.map((file) => [!onlyProperty && file.propertyId ? file.property : "", folderLabel(file)].filter(Boolean).join(" › ")))]
  }, [selectedFiles, properties, onlyProperty])

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
    // Named after what is in it: the company, the property when all the files are from one, the folder when all are from one.
    const onePlace = new Set(list.map((file) => file.propertyId || "company")).size === 1
    const oneFolder = onePlace && new Set(list.map((file) => file.folder)).size === 1
    const placeName = onePlace && list[0].propertyId ? properties.find((item) => item.id === list[0].propertyId)?.address || list[0].property : ""
    startDownload(list, [companyName, placeName, oneFolder ? folderLabel(list[0]) : ""].filter(Boolean).join(" - ") || "Documents")
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
    // The moved files are done with; anything ticked elsewhere stays ticked.
    const moved = picked.map((file) => file.id)
    setSelected((list) => list.filter((id) => !moved.includes(id)))
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
  // Where you are: All folders › (property, on a company) › folder. On phones the parent levels sit small above the
  // current one, with a back button to go up a level.
  const trail = [
    { key: "root", label: "All folders", to: { propertyId: top, folder: "" }, icon: true },
    ...(property && !onlyProperty ? [{ key: "property", label: property.address, to: { propertyId: property.id, folder: "" } }] : []),
    ...(current ? [{ key: "folder", label: current.name }] : []),
  ]
  const here = trail[trail.length - 1]
  const parentCrumb = trail.length > 1 ? trail[trail.length - 2] : null
  const showTiles = !at.folder && !needle
  return (
    <div className={["folders", dragging ? "is-dragging" : "", selectedFiles.length ? "is-picking" : ""].filter(Boolean).join(" ")} {...dropProps}>
      <div className="folders-bar">
        <nav className="folders-crumbs" aria-label="Breadcrumb">
          {parentCrumb && (
            <button type="button" className="crumbs-back" onClick={() => go(parentCrumb.to)} aria-label={`Back to ${parentCrumb.label}`} title={`Back to ${parentCrumb.label}`}>
              <Icon name="back" size={16} />
            </button>
          )}
          <ol className="crumbs-trail">
            {trail.map((crumb, index) => (
              <li key={crumb.key} className={crumb === here ? "is-current" : undefined}>
                {index > 0 && <span className="crumbs-sep" aria-hidden="true"><Icon name="chevron" size={12} /></span>}
                {crumb === here ? (
                  <span className="crumbs-here" aria-current="page" title={crumb.label}>
                    {crumb.icon && <Icon name="folder" size={15} />}
                    <span className="crumbs-text">{crumb.label}</span>
                  </span>
                ) : (
                  <button type="button" className="crumbs-link" onClick={() => go(crumb.to)} title={crumb.label}>
                    {crumb.icon && <Icon name="folder" size={15} />}
                    <span className="crumbs-text">{crumb.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <label className="folders-search">
          <Icon name="search" size={14} />
          <span className="sr-only">Search files</span>
          <input type="search" value={query} placeholder={whereNow ? `Search ${whereNow}` : "Search all folders"} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button
          type="button"
          className="tool folders-zip"
          disabled={!selectedFiles.length}
          onClick={() => download(selectedFiles)}
          title={selectedFiles.length ? `Download the ${selectedFiles.length === 1 ? "ticked file" : `${selectedFiles.length} ticked files as one zip`}` : "Tick files or folders to download them together"}
        >
          <Icon name="download" size={14} /> {selectedFiles.length === 1 ? "Download" : "Download zip"}
          {selectedFiles.length > 0 && <span className="zip-count">{selectedFiles.length}</span>}
        </button>
        {writable && (
          <button type="button" className="primary folders-upload" onClick={() => openUpload()}>
            <Icon name="upload" size={14} /> {at.folder ? "Upload here" : "Upload"}
          </button>
        )}
      </div>

      {error && <p className="banner">{error}</p>}

      {selectedFiles.length > 0 && (
        <div className="folders-basket" role="status">
          <span>
            <strong>{selectedFiles.length} {selectedFiles.length === 1 ? "file" : "files"} selected</strong>
            {" "}
            {selectedPlaces.length <= 3 ? `in ${selectedPlaces.join(", ")}` : `in ${selectedPlaces.length} folders`}
          </span>
          <button type="button" className="tool" onClick={() => setSelected([])}>Clear selection</button>
        </div>
      )}

      {showTiles && (
        <>
          {property && !onlyProperty && <p className="folders-note">Documents for {property.address}.</p>}
          <ul className="folder-grid">
            {folders.map((item) => {
              const list = box?.get(item.id) || []
              return (
                <li key={item.id}>
                  <FolderTile name={item.name} meta={list.length || !item.required ? folderSummary(list) : ""} filled={list.length > 0} status={item.required ? (list.length ? "ok" : "missing") : ""} icon={item.required ? "file" : "folder"} pick={groupState(list)} onPick={() => toggleGroup(list)} onOpen={() => go({ propertyId: at.propertyId, folder: item.id })} />
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
              pickState={(list) => groupState(list)}
              onPick={(list) => toggleGroup(list)}
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
                        <FolderTile name={item.address} meta={folderSummary(list)} filled={list.length > 0} building pick={groupState(list)} onPick={() => toggleGroup(list)} onOpen={() => go({ propertyId: item.id, folder: "" })} />
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
                <input type="checkbox" checked={allPicked} ref={(element) => { if (element) element.indeterminate = picked.length > 0 && !allPicked }} onChange={() => toggleGroup(listed)} />
                <span>{picked.length ? `${picked.length} of ${listed.length} selected${at.folder ? " here" : ""}` : `Select all ${listed.length}`}</span>
              </label>
              <span className="folders-select-hint">{selectedFiles.length > picked.length ? `${selectedFiles.length - picked.length} more ticked in other folders` : "Tick files here and in other folders, then Download zip"}</span>
              {movable && (
                <label className="folders-move">
                  <span className="sr-only">Move to folder</span>
                  <select value="" disabled={Boolean(busy)} onChange={(event) => moveTo(event.target.value)}>
                    <option value="">{busy || "Move to…"}</option>
                    {moveFolders.filter((item) => !(at.folder && item.id === at.folder)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
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
                checked={selectedSet.has(file.id)}
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
function QuickAccess({ files, writable, viewHref, onOpenFolder, onUpload, pickState, onPick }) {
  return (
    <section className="quick-access" aria-label="Quick Access Documents">
      <h3 className="folders-heading">Quick Access Documents</h3>
      <ul className="quick-list">
        {QUICK_ACCESS.map((item) => {
          const list = quickAccessFiles(files, item).sort(newestFirst)
          const latest = list[0]
          const folder = PROPERTY_FOLDERS.find((entry) => entry.id === item.folder)
          const pick = pickState(list)
          return (
            <li key={item.id} className={[latest ? "" : "is-empty", pick.count ? "is-picked" : ""].filter(Boolean).join(" ")}>
              <span className="quick-lead">
                <span className={latest ? "quick-icon" : "quick-icon is-empty"} aria-hidden="true"><Icon name="file" size={18} /></span>
                {latest && <PickBox label={item.name} pick={pick} onPick={() => onPick(list)} />}
              </span>
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

// A tick box that can be fully or partly ticked (some of a folder's files ticked).
function PickBox({ label, pick, onPick }) {
  return (
    <label className="pick-box" title={pick.all ? `Untick ${label}` : `Tick ${label}`}>
      <input type="checkbox" checked={pick.all} ref={(element) => { if (element) element.indeterminate = pick.some }} onChange={onPick} aria-label={`Select ${label}`} />
    </label>
  )
}

// A required company document shows Missing until a file is in its folder, then On file.
// The four required company documents show a document icon; ordinary folders a folder.
function FolderTile({ name, meta, filled, status = "", building = false, icon = "folder", pick = null, onPick, onOpen }) {
  const count = pick?.count || 0
  return (
    // Hovering shows a tick box over the icon: tick folders (or files inside them), then Download zip.
    <div className={["folder-cell", count ? "is-picked" : "", onPick && pick?.total > 0 ? "has-pick" : ""].filter(Boolean).join(" ")}>
    <button type="button" className={status === "missing" ? "folder-tile is-missing" : "folder-tile"} onClick={onOpen} title={name}>
      <span className={`folder-icon${filled ? "" : " is-empty"}${building ? " is-property" : ""}`}><Icon name={building ? "building" : icon} size={22} /></span>
      <span className="folder-copy">
        <strong>{name}</strong>
        <span className="folder-meta">
          {status && <DocStatus missing={status === "missing"} />}
          {meta && <em>{meta}</em>}
          {count > 0 && <span className="folder-picked">{pick.all ? `All ${count} selected` : `${count} of ${pick.total} selected`}</span>}
        </span>
      </span>
      <Icon name="chevron" size={14} />
    </button>
    {onPick && pick?.total > 0 && <PickBox label={name} pick={pick} onPick={onPick} />}
    </div>
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
