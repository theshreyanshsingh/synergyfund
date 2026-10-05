"use client"

import { use, useState } from "react"
import Link from "next/link"
import { PROPERTY_LABELS, STAGES, STRATEGIES, can } from "@synergifund/shared"
import { FormSheet } from "../../../../components/ui/FormSheet"
import { money } from "../../../../lib/format"
import { api } from "../../../../lib/api"
import { useApi } from "../../../../lib/useApi"
import { useSession } from "../../../../components/shell/Providers"
import { StatusPill } from "../../../../components/ui/StatusPill"
import { Loader } from "../../../../components/ui/Loader"
import { DetailFrame } from "../../../../components/ui/DetailFrame"

export default function PropertyDetailPage({ params }) {
  const { id } = use(params)
  const session = useSession()
  const detail = useApi(`/properties/${id}`)
  const [section, setSection] = useState("overview")
  const [note, setNote] = useState("")
  const [files, setFiles] = useState([])
  const [message, setMessage] = useState("")
  const [termsMessage, setTermsMessage] = useState("")
  const [requestError, setRequestError] = useState("")
  const [editing, setEditing] = useState(null)
  const [editError, setEditError] = useState("")
  const property = detail.data?.property
  if (!property) return detail.error ? <div className="boot"><p className="banner">{detail.error}</p></div> : <Loader label="Opening property" />

  const internal = session?.user?.role !== "contractor"
  const canWrite = session?.user && can(session.user, "properties.write")
  const canPost = session?.user && can(session.user, "expenses.approve")
  const canRequest = session?.user && can(session.user, "expenses.submit") && !canPost && (property.scopeLines || []).length > 0
  const spent = detail.data.rehabSpent || 0
  const postedCosts = (detail.data.expenses || []).filter((item) => item.costTreatment !== "Exclude from construction margin")
  const left = property.rehabBudget == null ? null : Math.max(0, Number(property.rehabBudget) - spent)
  const draws = detail.data.draws
  const loans = detail.data.loans || []
  const upcoming = detail.data.upcoming || []
  const openDraws = (draws?.items || []).filter((draw) => draw.status !== "Funded")
  const monthlyMortgage = loans.reduce((total, loan) => total + Number(loan.payment || 0), 0)
  const missing = [
    property.actualRent == null ? "actual rent" : "",
    !property.rentStatus ? "rent status" : "",
    !property.accessInfo ? "access info" : "",
  ].filter(Boolean)
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "scope", label: "Scope of work" },
  ]
  if (internal) tabs.push({ id: "financing", label: "Financing" }, { id: "draws", label: "Draws" })

  return (
    <DetailFrame
      backHref="/properties"
      backLabel="Properties"
      title={property.address}
      meta={[property.city, property.stage, property.strategy].filter(Boolean).join(" · ")}
      actions={<>
        {canWrite && <button type="button" className="primary" onClick={() => { setEditError(""); setEditing(propertyForm(property)) }}>Modify</button>}
        <StatusPill>{property.stage}</StatusPill>
      </>}
    >
      <div className="property-switch" role="tablist" aria-label="Property sections">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={section === tab.id} className={section === tab.id ? "is-on" : ""} onClick={() => setSection(tab.id)}>{tab.label}</button>
        ))}
      </div>

      {section === "overview" && (
        <>
          <section className="property-figures">
            <Figure label="Purchase" value={money(property.purchasePrice)} />
            <Figure label="ARV" value={money(property.arv)} />
            <Figure label="Rehab budget" value={money(property.rehabBudget)} />
            <Figure label="Rehab left" value={left == null ? "Not entered" : money(left)} hint={property.rehabBudget == null ? "" : `${money(spent)} posted`} />
          </section>

          {internal && (
            <div className="property-layout property-heads">
              <section className="panel property-card">
                <h2>Financing</h2>
                {loans.length === 0 && <p className="property-missing">No lender on file.</p>}
                <ul className="property-draws">
                  {loans.map((loan) => (
                    <li key={loan.id}>
                      <span>{loan.lenderId ? <Link href={`/loans/lenders/${loan.lenderId}`}>{loan.lender}</Link> : loan.lender}{loan.label ? ` · ${loan.label}` : ""}</span>
                      <b>{money(loan.balance)}</b>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel property-card">
                <h2>Upcoming</h2>
                {property.actualRent != null && <p>{money(property.actualRent)} rent{property.rentStatus ? ` · ${property.rentStatus}` : ""}</p>}
                {monthlyMortgage > 0 && <p>{money(monthlyMortgage)} monthly mortgage</p>}
                {upcoming.length === 0 && property.actualRent == null && monthlyMortgage === 0 && <p className="property-missing">No payment or rent on file.</p>}
                <ul className="property-draws">
                  {upcoming.map((bill) => (
                    <li key={bill.id}>
                      <span>{bill.title} · {bill.due}</span>
                      <b>{money(bill.amount)}</b>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel property-card">
                <h2>Draws that can be pulled</h2>
                {draws?.undrawn != null && <p>{money(draws.undrawn)} still undrawn</p>}
                {openDraws.length === 0 && <p className="property-missing">No open draw is waiting.</p>}
                <ul className="property-draws">
                  {openDraws.map((draw) => (
                    <li key={draw.id}>
                      <span>{draw.title}</span>
                      <b>{money(draw.amount)}</b>
                      <StatusPill>{draw.status}</StatusPill>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          <div className="property-layout">
            <section className="panel property-card">
              <h2>Deal</h2>
              <dl className="property-facts">
                {(property.labels || []).length > 0 && <div className="wide label-row">{property.labels.map((label) => <StatusPill key={label}>{label}</StatusPill>)}</div>}
                <Fact label="Strategy" value={property.strategy} />
                <Fact label="Owner" value={property.ownerEntity} />
                <Fact label="Market" value={property.rentMarket} />
                <Fact label="Next step" value={property.nextAction} wide />
                <Fact label="Access" value={property.accessInfo} wide />
              </dl>
              {missing.length > 0 && <p className="property-missing">Not entered yet: {missing.join(", ")}.</p>}
              {"houseBoughtPrice" in property && (
                <dl className="property-facts property-internal">
                  <Fact label="HouseBought price" value={money(property.houseBoughtPrice)} />
                  <Fact label="Assignment fee" value={money(property.assignmentFee)} />
                </dl>
              )}
            </section>
            <section className="panel property-card">
              <h2>Money on this house</h2>
              <dl className="property-facts">
                <Fact label="Rehab spent" value={money(spent)} />
                <Fact label="Pending expenses" value={money(detail.data.pendingExpenses || 0)} />
                {property.actualRent != null && <Fact label="Actual rent" value={money(property.actualRent)} />}
                {draws && <Fact label="Draws received" value={money(draws.received)} />}
              </dl>
            </section>
          </div>

          {internal && (
            <section className="panel property-card">
              <h2>Customer terms</h2>
              {canWrite ? (
                <form className="photo-form" onSubmit={async (event) => {
                  event.preventDefault()
                  setTermsMessage("")
                  const body = Object.fromEntries(new FormData(event.currentTarget))
                  try {
                    await api(`/properties/${id}`, { method: "PATCH", body: { customerTerms: body.customerTerms } })
                    setTermsMessage("Terms saved.")
                    detail.reload()
                  } catch (err) {
                    setTermsMessage(err.message)
                  }
                }}>
                  <label className="field wide"><span>Notes</span><textarea className="property-terms" name="customerTerms" defaultValue={property.customerTerms || ""} placeholder="Write the customer terms for this house" /></label>
                  <div className="photo-form-actions"><button className="primary" type="submit">Save terms</button></div>
                </form>
              ) : (
                <p>{property.customerTerms || "No terms written yet."}</p>
              )}
              {termsMessage && <p className="property-missing">{termsMessage}</p>}
            </section>
          )}

          <section className="panel property-card">
            <h2>Weekly photos</h2>
            <p className="property-missing">A full set for one week. A draw compares it with the previous set.</p>
            {(detail.data.photos || []).length > 0 && (
              <div className="property-photos">
                {detail.data.photos.map((photo) => (
                  <a key={photo.id} href={`/api/documents/${photo.id}/raw`} target="_blank" rel="noreferrer">
                    <img src={`/api/documents/${photo.id}/raw`} alt={photo.name} />
                  </a>
                ))}
              </div>
            )}
            {(detail.data.photos || []).length === 0 && <p className="property-missing">No photos filed yet.</p>}
            {session?.user && can(session.user, "photos.write") && (
              <form className="photo-form" onSubmit={async (event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                form.set("propertyId", id)
                try {
                  const result = await api("/photo-sets", { method: "POST", body: form })
                  setMessage(`${result.count} photos filed.`)
                  setFiles([])
                  event.currentTarget.reset()
                  detail.reload()
                } catch (err) {
                  setMessage(err.message)
                }
              }}>
                <label className="field"><span>Week of</span><input name="weekOf" type="date" required /></label>
                <div className="field">
                  <span>Photos</span>
                  <label className="photo-pick">
                    Choose photos
                    <input name="photos" type="file" accept="image/*" multiple required onChange={(event) => setFiles([...event.target.files].map((file) => file.name))} />
                  </label>
                  <em>{files.length ? files.join(", ") : "None chosen"}</em>
                </div>
                <label className="field wide"><span>What changed on site</span><input name="note" value={note} onChange={(event) => setNote(event.target.value)} /></label>
                <div className="photo-form-actions"><button className="primary" type="submit">File this week</button></div>
              </form>
            )}
            {message && <p className="property-missing">{message}</p>}
          </section>
        </>
      )}

      {section === "scope" && (
        <section className="panel property-card">
          <h2>Scope of work</h2>
          {(property.scopeLines || []).length === 0 && <p className="property-missing">No scope lines yet.</p>}
          <ul className="property-scope">
            {(property.scopeLines || []).map((line) => {
              const lineId = String(line._id || "")
              const posted = postedCosts.filter((item) => item.scopeLineId === lineId)
              const waiting = (detail.data.requests || []).filter((item) => item.scopeLineId === lineId && item.status !== "Approved")
              return (
                <li key={lineId || line.title}>
                  <div>
                    <strong>{line.title}</strong>
                    {line.description && <em>{line.description}</em>}
                    {posted.map((item) => <em key={item.id}>{item.title} posted {money(item.amount)}</em>)}
                    {waiting.map((item) => <em key={item.id}>{item.title} · {item.status}</em>)}
                  </div>
                  <span>{line.budget == null ? "Budget not entered" : money(line.budget)}</span>
                  <StatusPill>{line.status || "Not started"}</StatusPill>
                </li>
              )
            })}
          </ul>
          {(canPost || canRequest) && (
            <form className="photo-form" onSubmit={async (event) => {
              event.preventDefault()
              setRequestError("")
              const body = new FormData(event.currentTarget)
              body.set("propertyId", id)
              body.set("category", "Materials")
              body.set("entity", "Construction company")
              body.set("costTreatment", "Include in construction margin")
              try {
                await api(canPost ? "/expenses/post" : "/expenses", { method: "POST", body })
                event.currentTarget.reset()
                detail.reload()
              } catch (err) {
                setRequestError(err.message)
              }
            }}>
              <label className="field wide"><span>Material or cost</span><input name="title" required /></label>
              <label className="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label className="field"><span>Part of the house</span>
                <select name="scopeLineId" required={!canPost}>
                  <option value="">{canPost ? "Whole property" : "Choose"}</option>
                  {(property.scopeLines || []).map((line) => <option key={line._id} value={line._id}>{line.title}</option>)}
                </select>
              </label>
              {draws?.items?.length > 0 && (
                <label className="field"><span>Draw</span>
                  <select name="drawId"><option value="">None</option>{draws.items.map((draw) => <option key={draw.id} value={draw.id}>{draw.title}</option>)}</select>
                </label>
              )}
              <div className="field wide">
                <span>Proof photos</span>
                <label className="photo-pick">Attach photos<input name="proof" type="file" accept="image/*" multiple required={!canPost} /></label>
              </div>
              <label className="field wide"><span>Note</span><input name="note" /></label>
              {requestError && <p className="banner wide">{requestError}</p>}
              <div className="photo-form-actions"><button className="primary" type="submit">{canPost ? "Add cost" : "Request approval"}</button></div>
            </form>
          )}
          <h2 className="property-follow">Posted costs</h2>
          {postedCosts.length === 0 && <p className="property-missing">No costs on this house yet.</p>}
          <ul className="property-scope">
            {postedCosts.map((item) => {
              const line = (property.scopeLines || []).find((entry) => String(entry._id) === item.scopeLineId)
              return (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <em>{[line?.title, item.date, item.vendor].filter(Boolean).join(" · ") || "Whole property"}</em>
                    <ProofPhotos ids={item.proofFileIds} />
                  </div>
                  <span>{money(item.amount)}</span>
                  <StatusPill>Posted</StatusPill>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {section === "financing" && (
        <section className="panel property-card">
          <h2>Financing</h2>
          {loans.length === 0 && <p className="property-missing">No lender is recorded for this house.</p>}
          <ul className="property-scope">
            {loans.map((loan) => (
              <li key={loan.id}>
                <div>
                  <strong>{loan.lenderId ? <Link href={`/loans/lenders/${loan.lenderId}`}>{loan.lender}</Link> : loan.lender}</strong>
                  <em>{[loan.label, loan.loanNumber, loan.maturity && `Matures ${loan.maturity}`, loan.payment != null && `${money(loan.payment)} a month`, loan.lenderTerms].filter(Boolean).join(" · ")}</em>
                </div>
                <span>{money(loan.balance)}</span>
                <StatusPill>{loan.termsStatus || "Recorded"}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <FormSheet eyebrow="Property" title="Modify property" hint="Blank numbers stay blank. Existing scope lines keep their costs." onClose={() => setEditing(null)} onSubmit={async (event) => {
          event.preventDefault()
          setEditError("")
          const body = {
            address: editing.address,
            city: editing.city,
            stage: editing.stage,
            strategy: editing.strategy,
            nextAction: editing.nextAction,
            ownerEntity: editing.ownerEntity,
            accessInfo: editing.accessInfo,
            rentStatus: editing.rentStatus,
            rentMarket: editing.rentMarket,
            purchasePrice: blankNumber(editing.purchasePrice),
            arv: blankNumber(editing.arv),
            rehabBudget: blankNumber(editing.rehabBudget),
            actualRent: blankNumber(editing.actualRent),
            marketRent: blankNumber(editing.marketRent),
            labels: editing.labels,
            scopeLines: editing.scopeLines.filter((line) => line.title.trim()).map((line) => ({ id: line.id, title: line.title.trim(), description: line.description.trim(), budget: blankNumber(line.budget), status: line.status || "Not started" })),
          }
          if ("houseBoughtPrice" in property) body.houseBoughtPrice = blankNumber(editing.houseBoughtPrice)
          try {
            await api(`/properties/${id}`, { method: "PATCH", body })
            setEditing(null)
            detail.reload()
          } catch (err) {
            setEditError(err.message)
          }
        }} submitLabel="Save changes" error={editError}>
          <div className="form-grid">
            <label className="field wide"><span>Address</span><input value={editing.address} onChange={(event) => setEditing({ ...editing, address: event.target.value })} required /></label>
            <LabelField labels={editing.labels} onChange={(labels) => setEditing({ ...editing, labels })} />
            <label className="field"><span>City</span><input value={editing.city} onChange={(event) => setEditing({ ...editing, city: event.target.value })} /></label>
            <label className="field"><span>Stage</span><select value={editing.stage} onChange={(event) => setEditing({ ...editing, stage: event.target.value })}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            <label className="field"><span>Strategy</span><select value={editing.strategy} onChange={(event) => setEditing({ ...editing, strategy: event.target.value })}><option value="">Not set</option>{STRATEGIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>Purchase price</span><input value={editing.purchasePrice} onChange={(event) => setEditing({ ...editing, purchasePrice: event.target.value })} /></label>
            <label className="field"><span>ARV</span><input value={editing.arv} onChange={(event) => setEditing({ ...editing, arv: event.target.value })} /></label>
            <label className="field"><span>Rehab budget</span><input value={editing.rehabBudget} onChange={(event) => setEditing({ ...editing, rehabBudget: event.target.value })} /></label>
            <label className="field"><span>Actual rent</span><input value={editing.actualRent} onChange={(event) => setEditing({ ...editing, actualRent: event.target.value })} /></label>
            <label className="field"><span>Rent status</span><input value={editing.rentStatus} onChange={(event) => setEditing({ ...editing, rentStatus: event.target.value })} /></label>
            <label className="field"><span>Market</span><input value={editing.rentMarket} onChange={(event) => setEditing({ ...editing, rentMarket: event.target.value })} /></label>
            <label className="field"><span>Owner</span><input value={editing.ownerEntity} onChange={(event) => setEditing({ ...editing, ownerEntity: event.target.value })} /></label>
            <label className="field wide"><span>Next step</span><input value={editing.nextAction} onChange={(event) => setEditing({ ...editing, nextAction: event.target.value })} /></label>
            <label className="field wide"><span>Access</span><input value={editing.accessInfo} onChange={(event) => setEditing({ ...editing, accessInfo: event.target.value })} /></label>
            {"houseBoughtPrice" in property && <label className="field"><span>HouseBought price</span><input value={editing.houseBoughtPrice} onChange={(event) => setEditing({ ...editing, houseBoughtPrice: event.target.value })} /></label>}
            <div className="field wide">
              <span>Scope lines</span>
              {editing.scopeLines.map((line, index) => (
                <div key={line.id || index} className="scope-edit">
                  <input placeholder="Part of the house" value={line.title} onChange={(event) => setEditing((current) => ({ ...current, scopeLines: current.scopeLines.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} />
                  <input placeholder="Budget" value={line.budget} onChange={(event) => setEditing((current) => ({ ...current, scopeLines: current.scopeLines.map((item, itemIndex) => itemIndex === index ? { ...item, budget: event.target.value } : item) }))} />
                  <input className="wide" placeholder="Description" value={line.description} onChange={(event) => setEditing((current) => ({ ...current, scopeLines: current.scopeLines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) }))} />
                </div>
              ))}
              <button type="button" className="tool" onClick={() => setEditing((current) => ({ ...current, scopeLines: [...current.scopeLines, { id: "", title: "", description: "", budget: "", status: "Not started" }] }))}>Add a line</button>
            </div>
          </div>
        </FormSheet>
      )}

      {section === "draws" && (
        <section className="panel property-card">
          <h2>Draws</h2>
          {draws?.undrawn != null && <p className="property-missing">{money(draws.undrawn)} still undrawn · {money(draws.received)} received</p>}
          {(draws?.items || []).length === 0 && <p className="property-missing">No draws recorded.</p>}
          <ul className="property-scope">
            {(draws?.items || []).map((draw) => (
              <li key={draw.id}>
                <div>
                  <strong>{draw.title}</strong>
                  <em>{draw.fundedDate || (draw.status === "Funded" ? "Funded" : "Can be pulled")}</em>
                </div>
                <span>{money(draw.status === "Funded" ? draw.fundedAmount ?? draw.amount : draw.amount)}</span>
                <StatusPill>{draw.status}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DetailFrame>
  )
}

function propertyForm(property) {
  return {
    address: property.address || "",
    city: property.city || "",
    stage: property.stage || "Under contract",
    strategy: property.strategy || "",
    purchasePrice: property.purchasePrice ?? "",
    arv: property.arv ?? "",
    rehabBudget: property.rehabBudget ?? "",
    actualRent: property.actualRent ?? "",
    marketRent: property.marketRent ?? "",
    rentStatus: property.rentStatus || "",
    rentMarket: property.rentMarket || "",
    ownerEntity: property.ownerEntity || "",
    accessInfo: property.accessInfo || "",
    nextAction: property.nextAction || "",
    houseBoughtPrice: property.houseBoughtPrice ?? "",
    labels: property.labels || [],
    scopeLines: (property.scopeLines || []).map((line) => ({ id: String(line._id || ""), title: line.title || "", description: line.description || "", budget: line.budget ?? "", status: line.status || "Not started" })),
  }
}

function LabelField({ labels, onChange }) {
  const [draft, setDraft] = useState("")
  function add(value) {
    const label = value.trim().replace(/\s+/g, " ")
    if (!label) return
    onChange(labels.some((item) => item.toLowerCase() === label.toLowerCase()) ? labels : [...labels, label].slice(0, 8))
    setDraft("")
  }
  return (
    <div className="field wide">
      <span>Labels</span>
      <div className="label-editor">
        {labels.map((label) => <button key={label} type="button" className="label-chip" onClick={() => onChange(labels.filter((item) => item !== label))}>{label} ×</button>)}
        <input value={draft} placeholder="Add a label" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(draft) } }} />
      </div>
      <div className="label-suggestions">
        {PROPERTY_LABELS.filter((label) => !labels.some((item) => item.toLowerCase() === label.toLowerCase())).map((label) => (
          <button key={label} type="button" onClick={() => add(label)}>{label}</button>
        ))}
      </div>
    </div>
  )
}

function blankNumber(value) {
  if (value === "" || value == null) return null
  const number = Number(String(value).replace(/[$,]/g, ""))
  return Number.isFinite(number) ? number : null
}

function ProofPhotos({ ids }) {
  if (!ids?.length) return null
  return (
    <div className="property-photos">
      {ids.map((id) => (
        <a key={id} href={`/api/documents/${id}/raw`} target="_blank" rel="noreferrer">
          <img src={`/api/documents/${id}/raw`} alt="Proof" />
        </a>
      ))}
    </div>
  )
}

function Figure({ label, value, hint }) {
  return (
    <article className="property-figure">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <em>{hint}</em>}
    </article>
  )
}

function Fact({ label, value, wide }) {
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{label}</dt>
      <dd>{value || "Not entered"}</dd>
    </div>
  )
}
