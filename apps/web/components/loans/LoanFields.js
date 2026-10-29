"use client"

import { useState } from "react"
import { BEHIND_STATUSES, LOAN_STATUSES, LOAN_TYPES, loanStatus } from "@synergifund/shared"

const NEW_LENDER = "__new"

// One loan form for the Loans page and a property's Financing tab (Add loan and Edit loan). The lender is optional.
// Payments Behind and Past-Due Amount show only while the loan is Late or Delinquent.
export function LoanFields({ lenders, properties = [], loan, propertyId = "" }) {
  // Keep the loan's current lender even if it is missing from the list, so saving never drops it.
  const [choice, setChoice] = useState(loan?.lenderId || "")
  const [status, setStatus] = useState(loanStatus(loan?.status))
  const missing = loan?.lenderId && !lenders.some((lender) => lender.id === loan.lenderId) ? { id: loan.lenderId, name: loan.lender || "Current lender" } : null
  const behind = BEHIND_STATUSES.includes(status)
  return (
    <div className="form-grid">
      <label className={choice === NEW_LENDER ? "field" : "field wide"}><span>Lender <em>· optional</em></span>
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">No lender</option>
          {missing && <option value={missing.id}>{missing.name}</option>}
          {lenders.map((lender) => <option key={lender.id} value={lender.id}>{lender.name}</option>)}
          <option value={NEW_LENDER}>New lender…</option>
        </select>
      </label>
      <input type="hidden" name="lenderId" value={choice === NEW_LENDER ? "" : choice} />
      {choice === NEW_LENDER && <label className="field"><span>New lender name</span><input name="lender" required maxLength={120} autoFocus /></label>}
      {propertyId ? (
        <input type="hidden" name="propertyId" value={propertyId} />
      ) : (
        <label className="field wide"><span>Property</span>
          <select name="propertyId" required defaultValue={loan?.propertyId || ""}>
            <option value="">Choose</option>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
          </select>
        </label>
      )}
      <label className={behind ? "field wide" : "field"}><span>Loan status</span>
        <select name="status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {LOAN_STATUSES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      {behind && (
        <>
          <label className="field"><span>Payments behind</span><input name="paymentsBehind" type="number" min="0" max="600" step="1" inputMode="numeric" placeholder="0" defaultValue={loan?.paymentsBehind ?? ""} /></label>
          <label className="field"><span>Past-due amount</span><input name="pastDueAmount" inputMode="decimal" placeholder="$0" defaultValue={loan?.pastDueAmount ?? ""} /></label>
        </>
      )}
      <label className="field"><span>Loan type</span>
        <select name="loanType" defaultValue={loan?.loanType || ""}>
          <option value="">Not entered</option>
          {LOAN_TYPES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label className="field"><span>Interest rate (%)</span><input name="interestRate" inputMode="decimal" placeholder="8.90" defaultValue={loan?.interestRate ?? ""} /></label>
      <label className="field"><span>Servicer</span><input name="servicer" maxLength={120} placeholder="Who the payments go to" defaultValue={loan?.servicer || ""} /></label>
      <label className="field"><span>Loan number</span><input name="loanNumber" defaultValue={loan?.loanNumber || ""} /></label>
      <label className="field"><span>Original loan amount</span><input name="originalAmount" inputMode="decimal" placeholder="$0" defaultValue={loan?.originalAmount ?? ""} /></label>
      <label className="field"><span>Current loan amount</span><input name="balance" inputMode="decimal" placeholder="$0" defaultValue={loan?.balance ?? ""} /></label>
      <label className="field"><span>Monthly payment</span><input name="payment" inputMode="decimal" placeholder="$0" defaultValue={loan?.payment ?? ""} /></label>
      <label className="field"><span>Payment due day</span><input name="paymentDay" type="number" min="1" max="31" inputMode="numeric" placeholder="Day of the month, 1 to 31" defaultValue={loan?.paymentDay ?? ""} /></label>
      <div className="field wide date-pair">
        <label className="field"><span>Origination date</span><input name="originationDate" type="date" defaultValue={loan?.originationDate || ""} /></label>
        <label className="field"><span>Maturity date</span><input name="maturity" type="date" defaultValue={loan?.maturity || ""} /></label>
      </div>
      <label className="field"><span>Terms status</span>
        <select name="termsStatus" defaultValue={loan?.termsStatus || "Needs verification"}>
          <option>Needs verification</option>
          <option>Verified</option>
        </select>
      </label>
      <label className="field wide"><span>Terms for this property</span><textarea name="terms" defaultValue={loan?.terms || ""} placeholder="Anything specific to this house" /></label>
      <p className="field wide form-note">Monthly payments go on the calendar automatically from the due day. Insurance is on the property's Property Info tab.</p>
    </div>
  )
}
