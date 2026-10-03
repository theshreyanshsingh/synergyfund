"use client"

import { can } from "@synergifund/shared"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

export default function PaymentsPage() {
  const session = useSession()
  const list = useApi("/bills")
  const expenses = useApi("/expenses")
  const bills = list.data?.items || []
  const posted = (expenses.data?.expenses || [])
    .filter((item) => item.costTreatment !== "Exclude from construction margin")
    .map((item) => ({ id: `posted-${item.id}`, title: item.title, entity: item.entity || "Construction company", due: item.date || "", amount: item.amount, status: "Posted", payable: false }))
  const items = [...bills.map((item) => ({ ...item, payable: item.status !== "Paid" })), ...posted]
  const upcoming = bills.filter((item) => item.status !== "Paid")
  const canPay = session?.user && can(session.user, "expenses.approve")

  async function pay(row) {
    await api(`/bills/${row.id}/pay`, { method: "POST", body: {} })
    list.reload()
    expenses.reload()
  }

  return (
    <WorkspacePage
      views={false}
      title="Upcoming payments"
      stats={[
        { label: "Scheduled", value: String(upcoming.length), hint: "Unpaid" },
        { label: "Amount", value: money(upcoming.reduce((sum, item) => sum + Number(item.amount || 0), 0)), hint: "Does not send a payment" },
        { label: "Posted costs", value: money(posted.reduce((sum, item) => sum + Number(item.amount || 0), 0)), hint: "Approved onto the books" },
        { label: "Entities", value: "2", hint: "Investment and construction" },
        { label: "Window", value: "30d", hint: "Upcoming book" },
      ]}
      columns={[
        { key: "title", label: "Name", avatar: (row) => row.title, render: (row) => row.title },
        { key: "entity", label: "Entity" },
        { key: "due", label: "Due" },
        { key: "amount", label: "Amount", render: (row) => money(row.amount) },
        { key: "status", label: "Status", render: (row) => <StatusPill>{row.status}</StatusPill> },
        { key: "actions", label: "", pin: "right", render: (row) => canPay && row.payable ? <span className="row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); pay(row) }}>Mark paid</button></span> : null },
      ]}
      rows={items}
      important={(row) => row.payable}
      onRow={canPay ? (row) => row.payable && pay(row) : undefined}
      empty="No unpaid payments scheduled."
    />
  )
}
