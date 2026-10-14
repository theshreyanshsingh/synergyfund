"use client"

import { useMemo, useState } from "react"
import { COMPANY_TYPES } from "@synergifund/shared"

const US_STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]

const STATE_CODES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]

// The company form. formedOn is the effective date and contactName the authorized member (their saved names).
export function companyForm(company = {}) {
  const wire = company.wire || {}
  return {
    name: company.name || "",
    entityType: company.entityType || "",
    stateOfFormation: company.stateOfFormation || "",
    formedOn: company.formedOn || "",
    contactName: company.contactName || "",
    address: company.address || "",
    city: company.city || "",
    state: company.state || "",
    zip: company.zip || "",
    notes: company.notes || "",
    ein: company.ein || "",
    wireBankName: wire.bankName || "",
    wireRoutingNumber: wire.routingNumber || "",
    wireAccountNumber: wire.accountNumber || "",
    wireEntityName: wire.entityName || "",
    wireAddress: wire.address || "",
  }
}

export function EinField({ value, onChange }) {
  return <label className="field"><span>EIN Number <em>· optional</em></span><input value={value} onChange={(event) => onChange(event.target.value)} inputMode="numeric" placeholder="12-3456789" maxLength={20} autoComplete="off" /></label>
}

export function WireFields({ value, onChange, entityPlaceholder = "" }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value })
  return (
    <>
      <label className="field wide"><span>Bank Name</span><input value={value.wireBankName} onChange={set("wireBankName")} maxLength={120} autoComplete="off" /></label>
      <label className="field"><span>Routing Number</span><input value={value.wireRoutingNumber} onChange={set("wireRoutingNumber")} inputMode="numeric" placeholder="9 digits" maxLength={20} autoComplete="off" /></label>
      <label className="field"><span>Account Number</span><input value={value.wireAccountNumber} onChange={set("wireAccountNumber")} inputMode="numeric" maxLength={40} autoComplete="off" /></label>
      <label className="field wide"><span>Entity Name</span><input value={value.wireEntityName} onChange={set("wireEntityName")} placeholder={entityPlaceholder} maxLength={120} autoComplete="off" /></label>
      <label className="field wide"><span>Bank Address</span><textarea value={value.wireAddress} onChange={set("wireAddress")} maxLength={300} placeholder="The bank's address" /></label>
    </>
  )
}

// The company details, used when adding a company and when modifying one. Starred details are required;
// the EIN and wire instructions are optional and can be added later from the company's Overview.
export function CompanyFields({ value, onChange }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value })
  const types = value.entityType && !COMPANY_TYPES.includes(value.entityType) ? [...COMPANY_TYPES, value.entityType] : COMPANY_TYPES
  return (
    <>
      <label className="field wide"><span>Company Name <b className="req" aria-hidden="true">*</b></span><input value={value.name} onChange={set("name")} placeholder="Synergy Holdings LLC" maxLength={120} required /></label>
      <label className="field"><span>Entity Type <b className="req" aria-hidden="true">*</b></span>
        <select value={value.entityType} onChange={set("entityType")} required>
          <option value="" disabled>Choose an entity type</option>
          {types.map((type) => <option key={type}>{type}</option>)}
        </select>
      </label>
      <label className="field"><span>State of Formation <b className="req" aria-hidden="true">*</b></span><input value={value.stateOfFormation} onChange={set("stateOfFormation")} list="company-states" placeholder="Texas" maxLength={60} required /></label>
      <label className="field"><span>Effective Date <b className="req" aria-hidden="true">*</b></span><input type="date" value={value.formedOn} onChange={set("formedOn")} required /></label>
      <label className="field"><span>Authorized Member <b className="req" aria-hidden="true">*</b></span><input value={value.contactName} onChange={set("contactName")} maxLength={120} required /></label>
      <label className="field wide"><span>Address <b className="req" aria-hidden="true">*</b></span><input value={value.address} onChange={set("address")} placeholder="Street address" maxLength={200} autoComplete="street-address" required /></label>
      <div className="field wide company-place">
        <label><span>City <b className="req" aria-hidden="true">*</b></span><input value={value.city} onChange={set("city")} maxLength={80} autoComplete="address-level2" required /></label>
        <label><span>State <b className="req" aria-hidden="true">*</b></span><input value={value.state} onChange={set("state")} list="company-state-codes" placeholder="TX" maxLength={40} autoComplete="address-level1" required /></label>
        <label><span>Zip <b className="req" aria-hidden="true">*</b></span><input value={value.zip} onChange={set("zip")} inputMode="numeric" placeholder="75201" maxLength={10} autoComplete="postal-code" pattern="\d{5}(-?\d{4})?" title="5 digits, or ZIP+4" required /></label>
      </div>
      <label className="field wide"><span>Notes <em>· optional</em></span><textarea value={value.notes} onChange={set("notes")} placeholder="Registered agent, members, or anything else worth keeping" maxLength={4000} /></label>
      <EinField value={value.ein} onChange={(ein) => onChange({ ...value, ein })} />
      <p className="company-form-section wide">Wire Instructions <em>· optional</em></p>
      <WireFields value={value} onChange={onChange} entityPlaceholder={value.name} />
      <datalist id="company-states">{US_STATES.map((state) => <option key={state} value={state} />)}</datalist>
      <datalist id="company-state-codes">{STATE_CODES.map((code) => <option key={code} value={code} />)}</datalist>
    </>
  )
}

// Tick the properties a company owns. Properties already in another company say so, and move over when saved.
export function PropertyPicker({ properties, selected, onChange, companyId = "", emptyText = "No properties yet." }) {
  const [query, setQuery] = useState("")
  const options = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return properties
      .filter((property) => !companyId || property.companyId !== companyId)
      .filter((property) => !needle || [property.address, property.city, property.company, property.stage].join(" ").toLowerCase().includes(needle))
  }, [properties, companyId, query])
  const available = properties.filter((property) => !companyId || property.companyId !== companyId)
  const allShown = options.length > 0 && options.every((property) => selected.includes(property.id))

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  }

  function toggleShown() {
    const ids = options.map((property) => property.id)
    onChange(allShown ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])])
  }

  if (!available.length) return <p className="property-missing">{companyId ? "Every property is already in this company." : emptyText}</p>
  const moving = selected.map((id) => properties.find((property) => property.id === id)).filter((property) => property?.companyId && property.companyId !== companyId)
  return (
    <div className="company-picker">
      <div className="company-picker-bar">
        {available.length > 6 && <input type="search" value={query} placeholder="Search properties" onChange={(event) => setQuery(event.target.value)} aria-label="Search properties" />}
        {options.length > 1 && <button type="button" className="tool" onClick={toggleShown}>{allShown ? "Clear" : query ? "Select these" : "Select all"}</button>}
        <em>{selected.length ? `${selected.length} selected` : "None selected"}</em>
      </div>
      <div className="assign-list company-picker-list">
        {options.map((property) => (
          <label key={property.id}>
            <input type="checkbox" checked={selected.includes(property.id)} onChange={() => toggle(property.id)} />
            <span>
              {property.address}
              <small>{[property.city, property.company ? `In ${property.company}` : "Not in a company"].filter(Boolean).join(" · ")}</small>
            </span>
          </label>
        ))}
        {!options.length && <p className="property-missing">No property matches “{query}”.</p>}
      </div>
      {moving.length > 0 && <p className="company-picker-note">{moving.length === 1 ? `${moving[0].address} will move out of ${moving[0].company}.` : `${moving.length} properties will move out of their current company.`}</p>}
    </div>
  )
}
