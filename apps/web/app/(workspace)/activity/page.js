"use client"

import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { exactly } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

export default function ActivityPage() {
  const list = useApi("/activity")
  return (
    <WorkspacePage
      views={false}
      loading={!list.data && !list.error}
      title="Team activity"
      selectable={false}
      compact
      filters={[
        { key: "actor", label: "Person", value: (row) => row.actorName },
        { key: "property", label: "Property", value: (row) => row.property },
      ]}
      columns={[
        { key: "title", label: "Name", avatar: (row) => row.actorName || row.title, render: (row) => <span className="person-copy"><strong>{row.title}</strong><small>{row.actorName || "Someone"}</small></span> },
        { key: "property", label: "Property", render: (row) => row.property || "—" },
        { key: "detail", label: "Detail", className: "phone-wide", render: (row) => row.detail || "—" },
        { key: "createdAt", label: "When", className: "activity-when", render: (row) => exactly(row.createdAt) },
      ]}
      rows={list.data?.items || []}
      empty="No activity yet."
    />
  )
}
