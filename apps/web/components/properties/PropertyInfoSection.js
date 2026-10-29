"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { POLICY_BILLING, POLICY_STATUSES, POLICY_TYPES, TAX_YEAR_MAX, TAX_YEAR_MIN, UTILITY_CHOICES, insurancePolicies, policyActive, policyName, policyPaymentAmount, policyTitle, propertyUtilities, taxRows, taxYears, teamYear } from "@synergifund/shared"
import { FormSheet } from "../ui/FormSheet"
import { StatusPill } from "../ui/StatusPill"
import { api } from "../../lib/api"
import { dollars } from "../../lib/format"
import { useApi } from "../../lib/useApi"

// Property Info: the reference details for one property in one place: ownership, taxes (one row per year), insurance
// policies (moved here from the loans) and utilities. The owner is the property's company (Deal › Company), or a name typed for an owner that is
// not a company in SynergiFund; the purchase date is the same field used everywhere else.

const DAY = /^\d{4}-\d{2}-\d{2}$/

function dayLabel(value) {
  const text = String(value || "")
  if (!DAY.test(text.slice(0, 10))) return text
  const [year, month, day] = text.slice(0, 10).split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function shown(value, empty = "Not entered") {
  return value == null || value === "" ? <span className="info-empty">{empty}</span> : value
}

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

// Where a due date stands today: overdue (not marked paid), due this week, or later.
function dueState(due) {
  const day = String(due || "").slice(0, 10)
  if (!DAY.test(day)) return ""
  const today = todayKey()
  if (day < today) return "overdue"
  const week = new Date()
  week.setDate(week.getDate() + 7)
  return day <= `${week.getFullYear()}-${String(week.getMonth() + 1).padStart(2, "0")}-${String(week.getDate()).padStart(2, "0")}` ? "soon" : "later"
}

// A day a year later (Feb 29 becomes Feb 28).
function yearLater(value) {
  const [year, month, day] = String(value || "").slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return ""
  const last = new Date(year + 1, month, 0).getDate()
  return `${year + 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`
}

// Where a policy's expiration date stands today: expired, this week, within 30 days, or later. Only an active policy
// (not marked Expired or Cancelled) is flagged.
function expiry(policy) {
  if (!policyActive(policy)) return ""
  const day = String(policy.expirationDate || "").slice(0, 10)
  if (!DAY.test(day)) return ""
  const state = dueState(day)
  if (state === "overdue") return "expired"
  if (state === "soon") return "soon"
  const month = new Date()
  month.setDate(month.getDate() + 30)
  return day <= `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(month.getDate()).padStart(2, "0")}` ? "month" : "later"
}

function ExpiryNote({ policy }) {
  const state = expiry(policy)
  if (state === "expired") return <small className="info-overdue">Expired · renew it, fix the dates or set its status to Expired</small>
  if (state === "soon") return <small className="info-soon">Expires this week</small>
  if (state === "month") return <small className="info-soon">Expires within 30 days</small>
  return null
}

const monthlyText = (value) => (value == null ? "" : `${dollars(value)} / month`)

// A count of payments typed in the policy form: a whole number, blank for 0.
function paymentCount(value) {
  const text = String(value ?? "").trim()
  if (!text) return { value: 0 }
  return /^\d+$/.test(text) && Number(text) <= 1000 ? { value: Number(text) } : { error: true }
}

function amount(value) {
  const text = String(value ?? "").replace(/[$,\s]/g, "")
  if (text === "") return { value: null }
  const number = Number(text)
  return Number.isFinite(number) && number >= 0 ? { value: Math.round(number * 100) / 100 } : { error: true }
}

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase()

export function PropertyInfoSection({ property, company = null, writable, canPay = false, onChanged }) {
  const [editing, setEditing] = useState("")
  const [utility, setUtility] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [paying, setPaying] = useState(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const policies = insurancePolicies(property)
  const utilities = propertyUtilities(property.utilities)
  const taxes = taxRows(property)

  async function save(body) {
    await api(`/properties/${property.id}`, { method: "PATCH", body })
    setEditing("")
    setUtility(null)
    onChanged?.()
  }

  async function removePolicy(item) {
    if (!window.confirm(`Remove the ${policyName(item)} policy from this property?`)) return
    setError("")
    setMessage("")
    try {
      await api(`/properties/${property.id}/insurance/${item.id}`, { method: "DELETE" })
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  async function removeUtility(item) {
    if (!window.confirm(`Remove ${item.name} from this property?`)) return
    setError("")
    try {
      await save({ utilities: utilities.filter((entry) => entry.name !== item.name) })
    } catch (err) {
      setError(err.message)
    }
  }

  const edit = (key) => (writable ? <button type="button" className="tool" onClick={() => setEditing(key)}>Edit</button> : null)
  // Mark paid: the payment goes on the cost sheet (a year's property taxes, or a policy's payment; a renewed policy's
  // dates move on a year).
  const pay = (kind, item = null) => (canPay && (kind === "tax" ? taxYears(property).some((row) => row.propertyTaxes != null) : true)
    ? <button type="button" className="tool info-pay" onClick={() => { setMessage(""); setPaying({ kind, policy: item }) }}>Mark paid</button>
    : null)
  return (
    <div className="property-info">
      {error && <p className="banner">{error}</p>}
      {message && <p className="info-message">{message}</p>}
      <section className="panel property-card info-card">
        <div className="property-card-head"><h2>Ownership</h2>{edit("ownership")}</div>
        <dl className="info-facts">
          <div>
            <dt>Property owner</dt>
            {company ? (
              <>
                <dd><Link href={`/companies/${company.id}`} className="property-company">{company.name}</Link></dd>
                <small>The company on the deal{[company.entityType, company.stateOfFormation].filter(Boolean).length ? ` · ${[company.entityType, company.stateOfFormation].filter(Boolean).join(", ")}` : ""}</small>
                {property.ownerEntity && !same(property.ownerEntity, company.name) && <small>Entered before as “{property.ownerEntity}”</small>}
              </>
            ) : (
              <>
                <dd>{shown(property.ownerEntity)}</dd>
                {property.ownerEntity && <small>Not a company in SynergiFund yet · <Link href="/companies">Companies</Link></small>}
              </>
            )}
          </div>
          <div><dt>Purchase date</dt><dd>{shown(property.purchaseDate ? dayLabel(property.purchaseDate) : "")}</dd></div>
        </dl>
      </section>

      <section className="panel property-card info-card">
        <div className="property-card-head"><h2>Taxes</h2><span className="row-actions">{pay("tax")}{edit("taxes")}</span></div>
        <dl className="info-facts">
          <div className="info-wide"><dt>Tax parcel/account #</dt><dd>{shown(property.taxParcel, "Optional")}</dd></div>
        </dl>
        <table className="info-taxes">
          <thead><tr><th scope="col">Year</th><th scope="col">Property taxes</th><th scope="col">Tax assessment</th></tr></thead>
          <tbody>
            {taxes.map((row) => (
              <tr key={row.year} data-year={row.year}>
                <th scope="row">{row.year}{row.paidOn && <small>Paid {dayLabel(row.paidOn)}</small>}</th>
                <td>{shown(row.propertyTaxes == null ? "" : dollars(row.propertyTaxes))}</td>
                <td>{shown(row.taxAssessment == null ? "" : dollars(row.taxAssessment))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="info-hint">{canPay ? "One row per year, newest first. Mark paid puts a year's property taxes on the cost sheet." : "One row per year, newest first."}</p>
      </section>

      <section className="panel property-card info-card info-insurance">
        <div className="property-card-head">
          <h2>Insurance</h2>
          {writable && <button type="button" className="tool" onClick={() => setPolicy({ adding: true })}>Add policy</button>}
        </div>
        {policies.length === 0 && <p className="info-none">No insurance policies yet. Most properties carry two or three, like Builder's Risk, Liability and Flood.</p>}
        <ul className="info-policies">
          {policies.map((item) => (
            <li key={item.id} data-policy={item.id}>
              <div className="info-policy-head">
                <div>
                  <strong>{policyName(item)}</strong>
                  {!item.type && writable && <small className="info-soon">Choose the category with Edit</small>}
                </div>
                {(writable || canPay) && (
                  <span className="row-actions">
                    {pay("insurance", item)}
                    {writable && <button type="button" className="tool" onClick={() => setPolicy({ item })}>Edit</button>}
                    {writable && <button type="button" className="tool danger" onClick={() => removePolicy(item)}>Remove</button>}
                  </span>
                )}
              </div>
              <dl className="info-facts">
                <div><dt>Property</dt><dd>{property.address}</dd></div>
                <div><dt>Borrower entity</dt><dd>{shown(item.borrowerEntity)}</dd></div>
                <div><dt>Payee</dt><dd>{shown(item.payee)}</dd></div>
                <div><dt>Carrier</dt><dd>{shown(item.carrier)}</dd></div>
                <div><dt>Policy #</dt><dd>{shown(item.policyNumber)}</dd></div>
                <div><dt>Account code</dt><dd>{shown(item.accountCode)}</dd></div>
                <div><dt>Category</dt><dd>{shown(item.type)}</dd></div>
                <div><dt>Monthly payment</dt><dd>{shown(monthlyText(item.monthlyPayment))}</dd></div>
                <div className="info-wide"><dt>Notes</dt><dd className="info-notes">{shown(item.notes)}</dd></div>
                <div><dt>Billing frequency</dt><dd>{item.billing}</dd></div>
                <div><dt>Effective date</dt><dd>{shown(item.effectiveDate ? dayLabel(item.effectiveDate) : "")}</dd></div>
                <div className={expiry(item) === "expired" ? "is-overdue" : undefined}><dt>Expiration date</dt><dd>{shown(item.expirationDate ? dayLabel(item.expirationDate) : "")}</dd><ExpiryNote policy={item} /></div>
                <div><dt>Status</dt><dd>{item.status ? <StatusPill>{item.status}</StatusPill> : shown("", "Not set")}</dd></div>
                <div><dt>No. of payments</dt><dd>{item.paymentsTotal}</dd></div>
                <div><dt>No. of payments paid</dt><dd>{item.paymentsPaid}</dd>{item.paidOn && <small>Last paid {dayLabel(item.paidOn)}</small>}</div>
                <div><dt>No. of payments left</dt><dd>{item.paymentsLeft}</dd></div>
                <div><dt>Account balance</dt><dd>{shown(item.accountBalance == null ? "" : dollars(item.accountBalance))}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <p className="info-hint">An active policy's expiration date shows on the calendar, and in Needs attention on the Overview from 30 days before. Mark paid puts a payment on the cost sheet and adds one to No. of Payments Paid.</p>
      </section>

      <section className="panel property-card info-card">
        <div className="property-card-head">
          <h2>Utilities</h2>
          {writable && <button type="button" className="tool" onClick={() => setUtility({ adding: true })}>Add Utility</button>}
        </div>
        <ul className="info-utilities">
          {utilities.map((item) => (
            <li key={item.name}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.provider || <span className="info-empty">Provider not entered</span>}{item.account ? ` · Account # ${item.account}` : ""}</span>
              </div>
              {writable && (
                <span className="row-actions">
                  <button type="button" className="tool" onClick={() => setUtility({ item })}>Edit</button>
                  {!item.fixed && <button type="button" className="tool danger" onClick={() => removeUtility(item)}>Remove</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {editing === "ownership" && <OwnershipForm property={property} company={company} onClose={() => setEditing("")} onSave={save} />}
      {editing === "taxes" && <TaxForm property={property} onClose={() => setEditing("")} onSave={save} />}
      {policy && <PolicyForm property={property} target={policy} onClose={() => setPolicy(null)} onSaved={() => { setPolicy(null); onChanged?.() }} />}
      {utility && <UtilityForm utilities={utilities} target={utility} onClose={() => setUtility(null)} onSave={save} />}
      {paying && (
        <PaidForm
          property={property}
          kind={paying.kind}
          policy={paying.policy}
          onClose={() => setPaying(null)}
          onPaid={(data) => {
            setPaying(null)
            setMessage(paying.kind === "tax"
              ? `Property taxes ${data.year} paid: ${dollars(data.expense.amount)} is on the cost sheet (Expenses tab).`
              : `${policyTitle(paying.policy)} paid: ${dollars(data.expense.amount)} is on the cost sheet (Expenses tab). Payment ${data.paymentsPaid}${data.paymentsTotal ? ` of ${data.paymentsTotal}` : ""}.${data.expires ? ` Renewed, now expires ${dayLabel(data.expires)}.` : ""}`)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

function PaidForm({ property, kind, policy, onClose, onPaid }) {
  const tax = kind === "tax"
  // The years with property taxes entered; this year to start with, or the newest one.
  const years = tax ? taxYears(property).filter((row) => row.propertyTaxes != null) : []
  const [year, setYear] = useState(() => String((years.find((row) => row.year === teamYear()) || years[0])?.year || ""))
  const yearTaxes = (value) => years.find((row) => String(row.year) === value)?.propertyTaxes ?? ""
  const stored = tax ? yearTaxes(year) : policyPaymentAmount(policy)
  const [cost, setCost] = useState(stored ?? "")
  const [date, setDate] = useState(todayKey())
  // An annual policy paid near (or after) its expiration date is usually the renewal.
  const renewable = !tax && policy.billing === "Annual" && DAY.test(String(policy.expirationDate || ""))
  const [renew, setRenew] = useState(renewable && ["expired", "soon", "month"].includes(expiry(policy)))
  const { error, setError, pending, run } = useSave(async (body) => {
    const data = await api(`/properties/${property.id}/paid`, { method: "POST", body })
    onPaid(data)
  })
  const hint = tax
    ? "It goes on the cost sheet as property taxes, and the year shows when it was paid."
    : `The payment goes on the cost sheet as insurance (${policyName(policy)}), and No. of Payments Paid goes from ${policy.paymentsPaid} to ${policy.paymentsPaid + 1}${policy.paymentsTotal ? ` of ${policy.paymentsTotal}` : ""}.`
  return (
    <FormSheet eyebrow={property.address} title={tax ? "Property tax paid" : "Insurance paid"} hint={hint} onClose={onClose} pending={pending} error={error} submitLabel="Mark paid"
      onSubmit={(event) => {
        event.preventDefault()
        const read = amount(cost)
        if (read.error || !(read.value > 0)) return setError("Enter the amount paid, like 1640.")
        if (!date) return setError("Enter the day it was paid.")
        run(tax ? { kind, year: Number(year), amount: read.value, date } : { kind, policyId: policy.id, amount: read.value, date, renew: renewable && renew })
      }}>
      <div className="form-grid">
        {tax && (
          <label className="field wide"><span>Tax year</span>
            <select name="year" value={year} onChange={(event) => { setYear(event.target.value); setCost(yearTaxes(event.target.value)) }}>
              {years.map((row) => <option key={row.year} value={String(row.year)}>{row.year} · {dollars(row.propertyTaxes)}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Amount paid</span><input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="$0" /></label>
        <label className="field"><span>Paid on</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        {renewable && (
          <label className="field-check wide">
            <input type="checkbox" checked={renew} onChange={(event) => setRenew(event.target.checked)} />
            <span>Renewed for another year: effective {dayLabel(policy.expirationDate)}, expires {dayLabel(yearLater(policy.expirationDate))}</span>
          </label>
        )}
      </div>
    </FormSheet>
  )
}

// A form sheet that shows the save error and keeps itself open until the save works.
function useSave(onSave) {
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  async function run(body) {
    setPending(true)
    setError("")
    try {
      await onSave(body)
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }
  return { error, setError, pending, run }
}

// The owner is chosen from the companies, so Property Info and Deal › Company are always the same one.
// "Someone else" is for an owner that is not a company in SynergiFund (a person, or an LLC not added yet).
const OTHER = "other"

function OwnershipForm({ property, company, onClose, onSave }) {
  const start = DAY.test(String(property.purchaseDate || "").slice(0, 10)) ? String(property.purchaseDate).slice(0, 10) : ""
  const list = useApi("/companies")
  const choices = [...(list.data?.items || [])]
  if (company && !choices.some((item) => item.id === company.id)) choices.unshift({ id: company.id, name: company.name })
  // A typed owner with the same name as a company starts on that company.
  const typedMatch = !company && property.ownerEntity ? choices.find((item) => same(item.name, property.ownerEntity)) : null
  const [picked, setPicked] = useState(null)
  const choice = picked ?? (company ? company.id : typedMatch ? typedMatch.id : property.ownerEntity ? OTHER : "")
  const [owner, setOwner] = useState(company ? "" : property.ownerEntity || "")
  const [date, setDate] = useState(start)
  const { error, pending, run } = useSave(onSave)
  const purchase = date !== start ? { purchaseDate: date } : {}

  function submit(event) {
    event.preventDefault()
    if (choice === OTHER) {
      const name = owner.trim().replace(/\s+/g, " ")
      // Typing the name of a company links that company instead.
      const match = choices.find((item) => same(item.name, name))
      return run(match ? { companyId: match.id, ownerEntity: "", ...purchase } : { companyId: "none", ownerEntity: name, ...purchase })
    }
    run(choice ? { companyId: choice, ownerEntity: "", ...purchase } : { companyId: "none", ownerEntity: "", ...purchase })
  }

  return (
    <FormSheet eyebrow={property.address} title="Ownership" hint={property.purchaseDate && !start ? `The purchase date on file is "${property.purchaseDate}". Pick the exact day to replace it.` : "The owner is the property's company, the same one shown under Deal › Company. The property's documents show under that company."} onClose={onClose} pending={pending} error={error} submitLabel="Save"
      onSubmit={submit}>
      <div className="form-grid">
        <label className="field wide"><span>Property owner</span>
          <select value={choice} onChange={(event) => setPicked(event.target.value)} disabled={list.loading && !choices.length}>
            <option value="">Not entered</option>
            {choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            <option value={OTHER}>Someone else (type the name)</option>
          </select>
        </label>
        {choice === OTHER && (
          <>
            <label className="field wide"><span>Owner name</span><input value={owner} onChange={(event) => setOwner(event.target.value)} maxLength={200} placeholder="Person or company on the deed" required /></label>
            <p className="chat-form-hint wide">To keep an LLC's documents and properties together, add it on <Link href="/companies">Companies</Link> and choose it here.</p>
          </>
        )}
        <label className="field"><span>Purchase date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
    </FormSheet>
  )
}

// A typed year: four digits in range, or null.
function typedYear(value) {
  const text = String(value ?? "").trim()
  return /^\d{4}$/.test(text) && Number(text) >= TAX_YEAR_MIN && Number(text) <= TAX_YEAR_MAX ? Number(text) : null
}

// Newest year first; a row whose year isn't typed yet stays at the bottom.
const byYear = (a, b) => (typedYear(b.year) ?? -1) - (typedYear(a.year) ?? -1)

// The parcel/account # (the property's) and one row per year: Year, Property Taxes and Tax Assessment. This year and
// the two before it are always there; Add Year adds the year before the oldest. Rows sort by year when a year is typed.
function TaxForm({ property, onClose, onSave }) {
  const keys = useRef(0)
  const row = (year, propertyTaxes = null, taxAssessment = null, added = false) => ({
    key: (keys.current += 1), year: String(year), propertyTaxes: propertyTaxes == null ? "" : String(propertyTaxes), taxAssessment: taxAssessment == null ? "" : String(taxAssessment), added,
  })
  const [parcel, setParcel] = useState(property.taxParcel || "")
  const [rows, setRows] = useState(() => taxRows(property).map((item) => row(item.year, item.propertyTaxes, item.taxAssessment)))
  const { error, setError, pending, run } = useSave(onSave)
  const change = (key, field) => (event) => setRows((list) => list.map((item) => (item.key === key ? { ...item, [field]: event.target.value } : item)))
  function addYear() {
    const years = rows.map((item) => typedYear(item.year)).filter((year) => year != null)
    const year = years.length ? Math.min(...years) - 1 : teamYear()
    setRows((list) => [...list, row(year >= TAX_YEAR_MIN ? year : "", null, null, true)])
  }
  function submit(event) {
    event.preventDefault()
    const seen = new Set()
    const list = []
    for (const item of rows) {
      const taxes = amount(item.propertyTaxes)
      const assessment = amount(item.taxAssessment)
      if (!item.year.trim()) {
        if (!item.propertyTaxes.trim() && !item.taxAssessment.trim()) continue
        return setError("Enter the year for each row, like 2026.")
      }
      const year = typedYear(item.year)
      if (year == null) return setError("Enter each year as four digits, like 2026.")
      if (seen.has(year)) return setError(`${year} is in the list twice.`)
      seen.add(year)
      if (taxes.error) return setError(`Enter the property taxes for ${year} in dollars, like 2310.`)
      if (assessment.error) return setError(`Enter the tax assessment for ${year} in dollars, like 185000.`)
      list.push({ year, propertyTaxes: taxes.value, taxAssessment: assessment.value })
    }
    run({ taxParcel: parcel.trim(), taxYears: list })
  }
  return (
    <FormSheet eyebrow={property.address} title="Taxes" hint="The property taxes and the tax assessment for each year, newest first. The parcel/account # is the property's, for every year." onClose={onClose} pending={pending} error={error} submitLabel="Save"
      onSubmit={submit}>
      <div className="form-grid">
        <label className="field wide"><span>Tax parcel/account # (optional)</span><input name="taxParcel" value={parcel} onChange={(event) => setParcel(event.target.value)} maxLength={120} /></label>
        <div className="wide tax-years" role="group" aria-label="Taxes by year">
          <div className="tax-years-grid">
            <div className="tax-year-head" aria-hidden="true"><span>Year</span><span>Property Taxes ($)</span><span>Tax Assessment ($)</span><span /></div>
            {rows.map((item) => (
              <div className="tax-year-row" key={item.key} data-tax-row="">
                <label className="field tax-year"><span>Year</span><input name="year" inputMode="numeric" maxLength={4} value={item.year} onChange={change(item.key, "year")} onBlur={() => setRows((list) => [...list].sort(byYear))} placeholder="2026" autoFocus={item.added} /></label>
                <label className="field"><span className="keep-case">Property Taxes ($)</span><input name="propertyTaxes" inputMode="decimal" value={item.propertyTaxes} onChange={change(item.key, "propertyTaxes")} placeholder="$0" /></label>
                <label className="field"><span className="keep-case">Tax Assessment ($)</span><input name="taxAssessment" inputMode="decimal" value={item.taxAssessment} onChange={change(item.key, "taxAssessment")} placeholder="$0" /></label>
                <button type="button" className="tool danger tax-year-remove" onClick={() => setRows((list) => list.filter((entry) => entry.key !== item.key))} aria-label={`Remove ${item.year.trim() || "this row"}`}>Remove</button>
              </div>
            ))}
          </div>
          {!rows.length && <p className="info-none">No years. Add one with Add Year.</p>}
          <button type="button" className="tool tax-year-add" onClick={addYear}>Add Year</button>
        </div>
      </div>
    </FormSheet>
  )
}

// Add or edit one insurance policy, its fields in the order of the card. No. of Payments Left and the Account Balance
// are worked out as you type.
function PolicyForm({ property, target, onClose, onSaved }) {
  const adding = Boolean(target.adding)
  const start = target.item || {}
  // The monthly payment shows to the cent; left as it was, the saved amount (a twelfth of an annual premium) is kept.
  const startMonthly = start.monthlyPayment == null ? "" : String(Math.round(start.monthlyPayment * 100) / 100)
  const [borrower, setBorrower] = useState(start.borrowerEntity || "")
  const [payee, setPayee] = useState(start.payee || "")
  const [carrier, setCarrier] = useState(start.carrier || "")
  const [number, setNumber] = useState(start.policyNumber || "")
  const [code, setCode] = useState(start.accountCode || "")
  const [type, setType] = useState(start.type || "")
  const [monthly, setMonthly] = useState(startMonthly)
  const [notes, setNotes] = useState(start.notes || "")
  const [billing, setBilling] = useState(start.billing || "Annual")
  const [effective, setEffective] = useState(start.effectiveDate || "")
  const [expires, setExpires] = useState(start.expirationDate || "")
  const [status, setStatus] = useState(adding ? "Active" : start.status || "")
  const [total, setTotal] = useState(adding ? "" : String(start.paymentsTotal ?? 0))
  const [paid, setPaid] = useState(adding ? "" : String(start.paymentsPaid ?? 0))
  const { error, setError, pending, run } = useSave(async (body) => {
    if (adding) await api(`/properties/${property.id}/insurance`, { method: "POST", body })
    else await api(`/properties/${property.id}/insurance/${start.id}`, { method: "PATCH", body })
    onSaved()
  })
  const readMonthly = () => (monthly === startMonthly && start.monthlyPayment != null ? { value: start.monthlyPayment } : amount(monthly))
  const counts = [paymentCount(total), paymentCount(paid)]
  const left = counts.some((item) => item.error) ? null : Math.max(0, counts[0].value - counts[1].value)
  const monthlyRead = readMonthly()
  const balance = left == null || monthlyRead.error || monthlyRead.value == null ? null : left * monthlyRead.value
  return (
    <FormSheet eyebrow={property.address} title={adding ? "Add policy" : `Edit ${start.type || "policy"}`} hint="An active policy's expiration date shows on the calendar, and in Needs attention from 30 days before. Mark paid adds one to No. of Payments Paid." onClose={onClose} pending={pending} error={error} submitLabel={adding ? "Add policy" : "Save"}
      onSubmit={(event) => {
        event.preventDefault()
        if (!type) return setError("Choose the category.")
        const read = readMonthly()
        if (read.error) return setError("Enter the monthly payment in dollars, like 136.67.")
        if (effective && expires && expires < effective) return setError("The expiration date is before the effective date.")
        if (counts[0].error) return setError("Enter the No. of Payments as a whole number, like 12.")
        if (counts[1].error) return setError("Enter the No. of Payments Paid as a whole number, like 3.")
        run({
          borrowerEntity: borrower.trim(), payee: payee.trim(), carrier: carrier.trim(), policyNumber: number.trim(), accountCode: code.trim(), type,
          monthlyPayment: read.value, notes: notes.trim(), billing, effectiveDate: effective, expirationDate: expires, status,
          paymentsTotal: counts[0].value, paymentsPaid: counts[1].value,
        })
      }}>
      <div className="form-grid">
        <div className="field"><span>Property</span><p className="field-static" data-field="property">{property.address}</p></div>
        <label className="field"><span>Borrower entity</span><input name="borrowerEntity" value={borrower} onChange={(event) => setBorrower(event.target.value)} maxLength={160} /></label>
        <label className="field"><span>Payee</span><input name="payee" value={payee} onChange={(event) => setPayee(event.target.value)} maxLength={160} /></label>
        <label className="field"><span>Carrier</span><input name="carrier" value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={120} placeholder="For example, Coastal Mutual" /></label>
        <label className="field"><span>Policy #</span><input name="policyNumber" value={number} onChange={(event) => setNumber(event.target.value)} maxLength={120} /></label>
        <label className="field"><span>Account code</span><input name="accountCode" value={code} onChange={(event) => setCode(event.target.value)} maxLength={120} /></label>
        <label className="field"><span>Category</span>
          <select name="type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Choose</option>
            {POLICY_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span>Monthly payment ($)</span><input name="monthlyPayment" inputMode="decimal" value={monthly} onChange={(event) => setMonthly(event.target.value)} placeholder="$0" /></label>
        <label className="field wide"><span>Notes</span><textarea name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Coverage, deductible, agent…" /></label>
        <label className="field"><span>Billing frequency</span>
          <select name="billing" value={billing} onChange={(event) => setBilling(event.target.value)}>{POLICY_BILLING.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className="field"><span>Effective date</span><input name="effectiveDate" type="date" value={effective} onChange={(event) => setEffective(event.target.value)} /></label>
        <label className="field"><span>Expiration date</span><input name="expirationDate" type="date" value={expires} onChange={(event) => setExpires(event.target.value)} /></label>
        <label className="field"><span>Status</span>
          <select name="status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Not set</option>
            {POLICY_STATUSES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span className="keep-case">No. of Payments</span><input name="paymentsTotal" inputMode="numeric" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="0" /></label>
        <label className="field"><span className="keep-case">No. of Payments Paid</span><input name="paymentsPaid" inputMode="numeric" value={paid} onChange={(event) => setPaid(event.target.value)} placeholder="0" /></label>
        <div className="field"><span className="keep-case">No. of Payments Left</span><p className="field-static" data-field="paymentsLeft">{left == null ? "—" : left}</p></div>
        <div className="field"><span>Account balance</span><p className="field-static" data-field="accountBalance">{balance == null ? "—" : dollars(balance)}</p></div>
      </div>
    </FormSheet>
  )
}

function UtilityForm({ utilities, target, onClose, onSave }) {
  const adding = Boolean(target.adding)
  const taken = new Set(utilities.map((item) => item.name.toLowerCase()))
  const choices = UTILITY_CHOICES.filter((name) => !taken.has(name.toLowerCase()))
  const [kind, setKind] = useState(adding ? choices[0] || "Other" : target.item.name)
  const [custom, setCustom] = useState("")
  const [provider, setProvider] = useState(adding ? "" : target.item.provider || "")
  const [account, setAccount] = useState(adding ? "" : target.item.account || "")
  const { error, setError, pending, run } = useSave(onSave)
  return (
    <FormSheet eyebrow="Utilities" title={adding ? "Add Utility" : target.item.name} onClose={onClose} pending={pending} error={error} submitLabel={adding ? "Add" : "Save"}
      onSubmit={(event) => {
        event.preventDefault()
        if (adding) {
          const name = (kind === "Other" ? custom : kind).replace(/\s+/g, " ").trim()
          if (!name) return setError("Name the utility, for example Pest control.")
          if (taken.has(name.toLowerCase())) return setError(`${name} is already on this property.`)
          return run({ utilities: [...utilities, { name, provider: provider.trim(), account: account.trim() }] })
        }
        run({ utilities: utilities.map((item) => (item.name === target.item.name ? { ...item, provider: provider.trim(), account: account.trim() } : item)) })
      }}>
      <div className="form-grid">
        {adding && (
          <label className="field"><span>Utility</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {choices.map((name) => <option key={name}>{name}</option>)}
              <option value="Other">Other (type a name)</option>
            </select>
          </label>
        )}
        {adding && kind === "Other" && <label className="field"><span>Name</span><input value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={40} placeholder="For example, Pest control" /></label>}
        <label className="field"><span>Provider name</span><input value={provider} onChange={(event) => setProvider(event.target.value)} maxLength={120} /></label>
        <label className="field"><span>Account # (optional)</span><input value={account} onChange={(event) => setAccount(event.target.value)} maxLength={120} /></label>
      </div>
    </FormSheet>
  )
}
