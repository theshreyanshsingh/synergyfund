"use client"

import Link from "next/link"
import { FolderBrowser } from "../documents/FolderBrowser"
import { useApi } from "../../lib/useApi"

// One property's documents in its folders. They are the same files its company shows under Documents › Properties.
// The page keeps which folder is open (`folder`, `onFolder`), so its Back steps out of the folder.
export function DocumentsSection({ property, writable, canDelete, folder, onFolder }) {
  const list = useApi(`/documents?propertyId=${property.id}`)
  const files = list.data?.items || []
  return (
    <section className="panel property-card doc-panel">
      <div className="doc-head">
        <h2>Documents</h2>
        <Link href={`/documents?property=${property.id}`} className="doc-head-link">Open in Documents</Link>
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
          folder={folder}
          onFolder={onFolder}
        />
      )}
    </section>
  )
}
