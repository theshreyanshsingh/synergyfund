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
