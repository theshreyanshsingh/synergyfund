"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BEHIND_STATUSES, LOAN_STATUSES, LOAN_TYPES, can, isPaidOff, rateLabel } from "@synergifund/shared"
import { LoanFields } from "../../../components/loans/LoanFields"
import { dayLabel, missedPayments } from "../../../components/properties/FinancingSection"
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
  const openLoans = items.filter((item) => !isPaidOff(item))
  const rates = [...new Set(items.map((item) => item.interestRate).filter((rate) => rate != null))].sort((a, b) => a - b).map(rateLabel)

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
            { label: "Current loan amounts", value: money(openLoans.reduce((sum, item) => sum + Number(item.balance || 0), 0)), hint: "Open loans, from the loan records" },
            { label: "Monthly payments", value: money(openLoans.reduce((sum, item) => sum + Number(item.payment || 0), 0)), hint: "Same figure as Overview" },
            { label: "Loan records", value: String(items.length), hint: "One loan, one property" },
            { label: "Lenders", value: String(lenders.length), hint: "Shared lender records" },
          ]}
          columns={[
            { key: "lender", label: "Lender", sort: (row) => row.lender, avatar: (row) => row.lender, render: (row) => <span className="person-copy"><strong>{row.lender}</strong>{row.loanNumber && <small>#{row.loanNumber}</small>}</span> },
            { key: "address", label: "Property", sort: (row) => row.address, render: (row) => <span className="person-copy"><strong>{row.address || "No property"}</strong>{row.city && <small>{row.city}</small>}</span> },
            { key: "loanType", label: "Loan type", sort: (row) => row.loanType, render: (row) => row.loanType || "—" },
            { key: "interestRate", label: "Interest rate", className: "num", sort: (row) => row.interestRate, render: (row) => rateLabel(row.interestRate) || "—" },
            { key: "servicer", label: "Servicer", sort: (row) => row.servicer, render: (row) => row.servicer || "—" },
            { key: "balance", label: "Current loan amount", className: "num", peek: true, sort: (row) => row.balance, render: (row) => money(row.balance) },
            { key: "payment", label: "Payment", className: "num", sort: (row) => row.payment, render: (row) => money(row.payment) },
            { key: "maturity", label: "Maturity date", sort: (row) => (/^\d{4}-\d{2}-\d{2}/.test(row.maturity) ? row.maturity : ""), render: (row) => dayLabel(row.maturity) || row.maturity || "No date" },
            // The terms status sits under the loan status, so the list fits a laptop screen with the new columns.
            { key: "status", label: "Loan status", sort: (row) => LOAN_STATUSES.indexOf(row.status), render: (row) => (
              <span className="loan-status-cell">
                <StatusPill>{row.status || "Current"}</StatusPill>
                {BEHIND_STATUSES.includes(row.status) && missedPayments(row) && <small className="loan-behind">{missedPayments(row)}</small>}
                <small className={row.termsStatus === "Verified" ? undefined : "loan-terms-check"}>{row.termsStatus === "Verified" ? "Terms verified" : "Terms need verification"}</small>
              </span>
            ) },
          ]}
          rows={items}
          filters={[
            { key: "status", label: "Loan status", value: (row) => row.status || "Current", options: LOAN_STATUSES.filter((status) => items.some((item) => item.status === status)) },
            { key: "loanType", label: "Loan type", value: (row) => row.loanType, options: LOAN_TYPES.filter((type) => items.some((item) => item.loanType === type)) },
            { key: "interestRate", label: "Interest rate", value: (row) => rateLabel(row.interestRate), options: rates },
            { key: "servicer", label: "Servicer", value: (row) => row.servicer },
          ]}
          important={(row) => row.termsStatus === "Needs verification" || Number(row.paymentsBehind) > 0}
          onRow={(row) => router.push(row.lenderId ? `/loans/lenders/${row.lenderId}` : `/properties/${row.propertyId}`)}
          // Phones: one line per loan (lender and balance); a tap shows or folds the rest, and Open opens it.
          collapsible
          openLabel={(row) => (row.lenderId ? "Open lender" : "Open property")}
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
