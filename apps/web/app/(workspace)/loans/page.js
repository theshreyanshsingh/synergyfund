"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LOAN_LABELS, can } from "@synergifund/shared"
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
            { label: "Reported balances", value: money(items.reduce((sum, item) => sum + Number(item.balance || 0), 0)), hint: "From the loan records" },
            { label: "Monthly payments", value: money(items.reduce((sum, item) => sum + Number(item.payment || 0), 0)), hint: "Same figure as Overview" },
            { label: "Loan records", value: String(items.length), hint: "One loan, one property" },
            { label: "Lenders", value: String(lenders.length), hint: "Shared lender records" },
          ]}
          columns={[
            { key: "lender", label: "Lender", avatar: (row) => row.lender, render: (row) => <span className="person-copy"><strong>{row.lender}</strong><small>{row.label}</small></span> },
            { key: "address", label: "Property", render: (row) => <span className="person-copy"><strong>{row.address || "No property"}</strong><small>{[row.city, row.loanNumber].filter(Boolean).join(" · ")}</small></span> },
            { key: "balance", label: "Balance", render: (row) => money(row.balance) },
            { key: "payment", label: "Payment", render: (row) => money(row.payment) },
            { key: "maturity", label: "Maturity", render: (row) => row.maturity || "No date" },
            { key: "termsStatus", label: "Status", render: (row) => <StatusPill>{row.termsStatus}</StatusPill> },
          ]}
          rows={items}
          important={(row) => row.termsStatus === "Needs verification"}
          onRow={(row) => row.lenderId && router.push(`/loans/lenders/${row.lenderId}`)}
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

export function LoanFields({ lenders, properties, loan }) {
  return (
    <div className="form-grid">
      <label className="field wide"><span>Lender</span>
        <select name="lenderId" required defaultValue={loan?.lenderId || ""}>
          <option value="">Choose</option>
          {lenders.map((lender) => <option key={lender.id} value={lender.id}>{lender.name}</option>)}
        </select>
      </label>
      <label className="field wide"><span>Property</span>
        <select name="propertyId" required defaultValue={loan?.propertyId || ""}>
          <option value="">Choose</option>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
        </select>
      </label>
      <label className="field"><span>Nature</span>
        <input name="label" list="loan-labels" defaultValue={loan?.label || "Financed"} />
        <datalist id="loan-labels">{LOAN_LABELS.map((label) => <option key={label} value={label} />)}</datalist>
      </label>
      <label className="field"><span>Loan number</span><input name="loanNumber" defaultValue={loan?.loanNumber || ""} /></label>
      <label className="field"><span>Balance</span><input name="balance" inputMode="decimal" defaultValue={loan?.balance ?? ""} /></label>
      <label className="field"><span>Monthly payment</span><input name="payment" inputMode="decimal" defaultValue={loan?.payment ?? ""} /></label>
      <label className="field"><span>Payment day of month</span><input name="paymentDay" type="number" min="1" max="31" inputMode="numeric" placeholder="1 to 31" defaultValue={loan?.paymentDay ?? ""} /></label>
      <label className="field"><span>Original amount</span><input name="originalAmount" inputMode="decimal" defaultValue={loan?.originalAmount ?? ""} /></label>
      <label className="field"><span>Maturity</span><input name="maturity" type="date" defaultValue={loan?.maturity || ""} /></label>
      <label className="field"><span>Terms status</span>
        <select name="termsStatus" defaultValue={loan?.termsStatus || "Needs verification"}>
          <option>Needs verification</option>
          <option>Verified</option>
        </select>
      </label>
      <label className="field wide"><span>Terms for this property</span><textarea name="terms" defaultValue={loan?.terms || ""} placeholder="Anything specific to this house" /></label>
    </div>
  )
}
