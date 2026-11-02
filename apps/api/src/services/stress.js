import { isPaidOff, latestPropertyTaxes, NOT_OWNED_STAGES, PERMISSIONS, propertyDrawFigures, rehabLeft, yearlyInsurance } from "@synergifund/shared"
import { Company, Draw, DrawBudget, Expense, Lender, Loan, Property } from "../models/index.js"
import { propertyFilter } from "./access.js"
import { groupByProperty, sumAmounts } from "../lib/group.js"
import { teamToday } from "../lib/dates.js"

// Houses not bought yet carry none of our value, so the stress test leaves them out (and says so), unless one already
// has an open loan: then it is ours, whatever its stage says, and worth what we paid (its rehab hasn't started).
const NOT_BOUGHT_STAGES = ["Under contract", "Lender search"]
// The old placeholder lender, read as no lender (as on the Loans page).
const NO_LENDER = "Not provided"

const known = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value))
// A rent of 0 is read as not entered: no house is let for nothing, and a $0 market rent would carry no refinance.
const rentOf = (value) => (known(value) > 0 ? known(value) : null)
const day = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value || "")) ? String(value).slice(0, 10) : "")

// Today's value: the ARV less the rehab still to do; for a house not started, the purchase price; else what's on file.
function valueOf(property, left) {
  const arv = known(property.arv)
  const purchase = known(property.purchasePrice)
  if (NOT_BOUGHT_STAGES.includes(property.stage) && purchase != null) return { value: purchase, note: "Purchase price (rehab not started)" }
  if (arv != null) return { value: Math.max(0, arv - (left || 0)), note: left > 0 ? "ARV less the rehab still to do" : "ARV" }
  if (purchase != null) return { value: purchase, note: "Purchase price (no ARV entered)" }
  return { value: null, note: "No ARV or purchase price" }
}

// The owned houses as the stress test reads them (stressTest in the shared package does the math, on the page and in
// the Agent). Rehab still to do is the property page's Rehab Left, for houses in Renovation; like the Agent's
// get_property, posted costs count only for someone who can see expenses.
export async function stressRows(user, permissions) {
  const all = await Property.find(propertyFilter(user)).lean()
  const loans = (await Loan.find({ propertyId: { $in: all.map((property) => property._id) } }).lean()).filter((loan) => !isPaidOff(loan))
  const loansOf = groupByProperty(loans)
  const financed = (property) => loansOf.has(String(property._id))
  const sold = all.filter((property) => NOT_OWNED_STAGES.includes(property.stage))
  const notBought = all.filter((property) => NOT_BOUGHT_STAGES.includes(property.stage) && !financed(property))
  const leftOut = new Set([...sold, ...notBought])
  const owned = all.filter((property) => !leftOut.has(property))
  const seesRehab = permissions.includes(PERMISSIONS.drawsRead) && user.role !== "contractor"
  const seesCosts = permissions.includes(PERMISSIONS.expensesRead)
  const building = seesRehab ? owned.filter((property) => property.stage === "Renovation").map((property) => property._id) : []
  const [companies, lenders, budgets, draws, costs] = await Promise.all([
    Company.find({ _id: { $in: owned.map((property) => property.companyId).filter(Boolean) } }).select("name").lean(),
    Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } }).select("name").lean(),
    DrawBudget.find({ propertyId: { $in: building } }).lean(),
    Draw.find({ propertyId: { $in: building } }).lean(),
    seesCosts ? Expense.find({ propertyId: { $in: building }, costTreatment: { $ne: "Exclude from construction margin" } }).select("propertyId amount").lean() : [],
  ])
  const budgetsOf = groupByProperty(budgets)
  const drawsOf = groupByProperty(draws)
  const costsOf = groupByProperty(costs)
  const companyNames = new Map(companies.map((company) => [String(company._id), company.name]))
  const lenderNames = new Map(lenders.filter((lender) => lender.name !== NO_LENDER).map((lender) => [String(lender._id), lender.name]))
  const lenderOf = (loan) => lenderNames.get(String(loan.lenderId || "")) || (loan.lender && loan.lender !== NO_LENDER ? loan.lender : "")
  const rows = owned.map((property) => {
    const id = String(property._id)
    let left = null
    if (seesRehab && property.stage === "Renovation") {
      const own = drawsOf.get(id) || []
      const figures = propertyDrawFigures({ property, budgetRecord: budgetsOf.get(id)?.[0], draws: own })
      left = rehabLeft({ budget: figures.budget ?? property.rehabBudget ?? null, remaining: figures.remaining, drawCount: own.length, spent: sumAmounts(costsOf.get(id)) })
    }
    const { value, note } = valueOf(property, left)
    const actual = rentOf(property.actualRent)
    const market = rentOf(property.marketRent)
    // Rent comes in only on a rented house: the actual rent, or the market rent when no actual rent is entered.
    const rented = property.stage === "Rented"
    const taxes = latestPropertyTaxes(property)
    const insurance = yearlyInsurance(property)
    return {
      id,
      address: property.address,
      city: property.city || "",
      state: property.state || "",
      stage: property.stage || "",
      strategy: property.strategy || "",
      company: companyNames.get(String(property.companyId || "")) || "",
      value,
      valueNote: note,
      rehabLeft: left,
      rent: rented ? actual ?? market ?? 0 : 0,
      rentSource: rented ? (actual != null ? "actual" : market != null ? "market" : "none") : "",
      marketRent: market ?? actual,
      taxes: taxes ? taxes.amount / 12 : null,
      insurance: insurance == null ? null : insurance / 12,
      loans: (loansOf.get(id) || []).map((loan) => {
        const balance = known(loan.balance)
        const payment = known(loan.payment)
        const rate = known(loan.interestRate)
        // No payment on file: interest only on the balance at its rate, marked as estimated.
        const estimated = payment == null && balance != null && rate != null
        return {
          lender: lenderOf(loan),
          balance,
          payment: estimated ? (balance * rate) / 1200 : payment,
          paymentEstimated: estimated,
          rate,
          maturity: day(loan.maturity),
          status: loan.status || "Current",
        }
      }),
    }
  })
  return {
    today: teamToday(),
    rows,
    seesRehab,
    leftOut: {
      notBought: notBought.length,
      sold: sold.length,
      // A sold house whose loan is still open is a record to fix: mark the loan Paid Off.
      soldWithOpenLoans: sold.filter(financed).length,
    },
  }
}
