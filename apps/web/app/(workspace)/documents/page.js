"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { can } from "@synergifund/shared"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { when } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

function fileType(file) {
  const name = (file.name || "").toLowerCase()
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "Excel"
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "Word"
  if (name.endsWith(".pdf")) return "PDF"
  if (file.mime?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name)) return "Photo"
  if (file.kind === "receipt") return "Receipt"
  return "File"
}

export default function DocumentsPage() {
  const router = useRouter()
  const session = useSession()
  const list = useApi("/documents")
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [mode, setMode] = useState("library")
  const [importId, setImportId] = useState("")
  const [previewCount, setPreviewCount] = useState(0)
  const writable = session?.user && can(session.user, "documents.write")
  const canImport = session?.user && can(session.user, "imports.run")
  const files = list.data?.items || []

  function closeUpload() {
    setOpen(false)
    setError("")
    setImportId("")
    setPreviewCount(0)
    setMode("library")
  }

  async function upload(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    form.set("mode", mode)
    setError("")
    try {
      if (mode === "import") {
        const result = await api("/documents/import", { method: "POST", body: form })
        setImportId(result.import.id)
        setPreviewCount(result.import.count || 0)
      } else {
        await api("/documents", { method: "POST", body: form })
        closeUpload()
      }
      list.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function confirmImport() {
    setError("")
    try {
      await api(`/documents/import/${importId}/confirm`, { method: "POST", body: {} })
      closeUpload()
      list.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <WorkspacePage
        views={false}
        title="Documents"
        action={writable ? { label: "Upload", onClick: () => setOpen(true) } : null}
        stats={[
          { key: "files", label: "Files", value: String(files.length), hint: "In the library" },
          { key: "excel", label: "Excel", value: String(files.filter((file) => fileType(file) === "Excel").length), hint: "Workbooks" },
          { key: "word", label: "Word", value: String(files.filter((file) => fileType(file) === "Word").length), hint: "Documents" },
          { key: "photos", label: "Photos", value: String(files.filter((file) => fileType(file) === "Photo").length), hint: "Images and receipts" },
        ]}
        columns={[
          {
            key: "name",
            label: "Name",
            avatar: (row) => row.name,
            render: (row) => (
              <span className="person-copy">
                <strong>{row.name}</strong>
                <small>{when(row.createdAt)}</small>
              </span>
            ),
          },
          { key: "type", label: "Type", render: (row) => <StatusPill>{fileType(row)}</StatusPill> },
          { key: "size", label: "Size", render: (row) => `${Math.max(1, Math.ceil((row.size || 0) / 1024))} KB` },
          {
            key: "actions",
            label: "",
            pin: "right",
            render: (row) => (
              <span className="row-actions">
                <button type="button" onClick={(event) => { event.stopPropagation(); router.push(`/documents/${row.id}`) }}>Open</button>
                <a href={`/api/documents/${row.id}/download`}>Download</a>
              </span>
            ),
          },
        ]}
        rows={files}
        onRow={(row) => router.push(`/documents/${row.id}`)}
        empty={list.loading ? "Loading documents…" : "Upload a Word file, Excel workbook, photo, or PDF."}
      />
      {open && (
        <div className="sheet-backdrop" onMouseDown={closeUpload}>
          <form className="member-sheet" onSubmit={upload} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p>Documents</p>
                <h2>Upload a file</h2>
                <span>It opens inside the app. You can also download the original.</span>
              </div>
              <button type="button" className="icon-btn" onClick={closeUpload} aria-label="Close">×</button>
            </header>
            <div className="member-sheet-body">
              {error && <div className="banner">{error}</div>}
              <label className="field"><span>File</span><input name="file" type="file" required={!importId} /></label>
              {canImport && (
                <div className="role-block">
                  <span>What should happen</span>
                  <div className="role-pills">
                    <button type="button" className={mode === "library" ? "role-pill is-on" : "role-pill"} onClick={() => { setMode("library"); setImportId("") }}>Keep in the library</button>
                    <button type="button" className={mode === "import" ? "role-pill is-on" : "role-pill"} onClick={() => setMode("import")}>Import properties from Excel</button>
                  </div>
                </div>
              )}
              {importId && <p className="muted">{previewCount} rows found. Blank cells stay blank. Nothing is overwritten.</p>}
            </div>
            <footer>
              <button type="button" className="tool" onClick={closeUpload}>Cancel</button>
              {importId
                ? <button className="primary" type="button" onClick={confirmImport}>Confirm import</button>
                : <button className="primary" type="submit">Upload</button>}
            </footer>
          </form>
        </div>
      )}
    </>
  )
}
