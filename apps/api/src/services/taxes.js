import { TAX_YEAR_MAX, TAX_YEAR_MIN, taxYears } from "@synergifund/shared"

function money(value) {
  const typed = String(value ?? "").replace(/[$,\s]/g, "")
  if (!typed) return { value: null }
  const number = Number(typed)
  return Number.isFinite(number) && number >= 0 && number < 1e12 ? { value: Math.round(number * 100) / 100 } : { error: true }
}

// The tax years as entered on Property Info: { rows } to save, newest first, or { error } for the first row that can't
// be saved. A row with neither amount is left out (this year and the two before it show anyway). A year keeps when it
// was last marked paid.
export function readTaxYears(list, saved = []) {
  if (!Array.isArray(list) || list.length > 200) return { error: "Those tax years could not be saved." }
  const paidOn = new Map(saved.map((row) => [row.year, row.paidOn]))
  const seen = new Set()
  const rows = []
  for (const entry of list) {
    const propertyTaxes = money(entry?.propertyTaxes)
    const taxAssessment = money(entry?.taxAssessment)
    const yearText = String(entry?.year ?? "").trim()
    const blank = !propertyTaxes.error && !taxAssessment.error && propertyTaxes.value == null && taxAssessment.value == null
    if (!yearText) {
      if (blank) continue
      return { error: "Enter the year for each row, like 2026." }
    }
    const year = Number(yearText)
    if (!/^\d{4}$/.test(yearText) || year < TAX_YEAR_MIN || year > TAX_YEAR_MAX) return { error: "Enter each year as four digits, like 2026." }
    if (seen.has(year)) return { error: `${year} is in the list twice.` }
    seen.add(year)
    if (propertyTaxes.error) return { error: `Enter the property taxes for ${year} in dollars, like 2310.` }
    if (taxAssessment.error) return { error: `Enter the tax assessment for ${year} in dollars, like 185000.` }
    if (blank) continue
    rows.push({
      year,
      ...(propertyTaxes.value != null ? { propertyTaxes: propertyTaxes.value } : {}),
      ...(taxAssessment.value != null ? { taxAssessment: taxAssessment.value } : {}),
      ...(paidOn.get(year) ? { paidOn: paidOn.get(year) } : {}),
    })
  }
  return { rows: rows.sort((a, b) => b.year - a.year) }
}

// A property whose tax amount is from before the rows has it saved as its row, and the old amount and due date are
// cleared (the due date no longer shows anywhere). Returns the property's rows.
export function keepEarlierTaxes(property) {
  if (!property.taxYears?.length && property.taxAmount != null) {
    property.taxYears = taxYears(property).map(({ year, propertyTaxes }) => ({ year, ...(propertyTaxes != null ? { propertyTaxes } : {}) }))
  }
  property.taxAmount = undefined
  property.taxDueDate = undefined
  return property.taxYears
}

const dollars = (value) => (value == null ? "blank" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

// What changed in the tax years, for the activity log: "Property taxes 2026 $2,310.00 → $2,400.00 · 2023 removed".
export function taxYearChanges(before, after) {
  const left = new Map(taxYears(before).map((row) => [row.year, row]))
  const right = new Map(taxYears(after).map((row) => [row.year, row]))
  const years = [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => b - a)
  const changes = []
  for (const year of years) {
    const was = left.get(year)
    const now = right.get(year)
    if (!now) {
      changes.push(`Taxes ${year} removed`)
      continue
    }
    if (!was) {
      changes.push(`Taxes ${year} added: ${[now.propertyTaxes != null ? `property taxes ${dollars(now.propertyTaxes)}` : "", now.taxAssessment != null ? `assessment ${dollars(now.taxAssessment)}` : ""].filter(Boolean).join(", ")}`)
      continue
    }
    if (was.propertyTaxes !== now.propertyTaxes) changes.push(`Property taxes ${year} ${dollars(was.propertyTaxes)} → ${dollars(now.propertyTaxes)}`)
    if (was.taxAssessment !== now.taxAssessment) changes.push(`Tax assessment ${year} ${dollars(was.taxAssessment)} → ${dollars(now.taxAssessment)}`)
  }
  return changes.join(" · ")
}
