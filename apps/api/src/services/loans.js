import { loanPaymentDates } from "./schedule.js"
import { teamToday } from "../lib/dates.js"

function shift(key, days) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

// The next loan payment from today (the team's today), the same date the calendar shows. Insurance is on the
// property now (Property Info), not the loan.
export function loanSchedule(loan, now = new Date()) {
  const today = teamToday(now)
  return { nextPaymentDue: loanPaymentDates(loan, today, shift(today, 62))[0] || "" }
}

export function loanFields(loan) {
  return {
    status: loan.status || "Current",
    originalAmount: loan.originalAmount ?? null,
    paymentDay: loan.paymentDay ?? null,
    ...loanSchedule(loan),
  }
}
