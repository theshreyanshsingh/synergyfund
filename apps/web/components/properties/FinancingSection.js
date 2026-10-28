"use client"

import { useState } from "react"
import Link from "next/link"
import { loanSummary } from "@synergifund/shared"
import { LoanFields } from "../loans/LoanFields"
import { RefinanceSection } from "./RefinanceSection"
import { FormSheet } from "../ui/FormSheet"
import { StatusPill } from "../ui/StatusPill"
import { api } from "../../lib/api"
import { money } from "../../lib/format"

export function dayLabel(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return ""
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function ordinal(day) {
  const rest = day % 100
  if (rest >= 11 && rest <= 13) return `${day}th`
  return `${day}${({ 1: "st", 2: "nd", 3: "rd" })[day % 10] || "th"}`
}

function earliest(dates) {
  return dates.filter(Boolean).sort()[0] || ""
}

export function FinancingSection({ propertyId, property, loans, writable, onChanged }) {
  const [editing, setEditing] = useState(null)
  const [lenders, setLenders] = useState(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const summary = loanSummary(loans)
  const open = loans.filter((loan) => loan.status !== "Paid off")
  const totals = open.filter((loan) => loan.originalAmount != null)
  const totalLoan = totals.length ? totals.reduce((sum, loan) => sum + Number(loan.originalAmount || 0), 0) : null
  const nextPayment = earliest(open.map((loan) => loan.nextPaymentDue))

  async function start(loan) {
    setError("")
    setEditing(loan || {})
    // Always reload lenders so one added a moment ago is in the list.
    setLenders(null)
    try {
      const data = await api("/loans")
      setLenders(data.lenders || [])
    } catch (err) {
      // Keep the form closed: an empty lender list would save the loan with no lender.
      setError(`Lenders could not load, so the loan cannot be edited right now. ${err.message}`)
    }
  }

  async function save(event) {
    event.preventDefault()
    setError("")
    const body = Object.fromEntries(new FormData(event.currentTarget))
    setPending(true)
    try {
      if (editing?.id) await api(`/loans/${editing.id}`, { method: "PATCH", body })
      else await api("/loans", { method: "POST", body })
      setEditing(null)
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <section className="property-figures financing-figures">
        <article className="property-figure"><span>Loan status</span><strong><StatusPill>{summary.status}</StatusPill></strong></article>
        <article className="property-figure"><span>Total loan</span><strong>{money(totalLoan)}</strong></article>
        <article className="property-figure"><span>Balance</span><strong>{money(summary.balance)}</strong></article>
        <article className="property-figure">
          <span>Monthly payment</span>
          <strong>{money(summary.payment)}</strong>
          {nextPayment && <em>Next due {dayLabel(nextPayment)}</em>}
        </article>
      </section>

      <section className="panel property-card">
        <div className="property-card-head">
          <div>
            <h2>Loans</h2>
            <p className="property-missing">Payments show on the <Link href="/calendar">calendar</Link> automatically from their due dates.</p>
          </div>
          {writable && <button type="button" className="tool" onClick={() => start(null)}>Add loan</button>}
        </div>
        {loans.length === 0 && <p className="property-missing">No lender is recorded for this house.</p>}
        <div className="loan-cards">
          {loans.map((loan) => (
            <article key={loan.id} className={`loan-card${loan.status === "Paid off" ? " is-closed" : ""}`}>
              <header>
                <div>
                  <strong>{loan.lenderId ? <Link href={`/loans/lenders/${loan.lenderId}`}>{loan.lender}</Link> : loan.lender}</strong>
                  <small>{[loan.label, loan.loanNumber && `#${loan.loanNumber}`].filter(Boolean).join(" · ")}</small>
                </div>
                <StatusPill>{loan.status || "Current"}</StatusPill>
                {writable && <button type="button" className="tool" onClick={() => start(loan)}>Edit</button>}
              </header>
              <dl className="loan-facts">
                <div><dt>Total loan</dt><dd>{money(loan.originalAmount)}</dd></div>
                <div><dt>Balance</dt><dd>{money(loan.balance)}</dd></div>
                <div><dt>Monthly payment</dt><dd>{money(loan.payment)}</dd></div>
                <div>
                  <dt>Payment due</dt>
                  <dd>{loan.paymentDay ? `${ordinal(loan.paymentDay)} of the month` : "Not entered"}</dd>
                  {loan.nextPaymentDue && <small>Next {dayLabel(loan.nextPaymentDue)}</small>}
                </div>
                <div><dt>Maturity</dt><dd>{loan.maturity ? dayLabel(loan.maturity) : "Not entered"}</dd></div>
                <div><dt>Terms</dt><dd>{loan.termsStatus || "Recorded"}</dd></div>
              </dl>
              {(loan.terms || loan.lenderTerms) && <p className="loan-terms">{[loan.terms, loan.lenderTerms].filter(Boolean).join(" · ")}</p>}
              {loan.status !== "Paid off" && loan.payment != null && !loan.paymentDay && <p className="loan-warning">Add the payment due day so monthly payments show on the calendar.</p>}
            </article>
          ))}
        </div>
      </section>

      {property && <RefinanceSection property={property} loans={loans} writable={writable} onChanged={onChanged} onAddLoan={() => start(null)} />}

      {editing && (
        <FormSheet
          eyebrow="Financing"
          title={editing.id ? "Edit loan" : "Add loan"}
          hint={editing.id ? "Blank amounts are cleared. Changes update the calendar right away." : "Leave an amount blank if you do not have it yet."}
          onClose={() => setEditing(null)}
          onSubmit={save}
          submitLabel={editing.id ? "Save loan" : "Add loan"}
          pending={pending || !lenders}
          pendingLabel={!lenders ? "Loading…" : undefined}
          error={error}
        >
          {lenders ? (
            <LoanFields lenders={lenders} loan={editing.id ? editing : null} propertyId={propertyId} />
          ) : (
            <p className="property-missing">{error ? "Close this and try again." : "Loading lenders…"}</p>
          )}
        </FormSheet>
      )}
    </>
  )
}
