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
      selectable={false}
      filters={[
        { key: "actor", label: "Person", value: (row) => row.actorName },
        { key: "property", label: "Property", value: (row) => row.property },
      ]}
      columns={[
        { key: "title", label: "Name", avatar: (row) => row.actorName || row.title, render: (row) => <span className="person-copy"><strong>{row.title}</strong><small>{row.actorName || "Someone"}</small></span> },
        { key: "property", label: "Property", render: (row) => row.property || "—" },
        { key: "detail", label: "Detail", render: (row) => row.detail || "—" },
        { key: "createdAt", label: "When", render: (row) => when(row.createdAt) },
      ]}
      rows={list.data?.items || []}
      empty="No activity yet."
    />
  )
}
