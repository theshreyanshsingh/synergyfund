"use client"

import { useState } from "react"
import Link from "next/link"
import { POLICY_BILLING, POLICY_TYPES, UTILITY_CHOICES, insurancePolicies, policyName, policyTitle, propertyUtilities } from "@synergifund/shared"
import { FormSheet } from "../ui/FormSheet"
import { api } from "../../lib/api"
import { dollars } from "../../lib/format"
import { useApi } from "../../lib/useApi"

// Property Info: the reference details for one property in one place: ownership, taxes, insurance policies (moved
// here from the loans) and utilities. The owner is the property's company (Deal › Company), or a name typed for an owner that is
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

// Where a policy's expiration date stands today: expired, this week, within 30 days, or later.
function expiry(policy) {
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
  if (state === "expired") return <small className="info-overdue">Expired · renew it or update the dates</small>
  if (state === "soon") return <small className="info-soon">Expires this week</small>
  if (state === "month") return <small className="info-soon">Expires within 30 days</small>
  return null
}

function premiumText(policy) {
  if (policy.premium == null) return ""
  return `${dollars(policy.premium)}${policy.billing === "Monthly" ? " a month" : policy.billing === "One-time" ? " one-time" : " a year"}`
}

function DueNote({ due, paidOn, label }) {
  const state = dueState(due)
  return (
    <>
      {state === "overdue" && <small className="info-overdue">Overdue · not marked paid</small>}
      {state === "soon" && <small className="info-soon">Due this week</small>}
      {state === "later" && <small>{label}</small>}
      {paidOn && <small>Last paid {dayLabel(paidOn)}</small>}
    </>
  )
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
  // Mark paid: the payment goes on the cost sheet (the tax due date moves on a year; a renewed policy's dates too).
  const pay = (kind, item = null) => (canPay && (kind === "tax" ? property.taxAmount != null || property.taxDueDate : true)
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
          <div><dt>Tax amount</dt><dd>{shown(property.taxAmount == null ? "" : `${dollars(property.taxAmount)} a year`)}</dd></div>
          <div><dt>Tax parcel/account #</dt><dd>{shown(property.taxParcel, "Optional")}</dd></div>
          <div className={dueState(property.taxDueDate) === "overdue" ? "is-overdue" : undefined}><dt>Tax due date</dt><dd>{shown(property.taxDueDate ? dayLabel(property.taxDueDate) : "", "Optional")}</dd><DueNote due={property.taxDueDate} paidOn={property.taxPaidOn} label="Next payment due" /></div>
        </dl>
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
                  <strong>{item.type || "Insurance policy"}</strong>
                  <span>{item.carrier || <span className="info-empty">Carrier not entered</span>}{item.policyNumber ? ` · Policy # ${item.policyNumber}` : ""}</span>
                  {!item.type && writable && <small className="info-soon">Choose the policy type with Edit</small>}
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
                <div>
                  <dt>Premium</dt>
                  <dd>{shown(premiumText(item))}</dd>
                  {item.premium != null && item.billing === "Monthly" && <small>{dollars(item.premium * 12)} a year</small>}
                  {item.paidOn && <small>Last paid {dayLabel(item.paidOn)}</small>}
                </div>
                <div><dt>Billing frequency</dt><dd>{item.billing}</dd></div>
                <div><dt>Effective date</dt><dd>{shown(item.effectiveDate ? dayLabel(item.effectiveDate) : "")}</dd></div>
                <div className={expiry(item) === "expired" ? "is-overdue" : undefined}><dt>Expiration date</dt><dd>{shown(item.expirationDate ? dayLabel(item.expirationDate) : "")}</dd><ExpiryNote policy={item} /></div>
                {item.notes && <div className="info-wide"><dt>Notes</dt><dd className="info-notes">{item.notes}</dd></div>}
              </dl>
            </li>
          ))}
        </ul>
        <p className="info-hint">Each policy's expiration date shows on the calendar, and in Needs attention on the Overview from 30 days before. Mark paid puts the premium on the cost sheet.</p>
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
              ? `Property tax paid: ${dollars(data.expense.amount)} is on the cost sheet (Expenses tab).${data.nextDue ? ` Next due ${dayLabel(data.nextDue)}.` : ""}`
              : `${policyTitle(paying.policy)} paid: ${dollars(data.expense.amount)} is on the cost sheet (Expenses tab).${data.expires ? ` Renewed, now expires ${dayLabel(data.expires)}.` : ""}`)
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}

function PaidForm({ property, kind, policy, onClose, onPaid }) {
  const tax = kind === "tax"
  const stored = tax ? property.taxAmount : policy.premium
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
    ? `It goes on the cost sheet as property taxes${property.taxDueDate ? `, and the due date moves on from ${dayLabel(property.taxDueDate)} to the next one` : ""}.`
    : `The premium goes on the cost sheet as insurance (${policyName(policy)}).`
  return (
    <FormSheet eyebrow={property.address} title={tax ? "Property tax paid" : "Insurance paid"} hint={hint} onClose={onClose} pending={pending} error={error} submitLabel="Mark paid"
      onSubmit={(event) => {
        event.preventDefault()
        const read = amount(cost)
        if (read.error || !(read.value > 0)) return setError("Enter the amount paid, like 1640.")
        if (!date) return setError("Enter the day it was paid.")
        run(tax ? { kind, amount: read.value, date } : { kind, policyId: policy.id, amount: read.value, date, renew: renewable && renew })
      }}>
      <div className="form-grid">
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

function TaxForm({ property, onClose, onSave }) {
  const [tax, setTax] = useState(property.taxAmount ?? "")
  const [parcel, setParcel] = useState(property.taxParcel || "")
  const [due, setDue] = useState(property.taxDueDate || "")
  const { error, setError, pending, run } = useSave(onSave)
  return (
    <FormSheet eyebrow={property.address} title="Taxes" hint="The yearly property tax. The due date shows on the calendar each year." onClose={onClose} pending={pending} error={error} submitLabel="Save"
      onSubmit={(event) => {
        event.preventDefault()
        const read = amount(tax)
        if (read.error) return setError("Enter the tax amount in dollars, like 2310.")
        run({ taxAmount: read.value, taxParcel: parcel.trim(), taxDueDate: due })
      }}>
      <div className="form-grid">
        <label className="field"><span>Tax amount (yearly)</span><input inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} placeholder="$0" /></label>
        <label className="field"><span>Tax parcel/account # (optional)</span><input value={parcel} onChange={(event) => setParcel(event.target.value)} maxLength={120} /></label>
        <label className="field"><span>Tax due date (optional)</span><input type="date" value={due} onChange={(event) => setDue(event.target.value)} /></label>
      </div>
    </FormSheet>
  )
}

// Add or edit one insurance policy.
function PolicyForm({ property, target, onClose, onSaved }) {
  const adding = Boolean(target.adding)
  const start = target.item || {}
  const [type, setType] = useState(start.type || "")
  const [carrier, setCarrier] = useState(start.carrier || "")
  const [number, setNumber] = useState(start.policyNumber || "")
  const [premium, setPremium] = useState(start.premium ?? "")
  const [billing, setBilling] = useState(start.billing || "Annual")
  const [effective, setEffective] = useState(start.effectiveDate || "")
  const [expires, setExpires] = useState(start.expirationDate || "")
  const [notes, setNotes] = useState(start.notes || "")
  const { error, setError, pending, run } = useSave(async (body) => {
    if (adding) await api(`/properties/${property.id}/insurance`, { method: "POST", body })
    else await api(`/properties/${property.id}/insurance/${start.id}`, { method: "PATCH", body })
    onSaved()
  })
  return (
    <FormSheet eyebrow={property.address} title={adding ? "Add policy" : `Edit ${start.type || "policy"}`} hint="The expiration date shows on the calendar, and in Needs attention from 30 days before." onClose={onClose} pending={pending} error={error} submitLabel={adding ? "Add policy" : "Save"}
      onSubmit={(event) => {
        event.preventDefault()
        if (!type) return setError("Choose the policy type.")
        const read = amount(premium)
        if (read.error) return setError("Enter the premium in dollars, like 1640.")
        if (effective && expires && expires < effective) return setError("The expiration date is before the effective date.")
        run({ type, carrier: carrier.trim(), policyNumber: number.trim(), premium: read.value, billing, effectiveDate: effective, expirationDate: expires, notes: notes.trim() })
      }}>
      <div className="form-grid">
        <label className="field"><span>Policy type</span>
          <select name="type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Choose</option>
            {POLICY_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span>Policy #</span><input name="policyNumber" value={number} onChange={(event) => setNumber(event.target.value)} maxLength={120} /></label>
        <label className="field wide"><span>Carrier</span><input name="carrier" value={carrier} onChange={(event) => setCarrier(event.target.value)} maxLength={120} placeholder="For example, Coastal Mutual" /></label>
        <label className="field"><span>Premium ($)</span><input name="premium" inputMode="decimal" value={premium} onChange={(event) => setPremium(event.target.value)} placeholder="$0" /></label>
        <label className="field"><span>Billing frequency</span>
          <select name="billing" value={billing} onChange={(event) => setBilling(event.target.value)}>{POLICY_BILLING.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <div className="field wide date-pair">
          <label className="field"><span>Effective date</span><input name="effectiveDate" type="date" value={effective} onChange={(event) => setEffective(event.target.value)} /></label>
          <label className="field"><span>Expiration date</span><input name="expirationDate" type="date" value={expires} onChange={(event) => setExpires(event.target.value)} /></label>
        </div>
        <label className="field wide"><span>Notes</span><textarea name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Coverage, deductible, agent…" /></label>
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
