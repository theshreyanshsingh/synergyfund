"use client"

import { useEffect, useState } from "react"
import { REFINANCE, refinancePlan } from "@synergifund/shared"
import { FormSheet } from "../ui/FormSheet"
import { StatusPill } from "../ui/StatusPill"
import { api } from "../../lib/api"
import { money } from "../../lib/format"

// The BRRRR refinance for one property (Financing tab, under Loans): its stage, and what the lender asks for.
// Leverage desired comes from the purchase date (REFINANCE in the shared package holds the months and percentages).

const DONE = REFINANCE.stages[REFINANCE.stages.length - 1]
const readyList = REFINANCE.readyStages.join(", ").replace(/, ([^,]*)$/, " or $1")

function dayLabel(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return ""
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function RefinanceSection({ property, loans, writable, onChanged }) {
  const plan = refinancePlan(property, today())
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [dating, setDating] = useState(false)
  const open = loans.filter((loan) => loan.status !== "Paid off")

  // Opened from the banner on the Properties list (…?tab=financing#refinance): bring this section into view.
  useEffect(() => {
    if (window.location.hash === "#refinance") document.getElementById("refinance")?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [])

  async function change(stage) {
    if (stage === plan.stage) return
    setError("")
    setMessage("")
    if (stage === DONE) {
      const list = open.map((loan) => `${loan.lender}${loan.loanNumber ? ` #${loan.loanNumber}` : ""}${loan.balance != null ? ` (${money(loan.balance)} balance)` : ""}`)
      const note = list.length
        ? `Marking it ${DONE} marks the old ${list.length === 1 ? "loan" : "loans"} Paid off:\n${list.join("\n")}\n\nThen add the new loan with Add loan.`
        : `Marking it ${DONE}. There is no open loan to mark Paid off. Add the new loan with Add loan.`
      if (!window.confirm(note)) return
    }
    setPending(true)
    try {
      const data = await api(`/properties/${property.id}/refinance`, { method: "PATCH", body: { stage } })
      if (stage === DONE) setMessage(data.paidOff.length ? `${DONE}. ${data.paidOff.length === 1 ? "The old loan is" : `${data.paidOff.length} old loans are`} now Paid off. Add the new loan with Add loan above.` : `${DONE}. Add the new loan with Add loan above.`)
      else if (data.restored.length) setMessage(`Back to ${stage}. ${data.restored.length === 1 ? "The loan that was paid off is" : "The loans that were paid off are"} back as before.`)
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const leverage = plan.leverage
  const storedDate = String(property.purchaseDate || "")
  return (
    <section className="panel property-card refinance" id="refinance">
      <div className="property-card-head">
        <div>
          <h2>Refinance</h2>
          <p className="property-missing">The refinance after the rehab, and what the lender asks for.</p>
        </div>
        {plan.eligible ? (
          writable ? (
            <label className="field refinance-stage"><span>Stage</span>
              <select value={plan.stage} disabled={pending} onChange={(event) => change(event.target.value)}>
                {REFINANCE.stages.map((stage) => <option key={stage}>{stage}</option>)}
              </select>
            </label>
          ) : <StatusPill>{plan.stage}</StatusPill>
        ) : <StatusPill>Not Ready for Refinance</StatusPill>}
      </div>
      {!plan.eligible && <p className="refinance-note">Not Ready for Refinance: the property is {property.stage || "not set"}. The refinance starts once it is {readyList}.</p>}
      {message && <p className="refinance-done">{message}</p>}
      {error && <p className="banner">{error}</p>}

      <dl className="loan-facts refinance-facts">
        <div>
          <dt>Address</dt>
          <dd>{property.address}</dd>
          {property.city && <small>{property.city}</small>}
        </div>
        <div>
          <dt>Purchase date</dt>
          <dd>{leverage.missing ? (storedDate ? `${storedDate} (not a full date)` : "Not entered") : dayLabel(storedDate)}</dd>
          {writable && <button type="button" className="tool refinance-inline" onClick={() => setDating(true)}>{leverage.missing ? "Enter Purchase Date" : "Change"}</button>}
        </div>
        <div className={leverage.missing ? "is-missing" : "is-key"}>
          <dt>Leverage desired</dt>
          <dd>{leverage.text}</dd>
          {!leverage.missing && <small>{leverage.seasoned ? `Owned more than ${REFINANCE.seasoningMonths} months` : `${REFINANCE.seasoningMonths} months or less; seasoned after ${dayLabel(leverage.seasonedAfter)}`}</small>}
        </div>
      </dl>

      {dating && <PurchaseDateForm property={property} onClose={() => setDating(false)} onSaved={() => { setDating(false); onChanged?.() }} />}
    </section>
  )
}

function PurchaseDateForm({ property, onClose, onSaved }) {
  const start = /^\d{4}-\d{2}-\d{2}/.test(property.purchaseDate || "") ? String(property.purchaseDate).slice(0, 10) : ""
  const [date, setDate] = useState(start)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!date) return setError("Choose the day the purchase closed.")
    setPending(true)
    setError("")
    try {
      await api(`/properties/${property.id}`, { method: "PATCH", body: { purchaseDate: date } })
      onSaved()
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow={property.address} title="Purchase date" hint={`The day the purchase closed. It sets the leverage: owned more than ${REFINANCE.seasoningMonths} months is seasoned.`} onClose={onClose} onSubmit={submit} submitLabel="Save" pending={pending} error={error}>
      <div className="form-grid">
        <label className="field"><span>Purchase date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      </div>
    </FormSheet>
  )
}
