"use client"

import { use, useState } from "react"
import { DetailFrame } from "../../../../components/ui/DetailFrame"
import { PageSpinner } from "../../../../components/ui/Spinner"
import { when } from "../../../../lib/format"
import { useApi } from "../../../../lib/useApi"

function labelFor(data) {
  if (data.kind === "sheet") return "Excel"
  if (data.kind === "document") return "Word"
  if (data.kind === "image") return "Photo"
  return "File"
}

export default function DocumentViewerPage({ params }) {
  const { id } = use(params)
  const preview = useApi(`/documents/${id}/preview`)
  const [sheet, setSheet] = useState(0)
  const data = preview.data
  if (!data) return preview.error ? <div className="boot"><p className="banner">{preview.error}</p></div> : <PageSpinner />
  const current = data.sheets?.[sheet] || data.sheets?.[0]
  const header = current?.rows?.[0] || []
  const body = current?.rows?.slice(1) || []

  return (
    <DetailFrame
      backHref="/documents"
      backLabel="Documents"
      title={data.file.name}
      meta={`${labelFor(data)} · ${Math.max(1, Math.ceil((data.file.size || 0) / 1024))} KB · Added ${when(data.file.createdAt)}`}
      actions={<a className="primary" href={`/api/documents/${id}/download`}>Download</a>}
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
        {data.kind === "file" && (
          <div className="reader-empty">
            <h2>No preview for this file</h2>
            <p className="muted">Word, Excel, and photos open here. Download this file to view it.</p>
          </div>
        )}
      </section>
    </DetailFrame>
  )
}
