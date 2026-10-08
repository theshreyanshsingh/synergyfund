"use client"

import { use, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { PROPERTY_LABELS, STAGES, STRATEGIES, can } from "@synergifund/shared"
import { FormSheet } from "../../../../components/ui/FormSheet"
import { money } from "../../../../lib/format"
import { api } from "../../../../lib/api"
import { useApi } from "../../../../lib/useApi"
import { useSession } from "../../../../components/shell/Providers"
import { StatusPill } from "../../../../components/ui/StatusPill"
import { Loader } from "../../../../components/ui/Loader"
import { DetailFrame } from "../../../../components/ui/DetailFrame"
import { CameraCapture } from "../../../../components/photos/CameraCapture"

export default function PropertyDetailPage({ params }) {
  const { id } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const session = useSession()
  const detail = useApi(`/properties/${id}`)
  const [section, setSection] = useState("overview")
  const [note, setNote] = useState("")
  const [files, setFiles] = useState([])
  const [message, setMessage] = useState("")
  const [termsMessage, setTermsMessage] = useState("")
  const [editing, setEditing] = useState(null)
  const [editError, setEditError] = useState("")
  const [addingDraw, setAddingDraw] = useState(false)
  const [drawLines, setDrawLines] = useState([blankDrawLine()])
  const [drawError, setDrawError] = useState("")
  const [drawPending, setDrawPending] = useState(false)
  const [shots, setShots] = useState([])
  const property = detail.data?.property
  const editOpened = useRef(false)
  useEffect(() => {
    if (editOpened.current || !property || search.get("edit") !== "1") return
    if (session?.user && can(session.user, "properties.write")) {
      editOpened.current = true
      setEditing(propertyForm(property))
    }
  }, [property, search, session])
  if (!property) return detail.error ? <div className="boot"><p className="banner">{detail.error}</p></div> : <Loader label="Opening property" />

  const internal = session?.user?.role !== "contractor"
  const canWrite = session?.user && can(session.user, "properties.write")
  const canPost = session?.user && can(session.user, "expenses.approve")
  const canRequest = session?.user && can(session.user, "expenses.submit") && !canPost
  const canDraws = session?.user && can(session.user, "draws.write")
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
  ]
  if (internal) tabs.push({ id: "draws", label: "Draws" }, { id: "financing", label: "Financing" })

  if (!internal) {
    return (
      <DetailFrame backHref="/properties" backLabel="Properties" title={property.address} meta={property.city || ""} actions={<StatusPill>{property.stage}</StatusPill>}>
        {property.accessInfo && (
          <section className="panel property-card">
            <h2>Access</h2>
            <p>{property.accessInfo}</p>
          </section>
        )}
        <section className="panel property-card">
          <div className="property-card-head">
            <div>
              <h2>Draws</h2>
              <p className="property-missing">Open a draw to see the work, then file a cost with a camera photo.</p>
            </div>
          </div>
          {(draws?.items || []).length === 0 && <p className="property-missing">No draws on this house yet.</p>}
          {(draws?.items || []).map((draw) => (
            <DrawFold key={draw.id} draw={draw} canEdit={false} canPost={false} canRequest={canRequest} costs={postedCosts.filter((item) => item.drawId === draw.id)} propertyId={id} onSaved={() => detail.reload()} />
          ))}
        </section>
        <section className="panel property-card">
          <h2>Weekly photos</h2>
          <p className="property-missing">Take this week’s photos on site. Photos from the library are not accepted.</p>
          <FiledPhotos photos={detail.data.photos || []} />
          {session?.user && can(session.user, "photos.write") && (
            <form className="photo-form" onSubmit={async (event) => {
              event.preventDefault()
              if (!shots.length) {
                setMessage("Take at least one photo with the camera.")
                return
              }
              const form = new FormData(event.currentTarget)
              form.set("propertyId", id)
              for (const shot of shots) form.append("photos", shot.file, shot.file.name)
              try {
                const result = await api("/photo-sets", { method: "POST", body: form })
                setMessage(`${result.count} photos filed.`)
                for (const shot of shots) URL.revokeObjectURL(shot.url)
                setShots([])
                event.currentTarget.reset()
                detail.reload()
              } catch (err) {
                setMessage(err.message)
              }
            }}>
              <label className="field"><span>Week of</span><input name="weekOf" type="date" required /></label>
              <div className="field">
                <span>Photos</span>
                <CameraCapture shots={shots} onChange={setShots} />
              </div>
              <label className="field wide"><span>What changed on site</span><input name="note" value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <div className="photo-form-actions"><button className="primary" type="submit">File this week</button></div>
            </form>
          )}
          {message && <p className="property-missing">{message}</p>}
        </section>
      </DetailFrame>
    )
  }

  return (
    <DetailFrame
      backHref="/properties"
      backLabel="Properties"
      title={property.address}
      meta={[property.city, property.stage, property.strategy].filter(Boolean).join(" · ")}
      actions={<>
        {canWrite && <button type="button" className="danger" onClick={() => removeProperty(id, property.address, router)}>Delete</button>}
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
            <FiledPhotos photos={detail.data.photos || []} />
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
          </div>
        </FormSheet>
      )}

      {section === "draws" && (
        <section className="panel property-card">
          <div className="property-card-head">
            <div>
              <h2>Draws</h2>
              <p className="property-missing">Open a draw to see its full scope and posted costs.</p>
            </div>
            <div className="row-actions">
              <a className="tool" href={`/api/draws/export?propertyId=${id}`}>Export Excel</a>
              {canDraws && <button type="button" className="primary" onClick={() => { setDrawError(""); setDrawLines([blankDrawLine()]); setAddingDraw(true) }}>Add draw</button>}
            </div>
          </div>
          {draws?.undrawn != null && <p className="property-missing">{money(draws.undrawn)} still undrawn · {money(draws.received)} received</p>}
          {(draws?.items || []).length === 0 && <p className="property-missing">No draws recorded.</p>}
          {(draws?.items || []).map((draw) => (
            <DrawFold key={draw.id} draw={draw} canEdit={canDraws} canPost={canPost} canRequest={canRequest} costs={postedCosts.filter((item) => item.drawId === draw.id)} propertyId={id} onSaved={() => detail.reload()} />
          ))}
        </section>
      )}
      {addingDraw && (
        <FormSheet
          eyebrow="Draws"
          title="Add draw"
          hint="Create the draw first, then list every scope item included in it."
          onClose={() => setAddingDraw(false)}
          onSubmit={async (event) => {
            event.preventDefault()
            setDrawPending(true)
            setDrawError("")
            const form = Object.fromEntries(new FormData(event.currentTarget))
            try {
              await api("/draws", {
                method: "POST",
                body: {
                  propertyId: id,
                  title: form.title,
                  requestedDate: form.requestedDate || "",
                  lines: cleanDrawLines(drawLines),
                },
              })
              setAddingDraw(false)
              detail.reload()
            } catch (err) {
              setDrawError(err.message)
            } finally {
              setDrawPending(false)
            }
          }}
          submitLabel="Add draw"
          pending={drawPending}
          error={drawError}
        >
          <div className="form-grid">
            <label className="field"><span>Draw name</span><input name="title" placeholder="Draw 3" required /></label>
            <label className="field"><span>Forecast finish</span><input name="requestedDate" type="date" /></label>
            <DrawLinesEditor lines={drawLines} onChange={setDrawLines} />
          </div>
        </FormSheet>
      )}
    </DetailFrame>
  )
}

function DrawFold({ draw, canEdit, canPost, canRequest, costs, propertyId, onSaved }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [addingCost, setAddingCost] = useState(false)
  const [lines, setLines] = useState([])
  const [proofs, setProofs] = useState([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  return (
    <article className={open ? "draw-fold is-open" : "draw-fold"}>
      <button type="button" className="draw-fold-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="draw-fold-title"><small>Draw</small><b>{draw.title}</b><em>{draw.status}</em></span>
        <span><small>Amount</small><b>{money(draw.amount)}</b></span>
        <span><small>Pulled</small><b>{money(draw.pulled)}</b></span>
        <span><small>Remaining</small><b>{money(draw.remaining)}</b></span>
        <i aria-hidden="true">⌄</i>
      </button>
      {open && (
        <div className="draw-fold-body">
          <div className="draw-fold-toolbar">
            <div>
              <strong>Scope of work</strong>
              <span>{(draw.lines || []).length} {(draw.lines || []).length === 1 ? "line item" : "line items"}</span>
            </div>
            <div className="row-actions">
              {(canPost || canRequest) && <button type="button" className="tool" onClick={() => { setError(""); setProofs([]); setAddingCost(true) }}>{canPost ? "Add cost" : "Request cost"}</button>}
              {canEdit && <button type="button" className="primary" onClick={() => { setError(""); setLines((draw.lines || []).length ? draw.lines.map((line) => ({ ...line })) : [blankDrawLine()]); setEditing(true) }}>Edit draw</button>}
            </div>
          </div>
          <table className="sow-table">
            <thead><tr><th>Line item</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              {(draw.lines || []).length === 0 && <tr><td colSpan="3" className="sow-empty">No scope lines have been added to this draw.</td></tr>}
              {(draw.lines || []).map((line) => (
                <tr key={line.id || line.title}>
                  <td><strong>{line.title}</strong></td>
                  <td>{line.description || "—"}</td>
                  <td>{money(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            {(draw.lines || []).length > 0 && <tfoot><tr><td colSpan="2">Draw total</td><td>{money(draw.amount)}</td></tr></tfoot>}
          </table>
          {costs.length > 0 && (
            <div className="draw-costs">
              <h3>Posted costs</h3>
              <ul className="property-scope">
              {costs.map((item) => (
                <li key={item.id}>
                  <div><strong>{item.title}</strong><em>{item.date || "Posted"}</em><ProofPhotos ids={item.proofFileIds} urls={item.proofUrls} /></div>
                  <span>{money(item.amount)}</span>
                  <StatusPill>Posted</StatusPill>
                </li>
              ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {editing && (
        <FormSheet
          eyebrow={draw.title}
          title="Edit draw"
          hint="The draw amount comes from the scope lines. Pulled is the cash already taken, and remaining is the amount minus pulled."
          onClose={() => setEditing(false)}
          onSubmit={async (event) => {
            event.preventDefault()
            setSaving(true)
            setError("")
            const form = Object.fromEntries(new FormData(event.currentTarget))
            try {
              await api(`/draws/${draw.id}`, {
                method: "PATCH",
                body: {
                  title: form.title,
                  requestedDate: form.requestedDate || "",
                  fundedAmount: form.fundedAmount,
                  lines: cleanDrawLines(lines),
                },
              })
              setEditing(false)
              onSaved()
            } catch (err) {
              setError(err.message)
            } finally {
              setSaving(false)
            }
          }}
          submitLabel="Save draw"
          pending={saving}
          error={error}
        >
          <div className="form-grid">
            <label className="field"><span>Draw name</span><input name="title" defaultValue={draw.title} required /></label>
            <label className="field"><span>Pulled</span><input name="fundedAmount" inputMode="decimal" defaultValue={draw.pulled ?? 0} /></label>
            <label className="field"><span>Forecast finish</span><input name="requestedDate" type="date" defaultValue={draw.requestedDate || ""} /></label>
            <DrawLinesEditor lines={lines} onChange={setLines} />
          </div>
        </FormSheet>
      )}
      {addingCost && (
        <FormSheet
          eyebrow={draw.title}
          title={canPost ? "Add cost" : "Request cost"}
          hint="This cost will stay linked to this draw."
          onClose={() => setAddingCost(false)}
          onSubmit={async (event) => {
              event.preventDefault()
              setError("")
              if (!canPost && !proofs.length) {
                setError("Take at least one photo with the camera.")
                return
              }
              const body = new FormData(event.currentTarget)
              body.set("propertyId", propertyId)
              body.set("drawId", draw.id)
              body.set("category", "Materials")
              body.set("entity", "Construction company")
              body.set("costTreatment", "Include in construction margin")
              for (const shot of proofs) body.append("proof", shot.file, shot.file.name)
              try {
                await api(canPost ? "/expenses/post" : "/expenses", { method: "POST", body })
                setAddingCost(false)
                onSaved()
              } catch (err) {
                setError(err.message)
              }
            }}
          submitLabel={canPost ? "Add cost" : "Submit request"}
          error={error}
        >
            <div className="form-grid">
              <label className="field wide"><span>Material or cost</span><input name="title" required /></label>
              <label className="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label className="field"><span>Date</span><input name="date" type="date" /></label>
              <div className="field wide">
                <span>Proof photos</span>
                {canPost ? (
                  <label className="photo-pick">Attach photos<input name="proof" type="file" accept="image/*" multiple /></label>
                ) : (
                  <CameraCapture shots={proofs} onChange={setProofs} />
                )}
              </div>
              <label className="field wide"><span>Note</span><input name="note" /></label>
            </div>
        </FormSheet>
      )}
    </article>
  )
}

function DrawLinesEditor({ lines, onChange }) {
  function update(index, key, value) {
    onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line))
  }
  return (
    <div className="field wide draw-lines-editor">
      <div className="draw-lines-label">
        <span>Scope of work</span>
        <button type="button" className="tool" onClick={() => onChange([...lines, blankDrawLine()])}>Add line</button>
      </div>
      {lines.map((line, index) => (
        <div className="draw-line-edit" key={line.id || index}>
          <input aria-label="Line item" placeholder="Line item" value={line.title} onChange={(event) => update(index, "title", event.target.value)} />
          <input aria-label="Description" placeholder="Description from scope of work" value={line.description || ""} onChange={(event) => update(index, "description", event.target.value)} />
          <input aria-label="Amount" placeholder="Amount" inputMode="decimal" value={line.amount ?? ""} onChange={(event) => update(index, "amount", event.target.value)} />
          <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}>×</button>
        </div>
      ))}
      <div className="draw-lines-total"><span>Draw total</span><strong>{money(lines.reduce((total, line) => total + (Number(line.amount) || 0), 0))}</strong></div>
    </div>
  )
}

async function removeProperty(id, address, router) {
  if (!window.confirm(`Delete ${address}? Its draws, loans, costs, and photos will be removed.`)) return
  await api(`/properties/${id}`, { method: "DELETE" })
  router.push("/properties")
}

function blankDrawLine() {
  return { id: "", title: "", description: "", amount: "" }
}

function cleanDrawLines(lines) {
  return lines
    .filter((line) => line.title.trim())
    .map((line) => ({ id: line.id, title: line.title.trim(), description: String(line.description || "").trim(), amount: line.amount === "" ? null : Number(line.amount) }))
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

function FiledPhotos({ photos }) {
  if (!photos.length) return <p className="property-missing">No photos filed yet.</p>
  return (
    <div className="property-photos">
      {photos.map((photo) => {
        const href = photo.url || `/api/documents/${photo.id}/raw`
        return (
          <a key={photo.id} href={href} target="_blank" rel="noreferrer">
            <img src={href} alt={photo.name} />
          </a>
        )
      })}
    </div>
  )
}

function ProofPhotos({ ids, urls = {} }) {
  if (!ids?.length) return null
  return (
    <div className="property-photos">
      {ids.map((id) => {
        const href = urls[id] || `/api/documents/${id}/raw`
        return (
          <a key={id} href={href} target="_blank" rel="noreferrer">
            <img src={href} alt="Proof" />
          </a>
        )
      })}
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
