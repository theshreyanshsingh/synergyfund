"use client"

import Link from "next/link"
import { DocumentLibrary } from "../documents/DocumentLibrary"
import { useApi } from "../../lib/useApi"

// Every file filed under one property: documents, receipts and site photos.
export function DocumentsSection({ property, writable, canDelete }) {
  const list = useApi(`/documents?propertyId=${property.id}`)
  const files = list.data?.items || []
  return (
    <section className="panel property-card doc-panel">
      <div className="property-card-head">
        <div>
          <h2>Documents</h2>
          <p className="property-missing">Everything filed under {property.address}. Labels are optional and help people find files later.</p>
        </div>
        <Link href={`/documents?property=${property.id}`} className="tool">Open in Documents</Link>
      </div>
      {list.error ? (
        <p className="banner">{list.error}</p>
      ) : !list.data ? (
        <p className="property-missing">Loading files…</p>
      ) : (
        <DocumentLibrary
          files={files}
          fixedPropertyId={property.id}
          properties={[{ id: property.id, address: property.address }]}
          writable={writable}
          canDelete={canDelete}
          onChanged={list.reload}
          emptyText="No files on this property yet."
        />
      )}
    </section>
  )
}
