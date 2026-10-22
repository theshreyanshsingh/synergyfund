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
