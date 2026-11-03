"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { COMPANY_FOLDERS, PROPERTY_FOLDERS, QUICK_ACCESS, quickAccessFiles } from "@synergifund/shared"
import { api } from "../../lib/api"
import { Icon } from "../ui/Icon"
import { RowMenu } from "../ui/RowMenu"
import { RenameSheet, UploadSheet, attached, dateLabel, fileType, isImage, sizeLabel } from "./DocumentLibrary"

const ZIP_MAX_FILES = 150
const ZIP_MAX_BYTES = 1500 * 1024 * 1024
// Which sections are open (Quick access documents, All folders), remembered on this device.
const OPEN_KEY = "synergifund-documents-open"

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

// Two added in the same instant: the higher id is the newer (the API decides a Quick access document's file the same way).
function newestFirst(a, b) {
  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || (String(b.id) > String(a.id) ? 1 : String(b.id) < String(a.id) ? -1 : 0)
}

function foldersOf(file) {
  return file.propertyId ? PROPERTY_FOLDERS : COMPANY_FOLDERS
}

function folderLabel(file) {
  return foldersOf(file).find((item) => item.id === file.folder)?.name || "Miscellaneous"
}

// Starts a download without leaving the page: one file as it is, or a zip (always with `zip`, Create zip's result).
// (In the installed iPhone app, DownloadTray catches the click and uses the share sheet instead.)
function startDownload(files, name, { zip = false } = {}) {
  const single = files.length === 1 && !zip
  const link = document.createElement("a")
  link.href = single
    ? `/api/documents/${files[0].id}/download`
    : `/api/documents/zip?ids=${files.map((file) => file.id).join(",")}&name=${encodeURIComponent(name)}`
  link.rel = "noopener"
  link.dataset.name = single ? files[0].name : `${name}.zip`
  link.dataset.size = String(files.reduce((total, file) => total + (file.size || 0), 0))
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// A company's Documents as folders: its own folders, then one folder per property it owns, each with the property folders.
// With `onlyProperty`, the same folders for one property on its own page (the same files the company shows).
// A property opens on its Quick access documents and its folders. Click a file to open it; everything else is in its ⋯ menu.
// Create zip turns on tick boxes: tick files and folders (ticks stay while you move between folders), then Download zip.
// With `onFolder` (a property's page, with `onlyProperty`), the page keeps which folder is open: `folder`, and
// `onFolder(id)` to open one ("" for all folders), so the page's Back and the browser's step out of it.
export function FolderBrowser({ companyId = "", companyName = "", properties: owned = [], onlyProperty = null, files, writable, canDelete, canEdit = () => true, onChanged, initialProperty = "", initialFolder = "", folder: openFolder = "", onFolder = null }) {
  const properties = onlyProperty ? [onlyProperty] : owned
  const top = onlyProperty ? onlyProperty.id : ""
  const startProperty = onlyProperty ? onlyProperty.id : properties.some((item) => item.id === initialProperty) ? initialProperty : ""
  const startFolders = startProperty ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  const [place, setPlace] = useState({ propertyId: startProperty, folder: startFolders.some((item) => item.id === initialFolder) ? initialFolder : "" })
  const at = onFolder ? { propertyId: top, folder: PROPERTY_FOLDERS.some((item) => item.id === openFolder) ? openFolder : "" } : place
  const [query, setQuery] = useState("")
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState([])
  const [uploading, setUploading] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState("")
  const [open, setOpen] = useState({ quick: true, folders: true })

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || "null")
      if (saved && typeof saved === "object") setOpen({ quick: saved.quick !== false, folders: saved.folders !== false })
    } catch {}
  }, [])

  function toggleSection(key) {
    const next = { ...open, [key]: !open[key] }
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next))
    } catch {}
  }

  const property = properties.find((item) => item.id === at.propertyId) || null
  const folders = property ? PROPERTY_FOLDERS : COMPANY_FOLDERS
  const current = folders.find((item) => item.id === at.folder) || null
  const herePlace = property ? property.id : `company:${companyId}`

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
  const showTiles = !at.folder && !needle
  const listed = useMemo(() => {
    let pool = []
    if (at.folder) pool = box?.get(at.folder) || []
    else if (needle) pool = property ? [...box.values()].flat() : [...tree.company.values(), ...[...tree.owned.values()].flatMap((folderMap) => [...folderMap.values()])].flat()
    pool = [...pool].sort(newestFirst)
    if (!needle) return pool
    return pool.filter((file) => [file.name, ...(file.labels || []), fileType(file), file.uploadedBy, folderLabel(file), file.property].join(" ").toLowerCase().includes(needle))
  }, [at.folder, needle, box, property, tree])

  // Everything where you are: the folder you are in, otherwise everything at this level.
  const levelFiles = useMemo(() => {
    if (at.folder) return box?.get(at.folder) || []
    if (property) return [...(box?.values() || [])].flat()
    return [...tree.company.values(), ...[...tree.owned.values()].flatMap((folderMap) => [...folderMap.values()])].flat()
  }, [at.folder, property, box, tree])
  // What "Select all" covers: the search results while searching, otherwise everything where you are.
  const hereFiles = needle ? listed : levelFiles

  const selectedSet = useMemo(() => new Set(selected), [selected])
  // Only files that still exist (a ticked file may have been deleted or moved away since).
  const selectedFiles = useMemo(() => files.filter((file) => selectedSet.has(file.id)), [files, selectedSet])
  const elsewhere = selectedFiles.length - levelFiles.filter((file) => selectedSet.has(file.id)).length
  const allHere = hereFiles.length > 0 && hereFiles.every((file) => selectedSet.has(file.id))

  // Moving between folders keeps what is ticked.
  function go(next) {
    if (onFolder) onFolder(next.folder)
    else setPlace(onlyProperty ? { ...next, propertyId: onlyProperty.id } : next)
  }

  // A new folder starts without a search, whether you opened it here or went back to it.
  useEffect(() => {
    setQuery("")
    setError("")
  }, [at.propertyId, at.folder])

  function toggle(id) {
    setError("")
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))
  }

  // A group of files (a folder, a whole property): how many are ticked.
  function groupState(list) {
    const count = list.filter((file) => selectedSet.has(file.id)).length
    return { count, total: list.length, all: list.length > 0 && count === list.length, some: count > 0 && count < list.length }
  }

  // Ticking a group ticks all its files; ticking it again (when all are ticked) unticks them.
  function toggleGroup(list) {
    setError("")
    const ids = list.map((file) => file.id)
    const all = ids.length > 0 && ids.every((id) => selectedSet.has(id))
    setSelected((list) => (all ? list.filter((id) => !ids.includes(id)) : [...new Set([...list, ...ids])]))
  }

  function startSelecting() {
    setError("")
    setSelecting(true)
  }

  function stopSelecting() {
    setError("")
    setSelecting(false)
    setSelected([])
  }

  function downloadZip() {
    setError("")
    const list = selectedFiles
    if (!list.length) return
    if (list.length > ZIP_MAX_FILES) {
      setError(`Zip up to ${ZIP_MAX_FILES} files at a time. Untick some files.`)
      return
    }
    if (list.reduce((total, file) => total + (file.size || 0), 0) > ZIP_MAX_BYTES) {
      setError("That is too much for one zip. Untick some files.")
      return
    }
    // Named after what is in it: the company, the property when all the files are from one, the folder when all are from one.
    const onePlace = new Set(list.map((file) => file.propertyId || "company")).size === 1
    const oneFolder = onePlace && new Set(list.map((file) => file.folder)).size === 1
    const placeName = onePlace && list[0].propertyId ? properties.find((item) => item.id === list[0].propertyId)?.address || list[0].property : ""
    startDownload(list, [companyName, placeName, oneFolder ? folderLabel(list[0]) : ""].filter(Boolean).join(" - ") || "Documents", { zip: true })
  }

  async function moveTo(file, folder) {
    setError("")
    try {
      await api(`/documents/${file.id}`, { method: "PATCH", body: { folder } })
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  async function remove(file) {
    if (!window.confirm("Delete this file?")) return
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

  // A Quick access document: one file, into the document's main folder, labeled as that document. Uploading again
  // (Replace file) gives the slot the new file; the old one stays in its folder.
  function uploadSlot(item, old = null) {
    setError("")
    const folder = PROPERTY_FOLDERS.find((entry) => entry.id === item.folder)?.name || ""
    setUploading({
      place: property.id,
      folder: item.folder,
      files: [],
      where: onlyProperty ? "" : property.address,
      labels: [item.name],
      single: true,
      title: `${old ? "Replace" : "Upload"} ${item.name}`,
      hint: old ? `The new file takes this spot. ${old.name} stays in ${folderLabel(old)}.` : `One PDF, Word, Excel, image or video file. It goes in ${folder}.`,
    })
  }

  // The ⋯ menu: a Quick access document can be replaced, a file in a folder moved to another folder.
  function menuFor(file, slot = null) {
    const editable = writable && canEdit(file)
    return [
      { label: "Download", onClick: () => startDownload([file], file.name) },
      editable && { label: "Rename", onClick: () => setRenaming(file) },
      slot
        ? writable && { label: "Replace file", onClick: () => uploadSlot(slot, file) }
        : editable && { label: "Move to", items: foldersOf(file).filter((item) => item.id !== file.folder).map((item) => ({ label: item.name, onClick: () => moveTo(file, item.id) })) },
      canDelete && canEdit(file) && !attached(file) && { label: "Delete", danger: true, divider: true, onClick: () => remove(file) },
    ]
  }

  const dropProps = writable && !selecting ? {
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
  // Where you are: All folders › (property, on a company) › folder, shown once you are inside one. On phones the parent
  // levels sit small above the current one, with a back button to go up a level.
  const trail = [
    { key: "root", label: "All folders", to: { propertyId: top, folder: "" }, icon: true },
    ...(property && !onlyProperty ? [{ key: "property", label: property.address, to: { propertyId: property.id, folder: "" } }] : []),
    ...(current ? [{ key: "folder", label: current.name }] : []),
  ]
  const here = trail[trail.length - 1]
  const parentCrumb = trail.length > 1 ? trail[trail.length - 2] : null
  const viewHref = (file) => `/documents/${file.id}${onlyProperty ? "" : "?in=company"}`
  const selectAll = `${allHere ? "Deselect" : "Select"} all${needle ? " results" : at.folder ? " in this folder" : ""}`
  return (
    <div className={["folders", dragging ? "is-dragging" : "", selecting ? "is-selecting" : ""].filter(Boolean).join(" ")} {...dropProps}>
      {selecting && (
        <div className="folders-selectbar" role="toolbar" aria-label="Create zip">
          <span className="folders-selectbar-count" role="status">
            <strong>{selectedFiles.length} selected</strong>
            {elsewhere > 0 && <span>{elsewhere} in other folders</span>}
          </span>
          {hereFiles.length > 0 && <button type="button" className="folders-selectbar-all" onClick={() => toggleGroup(hereFiles)}>{selectAll}</button>}
          <button type="button" onClick={stopSelecting}>Cancel</button>
          <button type="button" className="is-main" disabled={!selectedFiles.length} onClick={downloadZip}>
            <Icon name="download" size={14} /> Download zip
          </button>
        </div>
      )}

      <div className="folders-bar">
        {trail.length === 1 ? <span className="folders-spacer" /> : (
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
        )}
        <label className="folders-search">
          <Icon name="search" size={14} />
          <span className="sr-only">Search files</span>
          <input type="search" value={query} placeholder={whereNow ? `Search ${whereNow}` : "Search all folders"} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {!selecting && (
          <>
            <button type="button" className="tool folders-zip" disabled={!files.length} onClick={startSelecting} title={files.length ? "Tick files and folders to download as one zip" : "No files yet"}>
              <Icon name="download" size={14} /> Create zip
            </button>
            {writable && (
              <button type="button" className="primary folders-upload" onClick={() => openUpload()}>
                <Icon name="upload" size={14} /> Upload
              </button>
            )}
          </>
        )}
      </div>

      {error && <p className="banner">{error}</p>}

      {showTiles && (
        <>
          {property && (
            <QuickAccess
              files={[...(box?.values() || [])].flat()}
              open={open.quick}
              onToggle={() => toggleSection("quick")}
              selecting={selecting}
              selectedSet={selectedSet}
              onPick={toggle}
              writable={writable}
              viewHref={viewHref}
              menuFor={menuFor}
              onUpload={(item) => uploadSlot(item)}
            />
          )}
          <section className="folders-section">
            <SectionHead title="All folders" open={open.folders} onToggle={() => toggleSection("folders")} />
            {open.folders && (
              <ul className="folder-grid">
                {folders.map((item) => {
                  const list = box?.get(item.id) || []
                  return (
                    <li key={item.id}>
                      <FolderTile name={item.name} count={list.length} missing={item.required && !list.length} icon={item.required ? "file" : "folder"} selecting={selecting} pick={groupState(list)} onPick={() => toggleGroup(list)} onOpen={() => go({ propertyId: at.propertyId, folder: item.id })} />
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          {!property && (
            <section className="folders-section">
              <h3 className="folders-heading">Properties <em>{properties.length ? `· ${properties.length}` : ""}</em></h3>
              {properties.length === 0 ? (
                <p className="folders-note">Properties assigned to {companyName} show here, each with its own folders: {PROPERTY_FOLDERS.map((item) => item.name).join(", ")}.</p>
              ) : (
                <ul className="folder-grid">
                  {properties.map((item) => {
                    const list = [...(tree.owned.get(item.id)?.values() || [])].flat()
                    return (
                      <li key={item.id}>
                        <FolderTile name={item.address} count={list.length} building selecting={selecting} pick={groupState(list)} onPick={() => toggleGroup(list)} onOpen={() => go({ propertyId: item.id, folder: "" })} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {!showTiles && (
        <>
          {listed.length === 0 && (
            <div className="doc-empty">
              <strong>{needle ? `No files match “${query.trim()}”.` : `Nothing in ${current?.name} yet.`}</strong>
              {needle ? (
                <button type="button" className="tool" onClick={() => setQuery("")}>Clear search</button>
              ) : writable && !selecting ? (
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
                href={viewHref(file)}
                selecting={selecting}
                checked={selectedSet.has(file.id)}
                onToggle={() => toggle(file.id)}
                menu={menuFor(file)}
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
          labels={uploading.labels || []}
          single={Boolean(uploading.single)}
          title={uploading.title || ""}
          hint={uploading.hint || ""}
          placeName={uploading.where}
          onUploaded={() => onChanged?.()}
          onClose={() => setUploading(null)}
          onDone={() => { setUploading(null); onChanged?.() }}
        />
      )}
      {renaming && (
        <RenameSheet
          file={renaming}
          onClose={() => setRenaming(null)}
          onDone={() => { setRenaming(null); onChanged?.() }}
        />
      )}
    </div>
  )
}

// A section title that folds its section away (remembered on this device).
function SectionHead({ title, note = "", open, onToggle }) {
  return (
    <h3 className="folders-heading">
      <button type="button" className={open ? "folders-toggle" : "folders-toggle is-closed"} aria-expanded={open} onClick={onToggle}>
        <Icon name="chevron" size={14} />
        <span>{title}</span>
      </button>
      {note && <em>{note}</em>}
    </h3>
  )
}

// The five key documents of a property, one file each, marked with a star. A filled one opens its file; an empty one
// says so, with Upload.
function QuickAccess({ files, open, onToggle, selecting, selectedSet, onPick, writable, viewHref, menuFor, onUpload }) {
  const slots = QUICK_ACCESS.map((item) => ({ item, file: quickAccessFiles(files, item).sort(newestFirst)[0] || null }))
  const filled = slots.filter((slot) => slot.file).length
  return (
    <section className="quick-access folders-section">
      <SectionHead title="Quick access documents" note={`${filled} of ${slots.length} uploaded`} open={open} onToggle={onToggle} />
      {open && (
        <ul className="quick-list">
          {slots.map(({ item, file }) => {
            if (!file) {
              return (
                <li key={item.id} className="quick-slot is-empty">
                  <span className="quick-row">
                    {selecting && <span className="row-check-space" aria-hidden="true" />}
                    <span className="quick-star is-empty" aria-hidden="true"><Icon name="star" size={24} /></span>
                    <span className="quick-copy">
                      <strong>{item.name}</strong>
                      <small>Nothing uploaded yet</small>
                    </span>
                  </span>
                  {writable && !selecting && (
                    <button type="button" className="primary quick-upload" onClick={() => onUpload(item)}>
                      <Icon name="upload" size={14} /> Upload
                    </button>
                  )}
                </li>
              )
            }
            const checked = selectedSet.has(file.id)
            const folder = folderLabel(file)
            const date = dateLabel(file.createdAt)
            const content = (
              <>
                <span className="quick-star" aria-hidden="true"><Icon name="star" size={24} /></span>
                <span className="quick-copy">
                  <strong>{item.name}</strong>
                  <small>{file.name}<span className="quick-sub"> · {folder} · {date}</span></small>
                </span>
                <span className="quick-folder">{folder}</span>
                <span className="quick-date">{date}</span>
              </>
            )
            return (
              <li key={item.id} className={checked ? "quick-slot is-selected" : "quick-slot"}>
                {selecting ? (
                  <label className="quick-row">
                    <input type="checkbox" className="row-check" checked={checked} onChange={() => onPick(file.id)} aria-label={`Select ${item.name}`} />
                    {content}
                  </label>
                ) : (
                  <Link href={viewHref(file)} className="quick-row">{content}</Link>
                )}
                {!selecting && <RowMenu items={menuFor(file, item)} label={`More actions for ${item.name}`} className="keep-case" />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// A folder (or a property, on a company): its name and how many files. Empty ones are greyed. An empty required
// company folder shows Missing. While making a zip, its tick box ticks everything in it; the card still opens it.
// The tick box answers taps on the card's whole left edge, so a phone tap beside it does not open the folder.
function FolderTile({ name, count, missing = false, building = false, icon = "folder", selecting, pick, onPick, onOpen }) {
  return (
    <div className={["folder-cell", count ? "" : "is-empty", selecting && pick.count ? "is-picked" : ""].filter(Boolean).join(" ")}>
      {selecting && (
        <label className="folder-check">
          <input
            type="checkbox"
            className="row-check"
            checked={pick.all}
            ref={(element) => { if (element) element.indeterminate = pick.some }}
            disabled={!count}
            onChange={onPick}
            aria-label={`Select everything in ${name}`}
          />
        </label>
      )}
      <button type="button" className={missing ? "folder-tile is-missing" : "folder-tile"} onClick={onOpen} title={name}>
        <span className={`folder-icon${count ? "" : " is-empty"}${building ? " is-property" : ""}`}><Icon name={building ? "building" : icon} size={18} /></span>
        <span className="folder-copy">
          <strong>{name}</strong>
          <span className="folder-meta">
            {missing ? <DocStatus missing /> : <em>{count ? plural(count, "file", "files") : "Empty"}</em>}
            {selecting && pick.count > 0 && <span className="folder-picked">{pick.all ? "All selected" : `${pick.count} selected`}</span>}
          </span>
        </span>
      </button>
    </div>
  )
}

export function DocStatus({ missing, label, tone = "" }) {
  return <span className={`doc-status is-${tone || (missing ? "missing" : "ok")}`}>{label || (missing ? "Missing" : "On file")}</span>
}

// A file in a folder: click it to open it, the rest is in its ⋯ menu. In search results the grey line starts with
// where it is.
function FileRow({ file, where, href, selecting, checked, onToggle, menu }) {
  const kind = fileType(file)
  const thumb = isImage(file) ? file.url || `/api/documents/${file.id}/raw` : ""
  const content = (
    <>
      <span className={`doc-badge is-${kind.toLowerCase()}`} aria-hidden="true">
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : kind === "Excel" ? "XLS" : kind === "Word" ? "DOC" : kind === "Receipt" ? "RCT" : kind === "Video" ? "VID" : kind.toUpperCase().slice(0, 3)}
      </span>
      <span className="doc-copy">
        <strong>{file.name}</strong>
        <small>{[where, kind, sizeLabel(file.size), dateLabel(file.createdAt), file.uploadedBy].filter(Boolean).join(" · ")}</small>
      </span>
    </>
  )
  return (
    <li className={checked ? "folder-file is-selected" : "folder-file"}>
      {selecting ? (
        <label className="doc-open">
          <input type="checkbox" className="row-check" checked={checked} onChange={onToggle} aria-label={`Select ${file.name}`} />
          {content}
        </label>
      ) : (
        <Link href={href} className="doc-open">{content}</Link>
      )}
      {!selecting && <RowMenu items={menu} label={`More actions for ${file.name}`} className="keep-case" />}
    </li>
  )
}
