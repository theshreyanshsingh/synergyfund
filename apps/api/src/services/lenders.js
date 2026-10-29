import { isPaidOff } from "@synergifund/shared"
import { Lender, Loan } from "../models/index.js"

export async function ensureLenders() {
  // Only older loans that name a lender get linked; a loan saved without a lender stays that way.
  const loans = await Loan.find({ $or: [{ lenderId: null }, { lenderId: { $exists: false } }], lender: { $nin: [null, "", "Not provided"] } })
  for (const loan of loans) {
    const lender = await lenderForName(loan.lender)
    loan.lenderId = lender._id
    loan.lender = lender.name
    if (!loan.label) loan.label = "Financed"
    await loan.save()
  }
}

export async function lenderForName(name) {
  const clean = String(name || "").trim() || "Not provided"
  const existing = await Lender.findOne({ name: new RegExp(`^${escapeRegex(clean)}$`, "i") })
  if (existing) return existing
  return Lender.create({ name: clean, terms: "" })
}

export function presentLender(lender, loans = []) {
  const open = loans.filter((loan) => !isPaidOff(loan))
  const balance = open.reduce((total, loan) => total + Number(loan.balance || 0), 0)
  const payment = open.reduce((total, loan) => total + Number(loan.payment || 0), 0)
  return {
    id: String(lender._id),
    name: lender.name,
    terms: lender.terms || "",
    properties: loans.length,
    balance,
    payment,
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
