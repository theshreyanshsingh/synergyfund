"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { compStats, daysBetween, drawPulled, isPendingDraw, mapsLink, zillowLink } from "@synergifund/shared"
import { useSession } from "../../../../../components/shell/Providers"
import { PageSpinner } from "../../../../../components/ui/Spinner"
import { CompsMap } from "../../../../../components/properties/CompsMap"
import { money, photoUrl, placedComps, shortDate, useCompLocations } from "../../../../../components/properties/ArvSection"
import { REPORT_SECTIONS, readReport } from "../../../../../components/properties/ReportSheet"
import { useApi } from "../../../../../lib/useApi"

function key(title) {
  return String(title || "").toLowerCase().replace(/\s+/g, " ").trim()
}

function scopeRows(property, draws) {
  const rows = (property.scopeLines || []).map((line) => ({ title: line.title, description: line.description || "", budget: line.budget ?? null, drawn: 0, pending: 0 }))
  const byKey = new Map(rows.map((row) => [key(row.title), row]))
  for (const draw of draws) {
    const pending = isPendingDraw(draw)
    for (const line of draw.lines || []) {
      let row = byKey.get(key(line.title))
      if (!row) {
        row = { title: line.title, description: line.description || "", budget: null, drawn: 0, pending: 0 }
        byKey.set(key(line.title), row)
        rows.push(row)
      }
      row[pending ? "pending" : "drawn"] += Number(line.amount) || 0
    }
  }
  return rows
}

function waitForImages(root) {
  const images = [...(root?.querySelectorAll("img") || [])]
  return Promise.all(images.map((image) => (image.complete ? Promise.resolve() : new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true })
    image.addEventListener("error", resolve, { once: true })
  }))))
}

export default function PropertyReport({ params }) {
  const { id } = use(params)
  const session = useSession()
  const detail = useApi(`/properties/${id}`)
  const [settings, setSettings] = useState(null)
  const [mapReady, setMapReady] = useState(false)
  const [printing, setPrinting] = useState(false)
  const property = detail.data?.property
  const location = useCompLocations(property || { id, comps: [] }, Boolean(property && settings?.sections.includes("map")))

  useEffect(() => {
    setSettings(readReport(id) || { sections: REPORT_SECTIONS.map((section) => section.key).filter((section) => section !== "notes"), title: "Property report", preparedFor: "", notes: "" })
  }, [id])

  useEffect(() => {
    const previous = document.title
    if (property) document.title = `${settings?.title || "Property report"} – ${property.address}`
    return () => {
      document.title = previous
    }
  }, [property, settings?.title])

  const draws = useMemo(() => detail.data?.draws?.items || [], [detail.data])
  const stats = useMemo(() => compStats(property?.comps || [], property?.sqft), [property])

  if (!settings || (detail.loading && !detail.data)) return <PageSpinner label="Building the report" />
  if (detail.error || !property) return <div className="report-page"><p className="banner">{detail.error || "That property is not available."}</p></div>

  const has = (section) => settings.sections.includes(section)
  const comps = placedComps(property, location)
  const usedComps = comps.filter((comp) => comp.include)
  const rows = scopeRows(property, draws)
  const lineBudget = rows.reduce((sum, row) => sum + (Number(row.budget) || 0), 0)
  const totalBudget = property.rehabBudget ?? (lineBudget || null)
  const drawn = draws.filter((draw) => !isPendingDraw(draw)).reduce((sum, draw) => sum + (Number(draw.amount) || 0), 0)
  const pending = draws.filter(isPendingDraw).reduce((sum, draw) => sum + (Number(draw.amount) || 0), 0)
  const received = draws.filter((draw) => !isPendingDraw(draw)).reduce((sum, draw) => sum + drawPulled(draw), 0)
  const photos = (detail.data.photos || []).slice(0, 12)
  const loans = detail.data.loans || []
  const waitingOnMap = has("map") && comps.length > 0 && (!location || !mapReady)

  async function download() {
    setPrinting(true)
    await waitForImages(document.querySelector(".report-doc"))
    setPrinting(false)
    window.print()
  }

  return (
    <div className="report-page">
      <div className="report-toolbar">
        <Link href={`/properties/${id}`} className="import-button">Back to property</Link>
        <span>{waitingOnMap ? "Loading the map…" : "Check the pages, then save as PDF. In the print window choose “Save as PDF”."}</span>
        <button type="button" className="primary" disabled={printing || waitingOnMap} onClick={download}>{printing ? "Preparing…" : "Download PDF"}</button>
      </div>

      <article className="report-doc">
        <header className="report-cover">
          <div>
            <p className="report-eyebrow">{settings.title || "Property report"}</p>
            <h1>{property.address}</h1>
            <p>{[property.city, property.stage, property.strategy].filter(Boolean).join(" · ")}</p>
          </div>
          <dl>
            {settings.preparedFor && <div><dt>Prepared for</dt><dd>{settings.preparedFor}</dd></div>}
            <div><dt>Prepared by</dt><dd>{session?.user?.name || "SynergiFund"}</dd></div>
            <div><dt>Date</dt><dd>{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</dd></div>
          </dl>
        </header>

        {has("summary") && (
          <section className="report-section">
            <h2>Property summary</h2>
            <dl className="report-facts">
              <div><dt>Purchase price</dt><dd>{money(property.purchasePrice)}</dd></div>
              <div><dt>Purchase date</dt><dd>{shortDate(property.purchaseDate)}</dd></div>
              <div><dt>Size</dt><dd>{[property.beds != null ? `${property.beds} bd` : "", property.baths != null ? `${property.baths} ba` : "", property.sqft ? `${Number(property.sqft).toLocaleString("en-US")} sq ft` : ""].filter(Boolean).join(" · ") || "—"}</dd></div>
              <div><dt>Rehab budget</dt><dd>{money(totalBudget)}</dd></div>
              <div><dt>Drawn to date</dt><dd>{money(drawn)}</dd></div>
              <div><dt>After repair value</dt><dd>{money(property.arv)}</dd></div>
              {property.purchasePrice != null && totalBudget != null && property.arv != null && (
                <div><dt>All-in vs ARV</dt><dd>{money(property.purchasePrice + totalBudget)} · {Math.round(((property.purchasePrice + totalBudget) / property.arv) * 100)}% of ARV</dd></div>
              )}
              {property.marketRent != null && <div><dt>Market rent</dt><dd>{money(property.marketRent)}/mo</dd></div>}
            </dl>
          </section>
        )}

        {has("arv") && (
          <section className="report-section">
            <h2>After repair value</h2>
            <div className="report-arv">
              <div className="report-arv-value">
                <small>ARV</small>
                <b>{money(property.arv ?? stats.suggested?.value)}</b>
                <span>{property.arv != null ? property.arvMethod || "Entered by hand" : stats.suggested ? `${stats.suggested.label} (suggested)` : "Not set"}</span>
              </div>
              <dl className="report-facts">
                <div><dt>Comps used</dt><dd>{stats.count}</dd></div>
                <div><dt>Sale range</dt><dd>{stats.low != null ? `${money(stats.low)} – ${money(stats.high)}` : "—"}</dd></div>
                <div><dt>Median sale</dt><dd>{money(stats.median)}</dd></div>
                <div><dt>Average sale</dt><dd>{money(stats.average)}</dd></div>
                <div><dt>Median $/sq ft</dt><dd>{stats.ppsfMedian ? `$${Math.round(stats.ppsfMedian).toLocaleString("en-US")}` : "—"}</dd></div>
                <div><dt>Avg days to sell</dt><dd>{stats.averageDays != null ? `${stats.averageDays} days` : "—"}</dd></div>
              </dl>
            </div>
          </section>
        )}

        {has("comps") && comps.length > 0 && (
          <section className="report-section">
            <h2>Comparable sales</h2>
            <table className="report-table">
              <thead>
                <tr><th>#</th><th>Address</th><th>Beds / baths / sq ft</th><th className="num">Sale price</th><th>Sold</th><th className="num">$/sq ft</th><th>Bought</th><th className="num">Days to sell</th></tr>
              </thead>
              <tbody>
                {comps.map((comp) => {
                  const days = daysBetween(comp.purchaseDate, comp.saleDate)
                  return (
                    <tr key={comp.id} className={comp.include ? undefined : "is-excluded"}>
                      <td>{comp.number}</td>
                      <td>
                        <b>{comp.address}</b>
                        <small>{comp.city || property.city}{comp.include ? "" : " · not used in the ARV"}</small>
                        <small className="report-links"><a href={comp.zillowUrl || zillowLink(comp.address, comp.city || property.city)}>Zillow</a> · <a href={mapsLink(comp.address, comp.city || property.city)}>Map</a></small>
                      </td>
                      <td>{[comp.beds != null ? `${comp.beds} bd` : "", comp.baths != null ? `${comp.baths} ba` : "", comp.sqft ? `${Number(comp.sqft).toLocaleString("en-US")}` : ""].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="num">{money(comp.salePrice)}</td>
                      <td>{shortDate(comp.saleDate)}</td>
                      <td className="num">{comp.salePrice && comp.sqft ? `$${Math.round(comp.salePrice / comp.sqft).toLocaleString("en-US")}` : "—"}</td>
                      <td>{comp.purchasePrice != null ? money(comp.purchasePrice) : "—"}{comp.purchaseDate ? <small>{shortDate(comp.purchaseDate)}</small> : null}</td>
                      <td className="num">{days != null && days >= 0 ? days : "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {comps.some((comp) => comp.notes) && (
              <ul className="report-notes-list">
                {comps.filter((comp) => comp.notes).map((comp) => <li key={comp.id}><b>#{comp.number}</b> {comp.notes}</li>)}
              </ul>
            )}
          </section>
        )}

        {has("map") && comps.length > 0 && (
          <section className="report-section report-keep">
            <h2>Map</h2>
            <p className="report-muted">S is {property.address}. Numbers match the comparable sales.</p>
            {location ? <CompsMap subject={{ address: property.address, lat: location.subject?.lat ?? property.lat, lng: location.subject?.lng ?? property.lng }} comps={comps} onReady={() => setMapReady(true)} className="report-map" /> : <p className="report-muted">Finding the addresses…</p>}
          </section>
        )}

        {has("compPhotos") && usedComps.concat(comps.filter((comp) => !comp.include)).some((comp) => comp.photoIds.length) && (
          <section className="report-section">
            <h2>Comp photos</h2>
            {comps.filter((comp) => comp.photoIds.length).map((comp) => (
              <div key={comp.id} className="report-photo-group">
                <h3>#{comp.number} {comp.address}{comp.salePrice ? ` · ${money(comp.salePrice)}` : ""}</h3>
                <div className="report-photos">
                  {comp.photoIds.slice(0, 6).map((photo) => <img key={photo} src={photoUrl(photo)} alt={`${comp.address}`} />)}
                </div>
              </div>
            ))}
          </section>
        )}

        {has("scope") && rows.length > 0 && (
          <section className="report-section">
            <h2>Rehab budget and line items</h2>
            <table className="report-table">
              <thead><tr><th>Line item</th><th className="num">Budget</th><th className="num">Drawn</th><th className="num">Pending</th><th className="num">Remaining</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.title}>
                    <td><b>{row.title}</b>{row.description ? <small>{row.description}</small> : null}</td>
                    <td className="num">{row.budget != null ? money(row.budget) : "—"}</td>
                    <td className="num">{row.drawn ? money(row.drawn) : "—"}</td>
                    <td className="num">{row.pending ? money(row.pending) : "—"}</td>
                    <td className="num">{row.budget != null ? money(row.budget - row.drawn - row.pending) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td className="num">{money(totalBudget)}</td><td className="num">{money(drawn)}</td><td className="num">{money(pending)}</td><td className="num">{totalBudget != null ? money(totalBudget - drawn - pending) : "—"}</td></tr>
              </tfoot>
            </table>
          </section>
        )}

        {has("draws") && draws.length > 0 && (
          <section className="report-section">
            <h2>Draw history</h2>
            <p className="report-muted">{money(drawn)} drawn · {money(received)} received{pending ? ` · ${money(pending)} pending` : ""}</p>
            <table className="report-table">
              <thead><tr><th>Draw</th><th>Status</th><th>Line items</th><th className="num">Amount</th><th className="num">Received</th></tr></thead>
              <tbody>
                {[...draws].sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true })).map((draw) => (
                  <tr key={draw.id}>
                    <td><b>{draw.title}</b>{draw.fundedDate ? <small>Funded {shortDate(draw.fundedDate)}</small> : draw.requestedDate ? <small>Forecast {shortDate(draw.requestedDate)}</small> : null}</td>
                    <td>{isPendingDraw(draw) ? "Pending" : draw.status}</td>
                    <td>{(draw.lines || []).length ? draw.lines.map((line) => `${line.title} ${money(line.amount)}`).join(" · ") : "—"}</td>
                    <td className="num">{money(draw.amount)}</td>
                    <td className="num">{money(drawPulled(draw))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {has("photos") && photos.length > 0 && (
          <section className="report-section">
            <h2>Site photos</h2>
            <div className="report-photos">
              {photos.map((photo) => <img key={photo.id} src={photo.url || photoUrl(photo.id)} alt={photo.name} />)}
            </div>
          </section>
        )}

        {has("financing") && loans.length > 0 && (
          <section className="report-section">
            <h2>Financing</h2>
            <table className="report-table">
              <thead><tr><th>Lender</th><th>Type</th><th className="num">Balance</th><th className="num">Monthly payment</th><th>Matures</th></tr></thead>
              <tbody>
                {loans.map((loan) => (
                  <tr key={loan.id}>
                    <td><b>{loan.lender || loan.lenderName || "Lender"}</b>{loan.loanNumber ? <small>#{loan.loanNumber}</small> : null}</td>
                    <td>{loan.label || "—"}</td>
                    <td className="num">{money(loan.balance)}</td>
                    <td className="num">{money(loan.payment)}</td>
                    <td>{shortDate(loan.maturity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {has("notes") && settings.notes && (
          <section className="report-section">
            <h2>Notes</h2>
            <p className="report-text">{settings.notes}</p>
          </section>
        )}

        <footer className="report-foot">Prepared with SynergiFund · {property.address} · {new Date().toLocaleDateString("en-US")}</footer>
      </article>
    </div>
  )
}
