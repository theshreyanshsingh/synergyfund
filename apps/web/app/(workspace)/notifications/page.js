"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { can, PERMISSIONS } from "@synergifund/shared"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useChatEvents } from "../../../lib/chatSocket"
import { when } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"
import { StatusPill } from "../../../components/ui/StatusPill"

export default function NotificationsPage() {
  const session = useSession()
  const router = useRouter()
  const list = useApi("/notifications")
  const unread = (list.data?.items || []).some((item) => !item.read)
  // Mark them read once they have been shown, so the new ones can be told apart first.
  useEffect(() => {
    if (unread) api("/notifications/read", { method: "POST", body: {} }).catch(() => {})
  }, [unread, list.data])
  // A new alert while this page is open shows up straight away.
  useChatEvents({ "notification:new": () => list.reload() }, can(session?.user, PERMISSIONS.chatUse))
  const rows = [
    ...(list.data?.items || []).map((item) => ({ ...item, kind: item.read ? "In app" : "New" })),
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
      // Opens what the notification is about: the draw's property, the expense list, the company…
      onRow={(row) => { if (row.href) router.push(row.href) }}
      important={(row) => row.kind !== "In app"}
      empty="No notifications yet."
    />
  )
}
