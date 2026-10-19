const TEAM_TIMEZONE = process.env.TEAM_TIMEZONE || "America/New_York"

// Today's date (YYYY-MM-DD) where the team works, not the server's UTC day: at 9pm in Florida it is still today.
export function teamToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TEAM_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}
