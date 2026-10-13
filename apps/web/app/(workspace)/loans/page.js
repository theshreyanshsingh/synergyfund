"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { can } from "@synergifund/shared"
import { LoanFields } from "../../../components/loans/LoanFields"
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
  const [section, setSection] = useState("loans")
  const [open, setOpen] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const items = list.data?.items || []
  const lenders = list.data?.lenders || []
  const writable = session?.user && can(session.user, "properties.write")

  async function submitLoan(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    const form = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await api("/loans", { method: "POST", body: form })
      setOpen("")
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function submitLender(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    const form = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const result = await api("/lenders", { method: "POST", body: form })
      setOpen("")
      router.push(`/loans/lenders/${result.lender.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const switcher = (
    <div className="property-switch" role="tablist" aria-label="Loans and lenders">
      <button type="button" role="tab" aria-selected={section === "loans"} className={section === "loans" ? "is-on" : ""} onClick={() => setSection("loans")}>Loans</button>
      <button type="button" role="tab" aria-selected={section === "lenders"} className={section === "lenders" ? "is-on" : ""} onClick={() => setSection("lenders")}>Lenders</button>
    </div>
  )

  return (
    <>
      {section === "loans" ? (
        <WorkspacePage
          views={false}
          loading={!list.data && !list.error}
          title="Loans & lenders"
          underTitle={switcher}
          action={writable ? { label: "Add loan", onClick: () => { setError(""); setOpen("loan") } } : null}
          stats={[
            { label: "Reported balances", value: money(items.filter((item) => item.status !== "Paid off").reduce((sum, item) => sum + Number(item.balance || 0), 0)), hint: "Open loans, from the loan records" },
            { label: "Monthly payments", value: money(items.filter((item) => item.status !== "Paid off").reduce((sum, item) => sum + Number(item.payment || 0), 0)), hint: "Same figure as Overview" },
            { label: "Loan records", value: String(items.length), hint: "One loan, one property" },
            { label: "Lenders", value: String(lenders.length), hint: "Shared lender records" },
          ]}
          columns={[
            { key: "lender", label: "Lender", avatar: (row) => row.lender, render: (row) => <span className="person-copy"><strong>{row.lender}</strong><small>{row.label}</small></span> },
            { key: "address", label: "Property", render: (row) => <span className="person-copy"><strong>{row.address || "No property"}</strong><small>{[row.city, row.loanNumber].filter(Boolean).join(" · ")}</small></span> },
            { key: "balance", label: "Balance", render: (row) => money(row.balance) },
            { key: "payment", label: "Payment", render: (row) => money(row.payment) },
            { key: "maturity", label: "Maturity", render: (row) => row.maturity || "No date" },
            { key: "status", label: "Loan status", render: (row) => <StatusPill>{row.status || "Current"}</StatusPill> },
            { key: "termsStatus", label: "Terms", render: (row) => <StatusPill>{row.termsStatus}</StatusPill> },
          ]}
          rows={items}
          important={(row) => row.termsStatus === "Needs verification"}
          onRow={(row) => router.push(row.lenderId ? `/loans/lenders/${row.lenderId}` : `/properties/${row.propertyId}`)}
          empty="No loans yet. Add a lender, then attach a property."
        />
      ) : (
        <WorkspacePage
          views={false}
          loading={!list.data && !list.error}
          title="Loans & lenders"
          underTitle={switcher}
          action={writable ? { label: "Add lender", onClick: () => { setError(""); setOpen("lender") } } : null}
          columns={[
            { key: "name", label: "Lender", avatar: (row) => row.name, render: (row) => <span className="person-copy"><strong>{row.name}</strong><small>{row.terms || "No custom terms yet"}</small></span> },
            { key: "properties", label: "Properties" },
            { key: "balance", label: "Balances", render: (row) => money(row.balance) },
            { key: "payment", label: "Monthly", render: (row) => money(row.payment) },
          ]}
          rows={lenders}
          onRow={(row) => router.push(`/loans/lenders/${row.id}`)}
          empty="No lenders yet."
        />
      )}
      {open === "loan" && (
        <FormSheet eyebrow="Loans" title="Add a loan" hint="The payment recorded here is the monthly mortgage used on Overview." onClose={() => setOpen("")} onSubmit={submitLoan} submitLabel="Save loan" pending={pending} error={error}>
          <LoanFields lenders={lenders} properties={properties.data?.items || []} />
        </FormSheet>
      )}
      {open === "lender" && (
        <FormSheet eyebrow="Lenders" title="Add a lender" hint="Terms written here show on every property financed with this lender." onClose={() => setOpen("")} onSubmit={submitLender} submitLabel="Save lender" pending={pending} error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Name</span><input name="name" required /></label>
            <label className="field wide"><span>Custom terms</span><textarea name="terms" placeholder="Rate, recourse, draws, or anything this lender requires" /></label>
          </div>
        </FormSheet>
      )}
    </>
  )
}
