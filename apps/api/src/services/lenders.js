import { Lender, Loan } from "../models/index.js"

export async function ensureLenders() {
  const loans = await Loan.find({ $or: [{ lenderId: null }, { lenderId: { $exists: false } }] })
  for (const loan of loans) {
    const lender = await lenderForName(loan.lender || "Not provided")
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
  const balance = loans.reduce((total, loan) => total + Number(loan.balance || 0), 0)
  const payment = loans.reduce((total, loan) => total + Number(loan.payment || 0), 0)
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
