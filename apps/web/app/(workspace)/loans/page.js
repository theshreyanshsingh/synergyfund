"use client"

import { useRouter } from "next/navigation"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

export default function LoansPage() {
  const router = useRouter()
  const list = useApi("/loans")
  const items = list.data?.items || []
  return (
    <WorkspacePage
      views={false}
      title="Loans & lenders"
      stats={[
        { label: "Reported balances", value: money(items.reduce((sum, item) => sum + Number(item.balance || 0), 0)), hint: "Supplied values only" },
        { label: "Monthly payments", value: money(items.reduce((sum, item) => sum + Number(item.payment || 0), 0)), hint: "Recorded schedules" },
        { label: "Loan records", value: String(items.length), hint: "Applications stay separate" },
        { label: "Need verification", value: String(items.filter((item) => item.termsStatus !== "Verified").length), hint: "Source terms" },
        { label: "Verified", value: String(items.filter((item) => item.termsStatus === "Verified").length), hint: "Confirmed servicing" },
      ]}
      columns={[
        { key: "lender", label: "Name", avatar: (row) => row.lender, render: (row) => row.lender },
        { key: "address", label: "Property" },
        { key: "balance", label: "Balance", render: (row) => money(row.balance) },
        { key: "maturity", label: "Maturity" },
        { key: "termsStatus", label: "Status", render: (row) => <StatusPill>{row.termsStatus}</StatusPill> },
        { key: "open", label: "", pin: "right", render: (row) => row.propertyId ? <span className="row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); router.push(`/properties/${row.propertyId}`) }}>Open property</button></span> : null },
      ]}
      rows={items}
      important={(row) => row.termsStatus === "Needs verification"}
      onRow={(row) => row.propertyId && router.push(`/properties/${row.propertyId}`)}
    />
  )
}
