"use client"

import { useState } from "react"
import { INSURANCE_FREQUENCIES, LOAN_LABELS, LOAN_STATUSES } from "@synergifund/shared"

const NEW_LENDER = "__new"

// One loan form for the Loans page and a property's Financing tab. The lender is optional.
export function LoanFields({ lenders, properties = [], loan, propertyId = "" }) {
  // Keep the loan's current lender even if it is missing from the list, so saving never drops it.
  const [choice, setChoice] = useState(loan?.lenderId || "")
  const missing = loan?.lenderId && !lenders.some((lender) => lender.id === loan.lenderId) ? { id: loan.lenderId, name: loan.lender || "Current lender" } : null
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
      <label className="field"><span>Loan status</span>
        <select name="status" defaultValue={loan?.status || "Current"}>
          {LOAN_STATUSES.map((status) => <option key={status}>{status}</option>)}
        </select>
      </label>
      <label className="field"><span>Nature</span>
        <input name="label" list="loan-labels" defaultValue={loan?.label || "Financed"} />
        <datalist id="loan-labels">{LOAN_LABELS.map((label) => <option key={label} value={label} />)}</datalist>
      </label>
      <label className="field"><span>Total loan amount</span><input name="originalAmount" inputMode="decimal" placeholder="$0" defaultValue={loan?.originalAmount ?? ""} /></label>
      <label className="field"><span>Current balance</span><input name="balance" inputMode="decimal" placeholder="$0" defaultValue={loan?.balance ?? ""} /></label>
      <label className="field"><span>Monthly payment</span><input name="payment" inputMode="decimal" placeholder="$0" defaultValue={loan?.payment ?? ""} /></label>
      <label className="field"><span>Payment due day</span><input name="paymentDay" type="number" min="1" max="31" inputMode="numeric" placeholder="Day of the month, 1 to 31" defaultValue={loan?.paymentDay ?? ""} /></label>
      <label className="field"><span>Insurance payment</span><input name="insurancePayment" inputMode="decimal" placeholder="$0" defaultValue={loan?.insurancePayment ?? ""} /></label>
      <label className="field"><span>Insurance repeats</span>
        <select name="insuranceFrequency" defaultValue={loan?.insuranceFrequency || "Yearly"}>
          {INSURANCE_FREQUENCIES.map((frequency) => <option key={frequency}>{frequency}</option>)}
        </select>
      </label>
      <label className="field"><span>Next insurance due date</span><input name="insuranceDue" type="date" defaultValue={loan?.insuranceDue || ""} /></label>
      <label className="field"><span>Maturity</span><input name="maturity" type="date" defaultValue={loan?.maturity || ""} /></label>
      <label className="field"><span>Loan number</span><input name="loanNumber" defaultValue={loan?.loanNumber || ""} /></label>
      <label className="field"><span>Terms status</span>
        <select name="termsStatus" defaultValue={loan?.termsStatus || "Needs verification"}>
          <option>Needs verification</option>
          <option>Verified</option>
        </select>
      </label>
      <label className="field wide"><span>Terms for this property</span><textarea name="terms" defaultValue={loan?.terms || ""} placeholder="Anything specific to this house" /></label>
      <p className="field wide form-note">Monthly payments and insurance go on the calendar automatically from the due day and due date.</p>
    </div>
  )
}
