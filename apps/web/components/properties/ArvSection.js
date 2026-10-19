"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { MIN_COMPS, compStats, daysBetween, mapsLink, zillowLink } from "@synergifund/shared"
import { FormSheet } from "../ui/FormSheet"
import { Icon } from "../ui/Icon"
import { api } from "../../lib/api"
import { CompsMap } from "./CompsMap"

const BLANK_COMP = { address: "", city: "", salePrice: "", saleDate: "", purchasePrice: "", purchaseDate: "", beds: "", baths: "", sqft: "", zillowUrl: "", notes: "" }

export function money(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value))
}

export function shortDate(value) {
  if (!value) return "—"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  if (!day) return value
  return `${Number(month)}/${Number(day)}/${year}`
}

export function photoUrl(id) {
  return `/api/documents/${id}/raw`
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function useCompLocations(property, enabled = true) {
  const [location, setLocation] = useState(null)
  const signature = [property.address, property.city, ...(property.comps || []).map((comp) => `${comp.id}:${comp.address}:${comp.city}`)].join("|")
  useEffect(() => {
    if (!enabled) return undefined
    let stale = false
    api(`/properties/${property.id}/location`)
      .then((data) => !stale && setLocation(data))
      .catch(() => !stale && setLocation({ subject: null, comps: [] }))
    return () => {
      stale = true
    }
    // Look up again only when an address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.id, signature, enabled])
  return location
}

export function placedComps(property, location) {
  const spots = new Map((location?.comps || []).map((spot) => [spot.id, spot]))
  return (property.comps || []).map((comp, index) => ({
    ...comp,
    number: index + 1,
    lat: comp.lat ?? spots.get(comp.id)?.lat ?? null,
    lng: comp.lng ?? spots.get(comp.id)?.lng ?? null,
  }))
}

function compAddress(comp) {
  const address = String(comp.address || "").trim()
  const city = String(comp.city || "").trim()
  if (!city || address.toLowerCase().includes(city.toLowerCase())) return address
  return `${address}, ${city}`
}

// Plain text for lenders and appraisers. Only comps ticked "Use in ARV" are copied.
export function compsCopyText(property, stats) {
  const used = (property.comps || []).filter((comp) => comp.include !== false)
  const arv = property.arv ?? stats.suggested?.value ?? null
  const lines = used.map((comp, index) => `Comp ${index + 1}: ${compAddress(comp)} - ${Number(comp.salePrice) > 0 ? money(comp.salePrice) : "price not entered"}`)
  return ["Comparable Sales:", ...lines, "", `ARV: ${arv != null ? money(arv) : "not set"}`].join("\n")
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  }
}

function updatedLabel(value) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

export function ArvSection({ property, writable, onChanged }) {
  const [editing, setEditing] = useState(null)
  const [copied, setCopied] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [facts, setFacts] = useState({ sqft: property.sqft ?? "", beds: property.beds ?? "", baths: property.baths ?? "" })
  const comps = property.comps || []
  const stats = useMemo(() => compStats(comps, property.sqft, { beds: property.beds, baths: property.baths }), [comps, property.sqft, property.beds, property.baths])
  const location = useCompLocations(property)
  const numbered = placedComps(property, location)
  const subject = { address: property.address, lat: location?.subject?.lat ?? property.lat, lng: location?.subject?.lng ?? property.lng }

  useEffect(() => {
    setFacts({ sqft: property.sqft ?? "", beds: property.beds ?? "", baths: property.baths ?? "" })
  }, [property.sqft, property.beds, property.baths])

  async function run(label, task) {
    setBusy(label)
    setError("")
    try {
      await task()
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy("")
    }
  }

  function number(value) {
    const clean = String(value ?? "").replace(/[$,\s]/g, "")
    if (!clean) return null
    const parsed = Number(clean)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN
  }

  function saveFacts(event) {
    event.preventDefault()
    const body = { sqft: number(facts.sqft), beds: number(facts.beds), baths: number(facts.baths) }
    if (Object.values(body).some((value) => Number.isNaN(value))) {
      setError("Square feet, beds and baths need to be numbers.")
      return
    }
    run("facts", () => api(`/properties/${property.id}`, { method: "PATCH", body }))
  }

  function applyValue(method) {
    run("arv", () => api(`/properties/${property.id}`, { method: "PATCH", body: { arv: method.value, arvMethod: `${method.label} (${stats.count} comps)`, arvDate: today() } }))
  }

  const factsChanged = String(facts.sqft) !== String(property.sqft ?? "") || String(facts.beds) !== String(property.beds ?? "") || String(facts.baths) !== String(property.baths ?? "")

  return (
    <div className="arv">
      {error && <p className="banner">{error}</p>}
      <section className="panel property-card arv-value">
        <div className="arv-value-head">
          <div>
            <h2>After repair value</h2>
            <p className="property-missing">Worked out from comparable sales. At least {MIN_COMPS} comps with a sale price are needed.</p>
          </div>
          <div className="arv-current">
            <small>ARV on file</small>
            <b>{money(property.arv)}</b>
            <span>{property.arv != null ? [property.arvMethod, property.arvDate ? `set ${shortDate(property.arvDate)}` : ""].filter(Boolean).join(" · ") || "Entered by hand" : "Not set yet"}</span>
          </div>
        </div>
        <div className="arv-figures">
          <span><small>Comps used</small><b>{stats.count} of {comps.length}</b></span>
          <span><small>Range</small><b>{stats.low != null ? `${money(stats.low)} – ${money(stats.high)}` : "—"}</b></span>
          <span><small>Median sale</small><b>{money(stats.median)}</b></span>
          <span><small>Median $/sq ft</small><b>{stats.ppsfMedian ? `$${Math.round(stats.ppsfMedian).toLocaleString("en-US")}` : "—"}</b></span>
          <span><small>Avg days to sell</small><b>{stats.averageDays != null ? `${stats.averageDays} days` : "—"}</b></span>
        </div>
        {!stats.ready ? (
          <p className="arv-wait">Add {MIN_COMPS - stats.count} more {MIN_COMPS - stats.count === 1 ? "comp" : "comps"} with a sale price to calculate the ARV.</p>
        ) : (
          <div className="arv-methods">
            {stats.methods.map((method, index) => (
              <div key={method.key} className={index === 0 ? "arv-method is-suggested" : "arv-method"}>
                <span><b>{money(method.value)}</b><small>{method.label}{index === 0 ? " · suggested" : ""}</small></span>
                {writable && (
                  <button type="button" className={index === 0 ? "primary" : "import-button"} disabled={Boolean(busy) || property.arv === method.value} onClick={() => applyValue(method)}>
                    {property.arv === method.value ? "On file" : busy === "arv" ? "Saving…" : "Use as ARV"}
                  </button>
                )}
              </div>
            ))}
            {!property.sqft && <p className="arv-wait">Add the property’s square feet below to also value it by price per square foot.</p>}
          </div>
        )}
        <form className="arv-facts" onSubmit={saveFacts}>
          <label className="field"><span>Square feet</span><input inputMode="numeric" value={facts.sqft} disabled={!writable} onChange={(event) => setFacts({ ...facts, sqft: event.target.value })} /></label>
          <label className="field"><span>Beds</span><input inputMode="decimal" value={facts.beds} disabled={!writable} onChange={(event) => setFacts({ ...facts, beds: event.target.value })} /></label>
          <label className="field"><span>Baths</span><input inputMode="decimal" value={facts.baths} disabled={!writable} onChange={(event) => setFacts({ ...facts, baths: event.target.value })} /></label>
          {writable && <button type="submit" className="import-button" disabled={!factsChanged || Boolean(busy)}>{busy === "facts" ? "Saving…" : "Save details"}</button>}
        </form>
      </section>

      <section className="panel property-card">
        <div className="property-card-head">
          <div>
            <h2>Map</h2>
            <p className="property-missing">S is this property. Numbers match the comps below.</p>
          </div>
        </div>
        {location ? <CompsMap subject={subject} comps={numbered} /> : <p className="property-missing">Finding the addresses…</p>}
      </section>

      <section className="panel property-card">
        <div className="property-card-head">
          <div>
            <h2>Comparable sales</h2>
            <p className="property-missing">{comps.length ? `${comps.length} ${comps.length === 1 ? "comp" : "comps"}. Untick “Use in ARV” to leave one out of the value.` : "No comps yet."}</p>
            {comps.length > 0 && updatedLabel(property.compsUpdatedAt) && <p className="comps-updated">Last updated {updatedLabel(property.compsUpdatedAt)}</p>}
          </div>
          <div className="comps-actions">
            {comps.length > 0 && (
              <button
                type="button"
                className="tool"
                disabled={!comps.some((comp) => comp.include !== false)}
                title={comps.some((comp) => comp.include !== false) ? "Copy the comps ticked “Use in ARV” and the ARV" : "Tick “Use in ARV” on at least one comp"}
                onClick={async () => {
                  const ok = await copyText(compsCopyText(property, stats))
                  setCopied(ok ? "Copied" : "Copy failed")
                  setTimeout(() => setCopied(""), 2000)
                }}
              >
                {copied || "Copy all"}
              </button>
            )}
            {writable && <button type="button" className="primary" onClick={() => setEditing({ ...BLANK_COMP })}><Icon name="plus" size={14} />Add comp</button>}
          </div>
        </div>
        <div className="comp-list">
          {numbered.map((comp) => (
            <CompCard
              key={comp.id}
              comp={comp}
              property={property}
              writable={writable}
              busy={busy}
              onEdit={() => setEditing({ ...comp, id: comp.id })}
              onToggle={() => run(`include-${comp.id}`, () => api(`/properties/${property.id}/comps/${comp.id}`, { method: "PATCH", body: { include: !comp.include } }))}
              onRemove={() => {
                if (window.confirm(`Remove the comp at ${comp.address}? Its photos are deleted too.`)) run(`remove-${comp.id}`, () => api(`/properties/${property.id}/comps/${comp.id}`, { method: "DELETE" }))
              }}
              onPhotos={(files) => {
                const body = new FormData()
                for (const file of files) body.append("photos", file, file.name)
                return run(`photos-${comp.id}`, () => api(`/properties/${property.id}/comps/${comp.id}/photos`, { method: "POST", body }))
              }}
              onRemovePhoto={(fileId) => run(`photo-${fileId}`, () => api(`/properties/${property.id}/comps/${comp.id}/photos/${fileId}`, { method: "DELETE" }))}
            />
          ))}
        </div>
      </section>

      {editing && (
        <CompForm
          comp={editing}
          property={property}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function CompCard({ comp, property, writable, busy, onEdit, onToggle, onRemove, onPhotos, onRemovePhoto }) {
  const input = useRef(null)
  const days = daysBetween(comp.purchaseDate, comp.saleDate)
  const ppsf = comp.salePrice && comp.sqft ? comp.salePrice / comp.sqft : null
  const zillow = comp.zillowUrl || zillowLink(comp.address, comp.city || property.city)
  return (
    <article className={comp.include ? "comp-card" : "comp-card is-excluded"}>
      <div className="comp-card-head">
        <span className="comp-number">{comp.number}</span>
        <div className="comp-card-title">
          <b>{comp.address}</b>
          <small>{[comp.city || property.city, [comp.beds != null ? `${comp.beds} bd` : "", comp.baths != null ? `${comp.baths} ba` : "", comp.sqft ? `${Number(comp.sqft).toLocaleString("en-US")} sq ft` : ""].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}</small>
        </div>
        <div className="comp-card-price">
          <b>{money(comp.salePrice)}</b>
          <small>{comp.saleDate ? `Sold ${shortDate(comp.saleDate)}` : "Sale date not set"}</small>
        </div>
      </div>
      <dl className="comp-facts">
        <div><dt>Bought</dt><dd>{comp.purchasePrice != null ? money(comp.purchasePrice) : "—"}{comp.purchaseDate ? ` · ${shortDate(comp.purchaseDate)}` : ""}</dd></div>
        <div><dt>Time to sell</dt><dd>{days != null && days >= 0 ? `${days} days` : "—"}</dd></div>
        <div><dt>$ / sq ft</dt><dd>{ppsf ? `$${Math.round(ppsf).toLocaleString("en-US")}` : "—"}</dd></div>
        <div><dt>Spread</dt><dd>{comp.purchasePrice != null && comp.salePrice != null ? money(comp.salePrice - comp.purchasePrice) : "—"}</dd></div>
      </dl>
      {comp.notes && <p className="comp-notes">{comp.notes}</p>}
      {(comp.photoIds.length > 0 || writable) && (
        <div className="comp-photos">
          {comp.photoIds.map((id) => (
            <figure key={id}>
              <a href={photoUrl(id)} target="_blank" rel="noreferrer"><img src={photoUrl(id)} alt={`${comp.address} photo`} loading="lazy" /></a>
              {writable && <button type="button" aria-label="Remove photo" disabled={Boolean(busy)} onClick={() => onRemovePhoto(id)}>×</button>}
            </figure>
          ))}
          {writable && (
            <>
              <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => { const files = [...event.target.files]; event.target.value = ""; if (files.length) onPhotos(files) }} />
              <button type="button" className="comp-photo-add" disabled={Boolean(busy)} onClick={() => input.current?.click()}>
                {busy === `photos-${comp.id}` ? <span className="spinner spinner-sm tw:animate-spin" /> : <Icon name="plus" size={16} />}
                <span>{busy === `photos-${comp.id}` ? "Uploading…" : "Add photos"}</span>
              </button>
            </>
          )}
        </div>
      )}
      <div className="comp-actions">
        <a href={zillow} target="_blank" rel="noreferrer">{comp.zillowUrl ? "Zillow listing" : "Find on Zillow"}</a>
        <a href={mapsLink(comp.address, comp.city || property.city)} target="_blank" rel="noreferrer">Google Maps</a>
        {writable && (
          <>
            <label className="comp-include"><input type="checkbox" checked={comp.include} disabled={Boolean(busy)} onChange={onToggle} />Use in ARV</label>
            <button type="button" onClick={onEdit}>Edit</button>
            <button type="button" className="is-danger" onClick={onRemove}>Remove</button>
          </>
        )}
      </div>
    </article>
  )
}

function CompForm({ comp, property, onClose, onSaved }) {
  const [draft, setDraft] = useState({ ...BLANK_COMP, ...Object.fromEntries(Object.entries(comp).map(([key, value]) => [key, value ?? ""])) })
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }))
  const days = daysBetween(draft.purchaseDate, draft.saleDate)

  async function submit(event) {
    event.preventDefault()
    if (draft.purchaseDate && draft.saleDate && days < 0) {
      setError("The sale date is before the purchase date.")
      return
    }
    setPending(true)
    setError("")
    const body = Object.fromEntries(Object.keys(BLANK_COMP).map((key) => [key, draft[key]]))
    try {
      if (comp.id) await api(`/properties/${property.id}/comps/${comp.id}`, { method: "PATCH", body })
      else await api(`/properties/${property.id}/comps`, { method: "POST", body })
      onSaved()
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow={property.address} title={comp.id ? "Edit comp" : "Add a comp"} hint="A nearby home that sold recently. Photos can be added after saving." onClose={onClose} onSubmit={submit} submitLabel={comp.id ? "Save comp" : "Add comp"} pending={pending} error={error}>
      <div className="form-grid">
        <label className="field wide"><span>Address</span><input value={draft.address} onChange={set("address")} required placeholder="e.g. 1210 W 3rd St" /></label>
        <label className="field"><span>City</span><input value={draft.city} onChange={set("city")} placeholder={property.city || "City"} /></label>
        <label className="field"><span>Sale price</span><input inputMode="decimal" value={draft.salePrice} onChange={set("salePrice")} placeholder="$" /></label>
        <label className="field"><span>Sale date</span><input type="date" value={draft.saleDate} onChange={set("saleDate")} /></label>
        <label className="field"><span>Purchase price <em>· optional</em></span><input inputMode="decimal" value={draft.purchasePrice} onChange={set("purchasePrice")} placeholder="$" /></label>
        <label className="field"><span>Purchase date <em>· optional</em></span><input type="date" value={draft.purchaseDate} onChange={set("purchaseDate")} /></label>
        <p className="chat-form-hint wide">{days != null ? (days >= 0 ? `Took ${days} days from purchase to sale.` : "The sale date is before the purchase date.") : "Add both dates to see how long it took to sell."}</p>
        <label className="field"><span>Beds</span><input inputMode="decimal" value={draft.beds} onChange={set("beds")} /></label>
        <label className="field"><span>Baths</span><input inputMode="decimal" value={draft.baths} onChange={set("baths")} /></label>
        <label className="field"><span>Square feet</span><input inputMode="numeric" value={draft.sqft} onChange={set("sqft")} /></label>
        <label className="field wide"><span>Zillow link <em>· optional</em></span><input value={draft.zillowUrl} onChange={set("zillowUrl")} placeholder={zillowLink(draft.address || "address", draft.city || property.city)} /></label>
        <label className="field wide"><span>Notes <em>· optional</em></span><input value={draft.notes} onChange={set("notes")} placeholder="Condition, upgrades, distance…" /></label>
      </div>
    </FormSheet>
  )
}
