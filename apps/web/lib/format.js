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

// A moment in a list on a phone, short: the time today, Yesterday, the weekday within the week, else the date ("Nov 4",
// with the year when it isn't this year).
export function shortWhen(value) {
  if (!value) return ""
  const date = new Date(value)
  const now = new Date()
  const start = (moment) => new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime()
  const days = Math.round((start(now) - start(date)) / 86400000)
  if (days === 0) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (days === 1) return "Yesterday"
  if (days > 1 && days < 7) return date.toLocaleDateString("en-US", { weekday: "short" })
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })
}

// A day (YYYY-MM-DD) as "Oct 30", with the year when it isn't this year ("Oct 30, 2027"). Anything else as given.
export function day(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""))
  if (!match) return key || ""
  const [year, month, date] = match.slice(1).map(Number)
  return new Date(year, month - 1, date, 12).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}
