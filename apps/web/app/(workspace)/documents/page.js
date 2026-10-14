"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { can } from "@synergifund/shared"
import { DocumentLibrary, fileType } from "../../../components/documents/DocumentLibrary"
import { PageSpinner } from "../../../components/ui/Spinner"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useApi } from "../../../lib/useApi"

export default function DocumentsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <DocumentsScreen />
    </Suspense>
  )
}

function DocumentsScreen() {
  const params = useSearchParams()
  const session = useSession()
  const list = useApi("/documents")
  const properties = useApi("/properties")
  const staff = Boolean(session?.user) && session.user.role !== "contractor"
  const companies = useApi(staff ? "/companies" : null)
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const [importId, setImportId] = useState("")
  const [previewCount, setPreviewCount] = useState(0)
  const writable = session?.user && can(session.user, "documents.write")
  const canDelete = session?.user && can(session.user, "documents.delete")
  const canImport = session?.user && can(session.user, "imports.run")
  const files = list.data?.items || []
  const linked = files.filter((file) => file.propertyId)
  const companyFiles = files.filter((file) => file.companyId)

  function closeUpload() {
    setOpen(false)
    setError("")
    setImportId("")
    setPreviewCount(0)
  }

  async function upload(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    form.set("mode", "import")
    setError("")
    try {
      const result = await api("/documents/import", { method: "POST", body: form })
      setImportId(result.import.id)
      setPreviewCount(result.import.count || 0)
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
        loading={!list.data && !list.error}
        title="Documents"
        secondary={canImport ? { label: "Import properties", onClick: () => setOpen(true) } : null}
        action={writable ? { label: "Upload", onClick: () => setUploading(true) } : null}
        stats={[
          { key: "files", label: "Files", value: String(files.length), hint: "In the library" },
          { key: "properties", label: "Properties with files", value: String(new Set(linked.map((file) => file.propertyId)).size), hint: `${linked.length} files linked to a property${companyFiles.length ? ` · ${companyFiles.length} filed under a company` : ""}` },
          { key: "labeled", label: "Labeled", value: String(files.filter((file) => (file.labels || []).length).length), hint: "Files with at least one label" },
          { key: "photos", label: "Photos", value: String(files.filter((file) => fileType(file) === "Photo").length), hint: "Site photos and images" },
        ]}
      >
        <section className="panel doc-panel">
          {list.error ? <p className="banner">{list.error}</p> : !list.data ? <PageSpinner /> : (
            <DocumentLibrary
              files={files}
              properties={(properties.data?.items || []).map((property) => ({ id: property.id, address: property.address }))}
              companies={(companies.data?.items || []).map((company) => ({ id: company.id, name: company.name }))}
              initialProperty={params.get("company") ? `company:${params.get("company")}` : params.get("property") || "all"}
              writable={Boolean(writable)}
              canDelete={Boolean(canDelete)}
              requireProperty={session?.user?.role === "contractor"}
              canEdit={(file) => session?.user?.role !== "contractor" || file.uploadedById === session?.user?.id}
              onChanged={list.reload}
              uploadOpen={uploading}
              onUploadOpenChange={setUploading}
              toolbarUpload={false}
              emptyText="Upload a contract, a closing statement, an insurance policy, photos or any other file."
            />
          )}
        </section>
      </WorkspacePage>
      {open && (
        <div className="sheet-backdrop" onMouseDown={closeUpload}>
          <form className="member-sheet" onSubmit={upload} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p>Documents</p>
                <h2>Import properties</h2>
                <span>Rows become properties and loans. Blank cells stay blank and nothing is overwritten.</span>
              </div>
              <button type="button" className="icon-btn" onClick={closeUpload} aria-label="Close">×</button>
            </header>
            <div className="member-sheet-body">
              {error && <div className="banner">{error}</div>}
              <label className="field"><span>Workbook</span><input name="file" type="file" accept=".xlsx,.xls" required={!importId} /></label>
              {importId && <p className="muted">{previewCount} rows found. Blank cells stay blank. Nothing is overwritten.</p>}
            </div>
            <footer>
              <button type="button" className="tool" onClick={closeUpload}>Cancel</button>
              {importId
                ? <button className="primary" type="button" onClick={confirmImport}>Confirm import</button>
                : <button className="primary" type="submit">Read workbook</button>}
            </footer>
          </form>
        </div>
      )}
    </>
  )
}
