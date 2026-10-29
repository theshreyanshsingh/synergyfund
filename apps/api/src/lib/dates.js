const TEAM_TIMEZONE = process.env.TEAM_TIMEZONE || "America/New_York"

// Today's date (YYYY-MM-DD) where the team works, not the server's UTC day: at 9pm in Florida it is still today.
export function teamToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

// The hour (0–23) on the team's clock, for the daily backup.
export function teamHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TEAM_TIMEZONE, hour: "2-digit", hourCycle: "h23" }).format(date)) % 24
}

export function teamTimezone() {
  return TEAM_TIMEZONE
}

// A day written YYYY-MM-DD that is on the calendar (2026-02-31 is not).
export function isDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""))
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCDate() === Number(match[3]) && date.getUTCMonth() === Number(match[2]) - 1
}
