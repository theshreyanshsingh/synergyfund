"use client"

import { useMemo, useState } from "react"
import { COMPANY_TYPES } from "@synergifund/shared"

const US_STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]

export function companyForm(company = {}) {
  return {
    name: company.name || "",
    entityType: company.entityType || "",
    stateOfFormation: company.stateOfFormation || "",
    formedOn: company.formedOn || "",
    address: company.address || "",
    contactName: company.contactName || "",
    phone: company.phone || "",
    email: company.email || "",
    notes: company.notes || "",
  }
}

// The company details, used when adding a company and when modifying one.
export function CompanyFields({ value, onChange }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.value })
  const types = value.entityType && !COMPANY_TYPES.includes(value.entityType) ? [...COMPANY_TYPES, value.entityType] : COMPANY_TYPES
  return (
    <>
      <label className="field wide"><span>Company name</span><input value={value.name} onChange={set("name")} placeholder="Synergy Holdings LLC" maxLength={120} required /></label>
      <label className="field"><span>Type</span>
        <select value={value.entityType} onChange={set("entityType")}>
          <option value="">Not set</option>
          {types.map((type) => <option key={type}>{type}</option>)}
        </select>
      </label>
      <label className="field"><span>State of formation</span><input value={value.stateOfFormation} onChange={set("stateOfFormation")} list="company-states" placeholder="Texas" maxLength={60} /></label>
      <label className="field"><span>Formed on</span><input type="date" value={value.formedOn} onChange={set("formedOn")} /></label>
      <label className="field"><span>Contact person</span><input value={value.contactName} onChange={set("contactName")} maxLength={120} /></label>
      <label className="field wide"><span>Address</span><input value={value.address} onChange={set("address")} placeholder="Registered or mailing address" maxLength={300} /></label>
      <label className="field"><span>Phone</span><input type="tel" value={value.phone} onChange={set("phone")} maxLength={40} /></label>
      <label className="field"><span>Email</span><input type="email" value={value.email} onChange={set("email")} maxLength={200} /></label>
      <label className="field wide"><span>Notes</span><textarea value={value.notes} onChange={set("notes")} placeholder="Members, EIN, registered agent, bank or anything else worth keeping" maxLength={4000} /></label>
      <datalist id="company-states">{US_STATES.map((state) => <option key={state} value={state} />)}</datalist>
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
