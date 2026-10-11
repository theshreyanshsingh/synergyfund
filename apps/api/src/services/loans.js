import { insuranceDates, loanPaymentDates } from "./schedule.js"

function key(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

// The next loan payment and insurance dates from today, the same dates the calendar shows.
export function loanSchedule(loan, now = new Date()) {
  const today = key(now)
  const inTwoMonths = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 62))
  const inAYear = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 400))
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
