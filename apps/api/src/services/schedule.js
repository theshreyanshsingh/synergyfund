function key(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function loanPaymentDates(loan, from, to) {
  const day = Number(loan?.paymentDay)
  if (!Number.isInteger(day) || day < 1 || day > 31 || !(Number(loan?.payment) > 0)) return []
  const [fromYear, fromMonth] = from.split("-").map(Number)
  const dates = []
  for (let offset = 0; offset < 40; offset += 1) {
    const year = fromYear + Math.floor((fromMonth - 1 + offset) / 12)
    const month = (fromMonth - 1 + offset) % 12
    const last = new Date(year, month + 1, 0).getDate()
    const date = key(new Date(year, month, Math.min(day, last)))
    if (date > to) break
    if (date >= from) dates.push(date)
  }
  const maturity = String(loan.maturity || "").slice(0, 10)
  return maturity ? dates.filter((date) => date <= maturity) : dates
}

const STEPS = {
  Weekly: { days: 7 },
  "Every 2 weeks": { days: 14 },
  Monthly: { months: 1 },
  Quarterly: { months: 3 },
  Yearly: { months: 12 },
}

function occurrence(anchor, step, index) {
  const [year, month, day] = anchor.split("-").map(Number)
  if (step.days) return key(new Date(year, month - 1, day + step.days * index))
  const total = month - 1 + step.months * index
  const targetYear = year + Math.floor(total / 12)
  const targetMonth = total % 12
  const last = new Date(targetYear, targetMonth + 1, 0).getDate()
  return key(new Date(targetYear, targetMonth, Math.min(day, last)))
}

export function repeats(recurrence) {
  return Boolean(STEPS[recurrence])
}

export function paymentDates(bill, from, to) {
  const due = String(bill?.due || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return []
  const step = STEPS[bill.recurrence]
  if (!step) return due >= from && due <= to ? [due] : []
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(bill.startDue || "")) ? bill.startDue : due
  const dates = []
  for (let index = 0; index < 600; index += 1) {
    const date = occurrence(anchor, step, index)
    if (date > to) break
    if (date >= due && date >= from) dates.push(date)
  }
  return dates
}

export function nextPaymentDate(bill) {
  const step = STEPS[bill?.recurrence]
  const due = String(bill?.due || "").slice(0, 10)
  if (!step || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return ""
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(bill.startDue || "")) ? bill.startDue : due
  for (let index = 0; index < 600; index += 1) {
    const date = occurrence(anchor, step, index)
    if (date > due) return date
  }
  return ""
}
