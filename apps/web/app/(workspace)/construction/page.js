"use client"

import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

export default function ConstructionPage() {
  const data = useApi("/construction")
  const totals = data.data?.totals
  return (
    <WorkspacePage
      views={false}
      title="Construction intelligence"
      stats={totals ? [
        { label: "Projected profit", value: money(totals.projected), hint: "Contract + changes − cost − overhead" },
        { label: "Revenue received", value: money(totals.revenue), hint: "Cash collected" },
        { label: "Expected costs", value: money(totals.cost), hint: "Not lender draws" },
        { label: "Cash surplus", value: money(totals.surplus), hint: "Received minus costs" },
        { label: "Projects", value: String((data.data?.items || []).length), hint: "With a contract on file" },
      ] : []}
      columns={[
        { key: "title", label: "Name", avatar: (row) => row.title, render: (row) => row.title },
        { key: "contractAmount", label: "Contract", render: (row) => money(row.contractAmount) },
        { key: "estimatedCost", label: "Expected cost", render: (row) => money(row.estimatedCost) },
        { key: "status", label: "Status", render: (row) => <StatusPill>{row.status}</StatusPill> },
      ]}
      rows={data.data?.items || []}
      important={(row) => row.status !== "Complete"}
      empty="Add a construction contract before treating unused draw budget as profit. Draw funds are not revenue."
    />
  )
}
