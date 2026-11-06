"use client"

import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { exactly, shortWhen } from "../../../lib/format"
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
      // On a phone each entry reads as a feed: who did what with the time at the right, the house after the person,
      // and the detail under them (the Property column steps aside there, and the house isn't repeated when the detail
      // names it).
      columns={[
        { key: "title", label: "Name", avatar: (row) => row.actorName || row.title, render: (row) => <span className="person-copy"><strong>{row.title}</strong><small>{row.actorName || "Someone"}{row.property && !String(row.detail || "").includes(row.property) && <span className="activity-at"> · {row.property}</span>}</small></span> },
        { key: "property", label: "Property", className: "hide-phone", render: (row) => row.property || "—" },
        { key: "detail", label: "Detail", className: "phone-wide phone-plain activity-detail", render: (row) => row.detail || <span className="activity-none">—</span> },
        { key: "createdAt", label: "When", className: "activity-when phone-plain", render: (row) => <time dateTime={row.createdAt} title={exactly(row.createdAt)}><span className="activity-exact">{exactly(row.createdAt)}</span><span className="activity-short">{shortWhen(row.createdAt)}</span></time> },
      ]}
      rows={list.data?.items || []}
      empty={list.error || "No activity yet."}
    />
  )
}
