"use client"

import { useEffect } from "react"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { api } from "../../../lib/api"
import { when } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"
import { StatusPill } from "../../../components/ui/StatusPill"

export default function NotificationsPage() {
  const list = useApi("/notifications")
  useEffect(() => {
    api("/notifications/read", { method: "POST", body: {} }).catch(() => {})
  }, [])
  const rows = [
    ...(list.data?.items || []).map((item) => ({ ...item, kind: "In app" })),
    ...(list.data?.mail || []).map((item) => ({ id: item.id, title: item.subject, body: (item.to || []).join(", "), createdAt: item.createdAt, kind: item.status })),
  ]
  return (
    <WorkspacePage
      views={false}
      loading={!list.data && !list.error}
      title="Notifications"
      columns={[
        { key: "title", label: "Name", avatar: (row) => row.title || "Notice", render: (row) => row.title },
        { key: "body", label: "Detail" },
        { key: "kind", label: "Channel", render: (row) => <StatusPill>{row.kind}</StatusPill> },
        { key: "createdAt", label: "When", render: (row) => when(row.createdAt) },
      ]}
      rows={rows}
      important={(row) => row.kind !== "In app"}
      empty="No notifications yet."
    />
  )
}
