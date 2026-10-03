"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { can } from "@synergifund/shared"
import { FormSheet } from "../../../components/ui/FormSheet"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

export default function LoansPage() {
  const router = useRouter()
  const session = useSession()
  const list = useApi("/loans")
  const properties = useApi("/properties")
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const items = list.data?.items || []
  const writable = session?.user && can(session.user, "properties.write")

  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    const form = new FormData(event.currentTarget)
    const body = Object.fromEntries(form.entries())
    try {
      await api("/loans", { method: "POST", body })
      setOpen(false)
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <WorkspacePage
        views={false}
        title="Loans & lenders"
        action={writable ? { label: "Add loan", onClick: () => setOpen(true) } : null}
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
      {open && (
        <FormSheet eyebrow="Loans" title="Add a loan" hint="Leave a figure blank when it has not been entered. The lender is the name on this loan." onClose={() => setOpen(false)} onSubmit={submit} submitLabel="Save loan" pending={pending} error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Lender</span><input name="lender" required /></label>
            <label className="field wide"><span>Property</span>
              <select name="propertyId" required>
                <option value="">Choose</option>
                {(properties.data?.items || []).map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
              </select>
            </label>
            <label className="field"><span>Balance</span><input name="balance" inputMode="decimal" /></label>
            <label className="field"><span>Monthly payment</span><input name="payment" inputMode="decimal" /></label>
            <label className="field"><span>Original amount</span><input name="originalAmount" inputMode="decimal" /></label>
            <label className="field"><span>Maturity</span><input name="maturity" type="date" /></label>
            <label className="field"><span>Loan number</span><input name="loanNumber" /></label>
            <label className="field"><span>Terms</span>
              <select name="termsStatus">
                <option>Needs verification</option>
                <option>Verified</option>
              </select>
            </label>
          </div>
        </FormSheet>
      )}
    </>
  )
}
