"use client"

import { US_STATES } from "@synergifund/shared"

// The state of a property's address, as its two-letter code.
export function StateSelect({ name, value, onChange }) {
  return (
    <select name={name} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="address-level1">
      <option value="">—</option>
      {US_STATES.map((code) => <option key={code}>{code}</option>)}
    </select>
  )
}
