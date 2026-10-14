"use client"

import Link from "next/link"
import { FolderBrowser } from "../documents/FolderBrowser"
import { useApi } from "../../lib/useApi"

// One property's documents in its folders. They are the same files its company shows under Documents › Properties.
export function DocumentsSection({ property, company, writable, canDelete, initialFolder = "" }) {
  const list = useApi(`/documents?propertyId=${property.id}`)
  const files = list.data?.items || []
  return (
    <section className="panel property-card doc-panel">
      <div className="property-card-head">
        <div>
          <h2>Documents</h2>
          <p className="property-missing">
            Everything filed under {property.address}, in folders. Open a folder to view, download or upload. Tick files to download several at once.
            {company ? <> The same files are in <Link href={`/companies/${company.id}?tab=documents&property=${property.id}`} className="property-company">{company.name}</Link> › Documents.</> : null}
          </p>
        </div>
        <Link href={`/documents?property=${property.id}`} className="tool">Open in Documents</Link>
      </div>
      {list.error ? (
        <p className="banner">{list.error}</p>
      ) : !list.data ? (
        <p className="property-missing">Loading files…</p>
      ) : (
        <FolderBrowser
          onlyProperty={{ id: property.id, address: property.address }}
          files={files}
          writable={writable}
          canDelete={canDelete}
          onChanged={list.reload}
          initialFolder={initialFolder}
        />
      )}
    </section>
  )
}
