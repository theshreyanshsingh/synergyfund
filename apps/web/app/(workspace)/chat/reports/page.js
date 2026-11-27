"use client"

import Link from "next/link"
import { useState } from "react"
import { useSession } from "../../../../components/shell/Providers"
import { api } from "../../../../lib/api"
import { when } from "../../../../lib/format"
import { useApi } from "../../../../lib/useApi"
import { StatusPill } from "../../../../components/ui/StatusPill"

// Reported messages (admins): each report with the message as it read when reported. Remove deletes it for everyone,
// even in a direct message or private channel you aren't in; Keep closes the report. To take away someone's access,
// remove them in Members.
export default function ReportsPage() {
  const session = useSession()
  const list = useApi(session?.user?.role === "admin" ? "/chat/reports" : null)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  if (session?.user && session.user.role !== "admin") {
    return (
      <div className="workspace">
        <div className="workspace-top"><div className="page-heading"><h1 className="page-title">Reported messages</h1></div></div>
        <p className="banner">Only admins see reported messages.</p>
      </div>
    )
  }

  async function settle(report, action) {
    if (action === "remove" && !window.confirm(`Remove this message by ${report.authorName} for everyone?`)) return
    setBusy(`${report.id}:${action}`)
    setError("")
    try {
      await api(`/chat/reports/${report.id}/${action}`, { method: "POST" })
      await list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy("")
    }
  }

  const items = list.data?.items || []
  const open = items.filter((item) => item.status === "Open")
  const handled = items.filter((item) => item.status !== "Open")

  return (
    <div className="workspace">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Reported messages</h1>
          <p className="muted">Messages people reported. Remove one for everyone, or keep it and close the report. To stop someone using SynergiFund, remove them in <Link href="/members">Members</Link>.</p>
        </div>
      </div>
      {error && <div className="banner" role="alert">{error}</div>}
      {list.error && <div className="banner" role="alert">{list.error}</div>}
      {!list.data && !list.error && <p className="muted">Loading…</p>}
      {list.data && !open.length && <p className="report-empty">No reports waiting.</p>}
      <div className="report-list">
        {open.map((report) => (
          <section key={report.id} className="panel report-card">
            <header>
              <strong>{report.authorName}</strong>
              <span className="muted">in {report.where} · reported by {report.reporterName} · {when(report.createdAt)}</span>
            </header>
            <blockquote className="report-text">{report.text || "(no text)"}</blockquote>
            {report.reason && <p className="report-reason"><span>Reason</span>{report.reason}</p>}
            {report.messageDeleted && <p className="muted">The message has already been deleted.</p>}
            <footer>
              {report.href && <Link href={report.href} className="tool">Open conversation</Link>}
              <span className="row-actions">
                <button type="button" className="tool" disabled={Boolean(busy)} onClick={() => settle(report, "dismiss")}>{busy === `${report.id}:dismiss` ? "Closing…" : "Keep message"}</button>
                {!report.messageDeleted && <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => settle(report, "remove")}>{busy === `${report.id}:remove` ? "Removing…" : "Remove message"}</button>}
                {report.messageDeleted && <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => settle(report, "remove")}>Close report</button>}
              </span>
            </footer>
          </section>
        ))}
      </div>
      {handled.length > 0 && (
        <>
          <h2 className="report-heading">Handled</h2>
          <div className="report-list">
            {handled.map((report) => (
              <section key={report.id} className="panel report-card is-handled">
                <header>
                  <strong>{report.authorName}</strong>
                  <span className="muted">in {report.where} · reported by {report.reporterName} · {when(report.createdAt)}</span>
                  <StatusPill>{report.status === "Removed" ? "Removed" : "Kept"}</StatusPill>
                </header>
                <blockquote className="report-text">{report.text || "(no text)"}</blockquote>
                {report.resolvedByName && <p className="muted">{report.status === "Removed" ? "Removed" : "Kept"} by {report.resolvedByName}{report.resolvedAt ? ` · ${when(report.resolvedAt)}` : ""}</p>}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
