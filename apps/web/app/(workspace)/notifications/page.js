"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { can, PERMISSIONS } from "@synergifund/shared"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useChatEvents } from "../../../lib/chatSocket"
import { when } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"
import { StatusPill } from "../../../components/ui/StatusPill"

// Each kind of alert by its icon (the `event` it was sent for).
const KIND_ICONS = [
  [/^task\./, "check"],
  [/^chat\.direct/, "chat"],
  [/^chat\./, "at"],
  [/^call\./, "phone"],
  [/^draw\./, "layers"],
  [/^expense\./, "receipt"],
  [/^payment\./, "card"],
  [/^(loan|lender)\./, "bank"],
  [/^property\./, "building"],
  [/^(member|teammate)\./, "users"],
]

function kindIcon(event) {
  return KIND_ICONS.find(([pattern]) => pattern.test(event || ""))?.[1] || "bell"
}

// Your alerts, one row each. Admins also have the Email log: what the app emailed and whether it went.
export default function NotificationsPage() {
  const session = useSession()
  const router = useRouter()
  const list = useApi("/notifications")
  const [tab, setTab] = useState("inbox")
  const unread = (list.data?.items || []).some((item) => !item.read)
  // Mark them read once they have been shown, so the new ones can be told apart first.
  useEffect(() => {
    if (unread) api("/notifications/read", { method: "POST", body: {} }).catch(() => {})
  }, [unread, list.data])
  // A new alert while this page is open shows up straight away.
  useChatEvents({ "notification:new": () => list.reload() }, can(session?.user, PERMISSIONS.chatUse))
  const mailLog = can(session?.user, PERMISSIONS.membersManage)
  const email = mailLog && tab === "email"
  const tabs = mailLog && (
    <div className="seg notice-tabs" role="tablist" aria-label="Show">
      <button type="button" role="tab" aria-selected={!email} className={!email ? "on" : ""} onClick={() => setTab("inbox")}>Notifications</button>
      <button type="button" role="tab" aria-selected={email} className={email ? "on" : ""} onClick={() => setTab("email")}>Email log</button>
    </div>
  )

  if (email) {
    return (
      <WorkspacePage
        key="email"
        views={false}
        loading={!list.data && !list.error}
        title="Notifications"
        underTitle={tabs}
        columns={[
          { key: "subject", label: "Email", icon: () => "mail", render: (row) => row.subject },
          { key: "to", label: "To", render: (row) => (row.to || []).join(", ") },
          { key: "status", label: "Status", render: (row) => <StatusPill>{row.status}</StatusPill> },
          { key: "createdAt", label: "When", render: (row) => when(row.createdAt) },
        ]}
        rows={list.data?.mail || []}
        important={(row) => row.status === "Failed"}
        empty="No emails sent yet."
      />
    )
  }

  return (
    <WorkspacePage
      key="inbox"
      views={false}
      loading={!list.data && !list.error}
      title="Notifications"
      underTitle={tabs}
      columns={[
        { key: "title", label: "Name", icon: (row) => kindIcon(row.event), render: (row) => row.title },
        { key: "body", label: "Detail" },
        { key: "read", label: "Status", render: (row) => (row.read ? <span className="muted">Seen</span> : <StatusPill>New</StatusPill>) },
        { key: "createdAt", label: "When", render: (row) => when(row.createdAt) },
      ]}
      rows={list.data?.items || []}
      // Opens what the notification is about: the draw's property, the expense list, the company…
      onRow={(row) => { if (row.href) router.push(row.href) }}
      important={(row) => !row.read}
      empty="No notifications yet."
    />
  )
}
