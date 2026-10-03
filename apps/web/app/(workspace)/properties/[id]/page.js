"use client"

import { use, useState } from "react"
import { can } from "@synergifund/shared"
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
  const [note, setNote] = useState("")
  const [files, setFiles] = useState([])
  const [message, setMessage] = useState("")
  const [requestError, setRequestError] = useState("")
  const property = detail.data?.property
  if (!property) return detail.error ? <div className="boot"><p className="banner">{detail.error}</p></div> : <Loader label="Opening property" />

  const spent = detail.data.rehabSpent || 0
  const postedCosts = (detail.data.expenses || []).filter((item) => item.costTreatment !== "Exclude from construction margin")
  const left = property.rehabBudget == null ? null : Math.max(0, Number(property.rehabBudget) - spent)
  const draws = detail.data.draws
  const canRequest = session?.user && can(session.user, "expenses.submit") && (property.scopeLines || []).length > 0
  const missing = [
    property.actualRent == null ? "actual rent" : "",
    !property.rentStatus ? "rent status" : "",
    !property.accessInfo ? "access info" : "",
  ].filter(Boolean)

  return (
    <DetailFrame
      backHref="/properties"
      backLabel="Properties"
      title={property.address}
      meta={[property.city, property.stage, property.strategy].filter(Boolean).join(" · ")}
      actions={<StatusPill>{property.stage}</StatusPill>}
    >
      <section className="property-figures">
        <Figure label="Purchase" value={money(property.purchasePrice)} />
        <Figure label="ARV" value={money(property.arv)} />
        <Figure label="Rehab budget" value={money(property.rehabBudget)} />
        <Figure label="Rehab left" value={left == null ? "Not entered" : money(left)} hint={property.rehabBudget == null ? "" : `${money(spent)} posted`} />
      </section>

      <div className="property-layout">
        <section className="panel property-card">
          <h2>Deal</h2>
          <dl className="property-facts">
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
            {property.rentStatus && <Fact label="Rent status" value={property.rentStatus} />}
            {draws && <Fact label="Draws received" value={money(draws.received)} />}
            {draws?.undrawn != null && <Fact label="Still undrawn" value={money(draws.undrawn)} />}
          </dl>
          {draws?.items?.length > 0 && (
            <ul className="property-draws">
              {draws.items.map((draw) => (
                <li key={draw.id}>
                  <span>{draw.title}{draw.fundedDate ? ` · ${draw.fundedDate}` : ""}</span>
                  <b>{money(draw.status === "Funded" ? draw.fundedAmount ?? draw.amount : draw.amount)}</b>
                  <StatusPill>{draw.status}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {(detail.data.contractors || []).length > 0 && (
        <section className="panel property-card">
          <h2>Contractors</h2>
          <ul className="property-scope">
            {detail.data.contractors.map((person) => (
              <li key={person.id}><strong>{person.name}</strong><span>{person.email}</span></li>
            ))}
          </ul>
        </section>
      )}

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
                  {posted.map((item) => <em key={item.id}>{item.title} posted {money(item.amount)}</em>)}
                  {waiting.map((item) => <em key={item.id}>{item.title} · {item.status}</em>)}
                </div>
                <span>{line.budget == null ? "Budget not entered" : money(line.budget)}</span>
                <StatusPill>{line.status || "Not started"}</StatusPill>
              </li>
            )
          })}
        </ul>
        {canRequest && (
          <form className="photo-form" onSubmit={async (event) => {
            event.preventDefault()
            setRequestError("")
            const body = new FormData(event.currentTarget)
            body.set("propertyId", id)
            body.set("category", "Materials")
            body.set("entity", "Construction company")
            body.set("costTreatment", "Include in construction margin")
            try {
              await api("/expenses", { method: "POST", body })
              event.currentTarget.reset()
              detail.reload()
            } catch (err) {
              setRequestError(err.message)
            }
          }}>
            <label className="field wide"><span>Material or cost</span><input name="title" required /></label>
            <label className="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label className="field"><span>Part of the house</span>
              <select name="scopeLineId" required>
                <option value="">Choose</option>
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
              <label className="photo-pick">Attach photos<input name="proof" type="file" accept="image/*" multiple required /></label>
            </div>
            <label className="field wide"><span>Note</span><input name="note" /></label>
            {requestError && <p className="banner wide">{requestError}</p>}
            <div className="photo-form-actions"><button className="primary" type="submit">Request approval</button></div>
          </form>
        )}
      </section>

      <section className="panel property-card">
        <h2>Posted costs</h2>
        {postedCosts.length === 0 && <p className="property-missing">No approved costs on this house yet.</p>}
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

      {(detail.data.photos || []).length > 0 && (
        <section className="panel property-card">
          <h2>Photos</h2>
          <div className="property-photos">
            {detail.data.photos.map((photo) => (
              <a key={photo.id} href={`/api/documents/${photo.id}/raw`} target="_blank" rel="noreferrer">
                <img src={`/api/documents/${photo.id}/raw`} alt={photo.name} />
              </a>
            ))}
          </div>
        </section>
      )}

      {session?.user && can(session.user, "photos.write") && (
        <section className="panel property-card">
          <h2>Weekly photos</h2>
          <p className="property-missing">A full set for one week. A draw compares it with the previous set.</p>
          <form className="photo-form" onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            form.set("propertyId", id)
            try {
              const result = await api("/photo-sets", { method: "POST", body: form })
              setMessage(`${result.count} photos filed.`)
              setFiles([])
              event.currentTarget.reset()
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
          {message && <p className="property-missing">{message}</p>}
        </section>
      )}
    </DetailFrame>
  )
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
