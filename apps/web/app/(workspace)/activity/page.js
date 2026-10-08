"use client"

import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { when } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

export default function ActivityPage() {
  const list = useApi("/activity")
  return (
    <WorkspacePage
      views={false}
      loading={!list.data && !list.error}
      title="Team activity"
      columns={[
        { key: "title", label: "Name", avatar: (row) => row.actorName || row.title, render: (row) => <span className="person-copy"><strong>{row.title}</strong><small>{row.actorName || "Someone"}</small></span> },
        { key: "detail", label: "Detail", render: (row) => row.detail || "—" },
        { key: "createdAt", label: "When", render: (row) => when(row.createdAt) },
      ]}
      rows={list.data?.items || []}
      empty="No activity yet."
    />
  )
}
