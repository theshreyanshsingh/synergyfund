import { insuranceDates, loanPaymentDates } from "./schedule.js"
import { teamToday } from "../lib/dates.js"

function shift(key, days) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

// The next loan payment and insurance dates from today (the team's today), the same dates the calendar shows.
export function loanSchedule(loan, now = new Date()) {
  const today = teamToday(now)
  const inTwoMonths = shift(today, 62)
  const inAYear = shift(today, 400)
  return {
    nextPaymentDue: loanPaymentDates(loan, today, inTwoMonths)[0] || "",
    nextInsuranceDue: insuranceDates(loan, today, inAYear)[0] || "",
  }
}

export function loanFields(loan) {
  return {
    status: loan.status || "Current",
    originalAmount: loan.originalAmount ?? null,
    paymentDay: loan.paymentDay ?? null,
    insurancePayment: loan.insurancePayment ?? null,
    insuranceFrequency: loan.insuranceFrequency || "Yearly",
    insuranceDue: loan.insuranceDue || "",
    ...loanSchedule(loan),
  }
}
