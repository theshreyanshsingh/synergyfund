export function money(value) {
  if (value == null || value === "") return "Not entered"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0)
}

// To the cent, for receipts and expense tracking: $1,234.50.
export function dollars(value) {
  if (value == null || value === "") return "—"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)
}

// The exact moment, for the activity log: "Oct 22, 2026, 9:37:12 AM".
export function exactly(value) {
  if (!value) return ""
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })
}

export function when(value) {
  if (!value) return ""
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
