import { BEHIND_STATUSES, loanStatus, loanType } from "@synergifund/shared"
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

// Loans entered before Loan Type, Interest Rate and Servicer had them written in the terms, like
// "Rate 8.90%; Type Hard Money; Servicer BSI Financial Services". Each part is read into its field while that field
// is blank, and is then left out of the terms. A part that says something else stays in the terms.
const TERM_PARTS = [
  ["interestRate", /^(?:interest\s+)?rate\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)\s*%?$/i, (match) => Number(match[1])],
  ["loanType", /^(?:loan\s+)?type\s*[:=]?\s*(.+)$/i, (match) => loanType(match[1]) || undefined],
  ["servicer", /^(?:loan\s+)?servicer\s*[:=]?\s*(.+)$/i, (match) => match[1].trim().slice(0, 120) || undefined],
]

const blank = (value) => value == null || value === ""

export function termsParts(loan) {
  const text = String(loan.terms || "")
  const found = {}
  const rest = []
  for (const part of text.split(/\s*[;\n]+\s*/)) {
    const piece = part.trim()
    if (!piece) continue
    const entry = TERM_PARTS.find(([key, pattern]) => found[key] === undefined && blank(loan[key]) && pattern.test(piece))
    const value = entry ? entry[2](piece.match(entry[1])) : undefined
    if (value === undefined) rest.push(piece)
    else found[entry[0]] = value
  }
  return { found, terms: Object.keys(found).length ? rest.join("; ") : text }
}

// Saving a loan saves what was read from its terms into the fields, so the terms shown and saved stay the same.
export function liftTermsParts(loan) {
  const { found, terms } = termsParts(loan)
  if (!Object.keys(found).length) return false
  Object.assign(loan, found)
  loan.terms = terms
  return true
}

export function loanFields(loan) {
  const { found, terms } = termsParts(loan)
  const status = loanStatus(loan.status)
  const behind = BEHIND_STATUSES.includes(status)
  return {
    status,
    terms,
    loanType: loanType(loan.loanType) || found.loanType || "",
    interestRate: loan.interestRate ?? found.interestRate ?? null,
    servicer: loan.servicer || found.servicer || "",
    originationDate: loan.originationDate || "",
    originalAmount: loan.originalAmount ?? null,
    paymentDay: loan.paymentDay ?? null,
    paymentsBehind: behind ? loan.paymentsBehind ?? null : null,
    pastDueAmount: behind ? loan.pastDueAmount ?? null : null,
    ...loanSchedule(loan),
  }
}
