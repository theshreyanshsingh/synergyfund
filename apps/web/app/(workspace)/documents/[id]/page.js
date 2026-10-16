"use client"

import { use, useState } from "react"
import { useSearchParams } from "next/navigation"
import { DetailFrame } from "../../../../components/ui/DetailFrame"
import { PageSpinner } from "../../../../components/ui/Spinner"
import { folderName } from "@synergifund/shared"
import { when } from "../../../../lib/format"
import { useApi } from "../../../../lib/useApi"

function labelFor(data) {
  if (data.kind === "sheet") return "Excel"
  if (data.kind === "document") return "Word"
  if (data.kind === "image") return "Photo"
  if (data.kind === "pdf") return "PDF"
  if (data.kind === "video") return "Video"
  return "File"
}

function sizeText(bytes) {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Back to the folder the file sits in: on the company when it was opened from the company's Documents,
// otherwise on its property or company.
function backTo(file, fromCompany) {
  if (file.propertyId && file.propertyCompanyId && fromCompany) return { href: `/companies/${file.propertyCompanyId}?tab=documents&property=${file.propertyId}${file.folder ? `&folder=${file.folder}` : ""}`, label: [file.property || "Property", folderName("property", file.folder)].filter(Boolean).join(" · ") }
  if (file.propertyId) return { href: `/properties/${file.propertyId}?tab=documents${file.folder ? `&folder=${file.folder}` : ""}`, label: [file.property || "Property", folderName("property", file.folder)].filter(Boolean).join(" · ") }
  if (file.companyId) return { href: `/companies/${file.companyId}?tab=documents${file.folder ? `&folder=${file.folder}` : ""}`, label: [file.company || "Company", folderName("company", file.folder)].filter(Boolean).join(" · ") }
  return { href: "/documents", label: "Documents" }
}

export default function DocumentViewerPage({ params }) {
  const { id } = use(params)
  const search = useSearchParams()
  const preview = useApi(`/documents/${id}/preview`)
  const [sheet, setSheet] = useState(0)
  const data = preview.data
  if (!data) return preview.error ? <div className="boot"><p className="banner">{preview.error}</p></div> : <PageSpinner />
  const current = data.sheets?.[sheet] || data.sheets?.[0]
  const header = current?.rows?.[0] || []
  const body = current?.rows?.slice(1) || []

  const back = backTo(data.file, search.get("in") === "company")
  return (
    <DetailFrame
      backHref={back.href}
      backLabel={back.label}
      title={<span className="keep-case">{data.file.name}</span>}
      meta={[labelFor(data), sizeText(data.file.size), `Added ${when(data.file.createdAt)}`, data.file.uploadedBy].filter(Boolean).join(" · ")}
      actions={[
        data.kind === "pdf" && <a key="open" className="import-button" href={data.url} target="_blank" rel="noopener">Open full screen</a>,
        <a key="download" className="primary" href={`/api/documents/${id}/download`}>Download</a>,
      ].filter(Boolean)}
    >
      <section className="reader">
        {data.kind === "sheet" && (
          <>
            <div className="reader-tabs">
              {data.sheets.map((item, index) => (
                <button key={item.name} type="button" className={index === sheet ? "reader-tab is-on" : "reader-tab"} onClick={() => setSheet(index)}>{item.name}</button>
              ))}
            </div>
            <div className="sheet-scroll">
              <table className="sheet">
                <thead>
                  <tr>{header.map((cell, index) => <th key={index}>{cell || " "}</th>)}</tr>
                </thead>
                <tbody>
                  {body.map((row, index) => (
                    <tr key={index}>{header.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] || ""}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {body.length === 0 && <p className="muted">This sheet has no rows under the header.</p>}
            </div>
          </>
        )}
        {data.kind === "document" && <div className="reader-doc doc-html" dangerouslySetInnerHTML={{ __html: data.html }} />}
        {data.kind === "image" && (
          <div className="reader-photo">
            <img src={data.url} alt={data.file.name} />
          </div>
        )}
        {data.kind === "pdf" && (
          <div className="reader-pdf">
            <iframe src={data.url} title={data.file.name} />
          </div>
        )}
        {data.kind === "video" && (
          <div className="reader-video">
            <video src={data.url} controls playsInline preload="metadata" />
          </div>
        )}
        {data.kind === "file" && (
          <div className="reader-empty">
            <h2>No preview for this file</h2>
            <p className="muted">PDF, Word (.docx), Excel, photos and videos open here. Download this file to view it.</p>
          </div>
        )}
      </section>
    </DetailFrame>
  )
}
