// The title company on a property (Property Info › Title company): who handles the closing, the person working the
// file and how to reach them, and the title or escrow file number. Each property keeps its own; a title company
// already entered on another property is offered while typing one (titleCompanyChoices), with its contact details.

// [field, label, longest]
export const TITLE_FIELDS = [
  ["name", "Title company", 160],
  ["contactName", "Contact", 120],
  ["phone", "Phone", 40],
  ["email", "Email", 160],
  ["address", "Office address", 300],
  ["fileNumber", "File #", 80],
  ["notes", "Notes", 2000],
]

// The details that belong to the company (not to this property's file), filled in from another property.
const COMPANY_FIELDS = ["contactName", "phone", "email", "address"]

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Every field, "" when not entered.
export function titleCompanyOf(property) {
  const saved = property?.titleCompany || {}
  return Object.fromEntries(TITLE_FIELDS.map(([key]) => [key, String(saved[key] || "")]))
}

// What a form sent, trimmed (one-line fields keep single spaces; notes keep their lines). { value } or { error }.
export function readTitleCompany(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Send the title company's details." }
  const value = {}
  for (const [key, label, longest] of TITLE_FIELDS) {
    const raw = input[key] == null ? "" : String(input[key])
    const text = key === "notes" ? raw.replace(/\r\n/g, "\n").trim() : raw.replace(/\s+/g, " ").trim()
    if (text.length > longest) return { error: `${label} is too long (up to ${longest} characters).` }
    value[key] = text
  }
  if (value.email && !EMAIL.test(value.email)) return { error: "Enter the email like closings@titleco.com." }
  if (!value.name && TITLE_FIELDS.some(([key]) => key !== "name" && value[key])) return { error: "Enter the title company's name." }
  return { value }
}

// For the activity log: a new or removed title company by name, else that its details changed ("" if nothing did).
export function titleCompanyChange(before, after) {
  const was = titleCompanyOf(before)
  const now = titleCompanyOf(after)
  if (TITLE_FIELDS.every(([key]) => was[key] === now[key])) return ""
  if (was.name.toLowerCase() !== now.name.toLowerCase()) return `Title company ${was.name || "none"} → ${now.name || "none"}`
  return `Title company ${now.name} details updated`
}

// The title companies on these properties, once each by name, with the contact details of the most recently updated
// property that has them and how many properties use each (most used first).
export function titleCompanyChoices(properties) {
  const byName = new Map()
  const newest = [...properties].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
  for (const property of newest) {
    const title = titleCompanyOf(property)
    if (!title.name) continue
    const key = title.name.toLowerCase()
    const entry = byName.get(key)
    if (!entry) {
      byName.set(key, { name: title.name, ...Object.fromEntries(COMPANY_FIELDS.map((field) => [field, title[field]])), properties: 1 })
      continue
    }
    entry.properties += 1
    for (const field of COMPANY_FIELDS) if (!entry[field] && title[field]) entry[field] = title[field]
  }
  return [...byName.values()].sort((a, b) => b.properties - a.properties || a.name.localeCompare(b.name))
}
