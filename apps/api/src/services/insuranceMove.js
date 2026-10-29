import { isPaidOff } from "@synergifund/shared"
import { Loan, Property } from "../models/index.js"
import { teamToday } from "../lib/dates.js"
import { insuranceDates } from "./schedule.js"

// Insurance used to be kept on loans; it now lives on the property (Property Info). At start-up, a loan's insurance
// (amount, how often, next due date) is moved to its property when the property has none yet (no insurance and no
// policies), then cleared from the loan, so nothing is lost and nothing is moved twice. An open loan is preferred over
// a paid-off one. What other loans of that property still hold is cleared once its policies are changed
// (clearLoanInsurance), so a property left with no policies doesn't get it back here. Loans kept one due date and
// repeated it, so an old date moves as its next payment from today (not as an overdue one). The property shows it as
// its first policy (insurancePolicies in the shared package).
const FREQUENCY = { Monthly: "Monthly", Quarterly: "Quarterly", "Every 6 months": "Semi-Annually", "Semi-Annually": "Semi-Annually", Yearly: "Yearly" }

export async function moveLoanInsurance() {
  const loans = await Loan.find({ $or: [{ insurancePayment: { $ne: null } }, { insuranceDue: { $nin: [null, ""] } }] }).lean()
  if (!loans.length) return 0
  const byProperty = new Map()
  for (const loan of loans) {
    if (!loan.propertyId) continue
    const key = String(loan.propertyId)
    if (!byProperty.has(key)) byProperty.set(key, [])
    byProperty.get(key).push(loan)
  }
  let moved = 0
  for (const [propertyId, list] of byProperty) {
    const property = await Property.findById(propertyId).select("insuranceAmount insuranceDue insurancePolicies").lean()
    if (!property || property.insuranceAmount != null || property.insuranceDue || property.insurancePolicies?.length) continue
    const pick = [...list].sort((a, b) => Number(isPaidOff(a)) - Number(isPaidOff(b)) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0]
    const frequency = FREQUENCY[pick.insuranceFrequency] || "Yearly"
    const due = String(pick.insuranceDue || "").slice(0, 10)
    const today = teamToday()
    const next = /^\d{4}-\d{2}-\d{2}$/.test(due) ? (due >= today ? due : insuranceDates({ insuranceDue: due, insuranceFrequency: frequency }, today, "9999-12-31")[0] || due) : ""
    await Property.updateOne({ _id: propertyId }, {
      $set: {
        ...(pick.insurancePayment != null ? { insuranceAmount: Number(pick.insurancePayment) } : {}),
        insuranceFrequency: frequency,
        ...(next ? { insuranceDue: next } : {}),
      },
    })
    await Loan.updateOne({ _id: pick._id }, { $unset: { insurancePayment: 1, insuranceFrequency: 1, insuranceDue: 1 } })
    moved += 1
  }
  if (moved) console.log(`Moved insurance from ${moved} ${moved === 1 ? "loan" : "loans"} to Property Info`)
  return moved
}
