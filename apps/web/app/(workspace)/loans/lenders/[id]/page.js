"use client"

import { use, useState } from "react"
import Link from "next/link"
import { LOAN_LABELS, can } from "@synergifund/shared"
import { FormSheet } from "../../../../../components/ui/FormSheet"
import { StatusPill } from "../../../../../components/ui/StatusPill"
import { Loader } from "../../../../../components/ui/Loader"
import { DetailFrame } from "../../../../../components/ui/DetailFrame"
import { useSession } from "../../../../../components/shell/Providers"
import { api } from "../../../../../lib/api"
import { money } from "../../../../../lib/format"
import { useApi } from "../../../../../lib/useApi"

export default function LenderPage({ params }) {
  const { id } = use(params)
  const session = useSession()
  const detail = useApi(`/lenders/${id}`)
  const [section, setSection] = useState("overview")
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const lender = detail.data?.lender
  const loans = detail.data?.loans || []
  const writable = session?.user && can(session.user, "properties.write")
  if (!lender) return detail.error ? <div className="boot"><p className="banner">{detail.error}</p></div> : <Loader label="Opening lender" />

  async function save(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    const form = new FormData(event.currentTarget)
    try {
      await api(`/lenders/${id}`, { method: "PATCH", body: { name: form.get("name"), terms: form.get("terms") } })
      await Promise.all(loans.map((item) => api(`/loans/${item.id}`, {
        method: "PATCH",
        body: {
          label: form.get(`label-${item.id}`),
          loanNumber: form.get(`loanNumber-${item.id}`),
          balance: form.get(`balance-${item.id}`),
          payment: form.get(`payment-${item.id}`),
          originalAmount: form.get(`originalAmount-${item.id}`),
          maturity: form.get(`maturity-${item.id}`),
          termsStatus: form.get(`termsStatus-${item.id}`),
          terms: form.get(`deal-${item.id}`),
        },
      })))
      setEditing(false)
      detail.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <DetailFrame
      backHref="/loans"
      backLabel="Loans & lenders"
      title={lender.name}
      meta={`${lender.properties} ${lender.properties === 1 ? "property" : "properties"} · ${money(lender.payment)} a month`}
      actions={writable ? <button type="button" className="primary" onClick={() => { setError(""); setEditing(true) }}>Modify</button> : null}
    >
      <div className="property-switch" role="tablist" aria-label="Lender sections">
        <button type="button" role="tab" aria-selected={section === "overview"} className={section === "overview" ? "is-on" : ""} onClick={() => setSection("overview")}>Overview</button>
        <button type="button" role="tab" aria-selected={section === "properties"} className={section === "properties" ? "is-on" : ""} onClick={() => setSection("properties")}>Properties</button>
      </div>

      {section === "overview" && (
        <>
          <section className="property-figures">
            <article className="property-figure"><span>Properties</span><strong>{lender.properties}</strong></article>
            <article className="property-figure"><span>Balances</span><strong>{money(lender.balance)}</strong></article>
            <article className="property-figure"><span>Monthly mortgage</span><strong>{money(lender.payment)}</strong><em>Same loans as Overview</em></article>
          </section>
          <section className="panel property-card">
            <h2>Custom terms</h2>
            <p>{lender.terms || "No terms written yet."}</p>
          </section>
        </>
      )}

      {section === "properties" && (
        <section className="panel property-card">
          <h2>Properties financed here</h2>
          {loans.length === 0 && <p className="property-missing">No property is financed with this lender yet.</p>}
          <ul className="property-scope">
            {loans.map((item) => (
              <li key={item.id}>
                <div>
                  <strong><Link href={`/properties/${item.propertyId}`}>{item.address}</Link></strong>
                  <em>{[item.city, item.label, item.loanNumber, item.maturity && `Matures ${item.maturity}`, item.payment != null && `${money(item.payment)} a month`, item.terms].filter(Boolean).join(" · ")}</em>
                  {(item.propertyLabels || []).length > 0 && <span className="label-row">{item.propertyLabels.map((label) => <StatusPill key={label}>{label}</StatusPill>)}</span>}
                </div>
                <span>{money(item.balance)}</span>
                <StatusPill>{item.label}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <FormSheet eyebrow="Lender" title="Modify lender" hint="Name, terms, and each property loan are saved together." onClose={() => setEditing(false)} onSubmit={save} submitLabel="Save changes" pending={pending} error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Name</span><input name="name" defaultValue={lender.name} required /></label>
            <label className="field wide"><span>Custom terms</span><textarea name="terms" defaultValue={lender.terms || ""} /></label>
            {loans.map((item) => (
              <div key={item.id} className="field wide">
                <span>{item.address}</span>
                <div className="form-grid">
                  <label className="field"><span>Nature</span><input name={`label-${item.id}`} list="loan-labels" defaultValue={item.label || "Financed"} /></label>
                  <label className="field"><span>Loan number</span><input name={`loanNumber-${item.id}`} defaultValue={item.loanNumber || ""} /></label>
                  <label className="field"><span>Balance</span><input name={`balance-${item.id}`} inputMode="decimal" defaultValue={item.balance ?? ""} /></label>
                  <label className="field"><span>Monthly payment</span><input name={`payment-${item.id}`} inputMode="decimal" defaultValue={item.payment ?? ""} /></label>
                  <label className="field"><span>Original amount</span><input name={`originalAmount-${item.id}`} inputMode="decimal" defaultValue={item.originalAmount ?? ""} /></label>
                  <label className="field"><span>Maturity</span><input name={`maturity-${item.id}`} type="date" defaultValue={item.maturity || ""} /></label>
                  <label className="field"><span>Terms status</span>
                    <select name={`termsStatus-${item.id}`} defaultValue={item.termsStatus || "Needs verification"}>
                      <option>Needs verification</option>
                      <option>Verified</option>
                    </select>
                  </label>
                  <label className="field wide"><span>Terms for this property</span><textarea name={`deal-${item.id}`} defaultValue={item.terms || ""} /></label>
                </div>
              </div>
            ))}
            <datalist id="loan-labels">{LOAN_LABELS.map((label) => <option key={label} value={label} />)}</datalist>
          </div>
        </FormSheet>
      )}
    </DetailFrame>
  )
}
