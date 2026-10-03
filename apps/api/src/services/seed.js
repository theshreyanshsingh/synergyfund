import bcrypt from "bcryptjs"
import {
  User,
  Property,
  Loan,
  DrawBudget,
  Draw,
  Expense,
  Task,
  Bill,
  ReviewItem,
  Activity,
  ConstructionProject,
} from "../models/index.js"

const PASSWORD = "Synergi123!"

function weeksAgo(count) {
  const date = new Date()
  date.setDate(date.getDate() - count * 7)
  return date
}

export async function seedIfEmpty() {
  if (await User.countDocuments()) return
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const admin = await User.create({
    name: "Shreyansh Singh",
    email: "admin@synergifund.com",
    passwordHash,
    role: "admin",
    title: "Signed in · Private workspace",
  })

  const rows = [
    ["1125 Market St", "Jacksonville, FL 32206", "Under contract", "", null, null, "Add purchasing entity’s Purchase Price", "JAX"],
    ["1139 Evergreen Ave", "Jacksonville, FL 32206", "Under contract", "", null, null, "Add purchasing entity’s Purchase Price", "JAX"],
    ["1521 W 2nd St", "Jacksonville, FL 32209", "Under contract", "", null, null, "Add purchasing entity’s Purchase Price", "JAX"],
    ["3005 Ridgepine Dr", "Jacksonville, FL 32277", "Under contract", "", null, null, "Add purchasing entity’s Purchase Price", "JAX"],
    ["1028 Lawfin St W", "Jacksonville, FL 32211", "Under contract", "Fix & flip", 245000, 45000, "Complete sale comparables", "JAX"],
    ["10482 Pinehurst Drive", "Jacksonville, FL 32218", "Under contract", "Fix & flip", 120000, 40000, "Copy deal info for lender outreach", "JAX"],
    ["5568 La Moya Ave APT 10", "Jacksonville, FL 32210", "Exit", "Fix & flip", 180000, 45500, "Reconcile final receipts and check any remaining contractor bills.", "JAX"],
    ["2319 College Street", "Jacksonville, FL 32204", "Renovation", "Fix & flip", 210000, 120000, "Update completed work and prepare the next draw request.", "JAX"],
    ["3535 College Pl", "Jacksonville, FL 32205", "Renovation", "Buy & hold", 190000, 60000, "Set the next action", "JAX"],
    ["5823 Michigan Ave", "Jacksonville, FL 32211", "Renovation", "Rent", 175000, 35000, "Set the next action", "JAX"],
    ["1888 SE 10th St", "Fort Lauderdale, FL 33316", "Complete", "Rent", 640000, 20000, "Lease is in place", "FLL"],
    ["2100 N Ocean Blvd", "Fort Lauderdale, FL 33305", "Complete", "Rent", 510000, 15000, "Lease is in place", "FLL"],
  ]

  const properties = await Property.create(
    rows.map((row, index) => ({
      address: row[0],
      city: row[1],
      stage: row[2],
      strategy: row[3],
      purchasePrice: row[4],
      houseBoughtPrice: row[4] ? row[4] - 15000 : undefined,
      rehabBudget: row[5],
      nextAction: row[6],
      rentMarket: row[7],
      ownerEntity: index % 2 ? "Synergi Holdings LLC" : "HouseBought LLC",
      health: index === 7 ? "Needs attention" : "On track",
      actualRent: row[7] === "FLL" ? (index === 10 ? 4850 : 3900) : index === 9 ? 1650 : undefined,
      rentStatus: row[7] === "FLL" || index === 9 ? "Rented" : "",
      marketRent: row[7] === "FLL" ? 4600 : undefined,
      rentNotes: row[7] === "FLL" ? "Recorded lease" : "",
      arv: row[4] ? Math.round(row[4] * 1.45) : undefined,
      assignedUserIds: [],
      scopeLines: index === 7 ? [{ title: "Kitchen", budget: 28000, status: "In progress" }, { title: "Roof", budget: 14000, status: "Complete" }] : [],
      updatedBy: admin.name,
      createdAt: weeksAgo(12 - index),
      updatedAt: weeksAgo(Math.max(0, 6 - index)),
    })),
  )

  const college = properties[7]
  const lamoya = properties[6]
  await Loan.create([
    { propertyId: college._id, lender: "Not provided", balance: 279000, payment: 2140, maturity: "2026-07-01", termsStatus: "Needs verification", importSource: { file: "RE_Portfolio_Dashboard.xlsx", sheet: "Master Portfolio", row: 26 } },
    { propertyId: lamoya._id, lender: "Ternus Lending", balance: 150000, payment: 1680, maturity: "2026-09-01", termsStatus: "Needs verification" },
  ])
  const budget = await DrawBudget.create({
    propertyId: college._id,
    budget: 120000,
    fundingLimit: 120000,
    fundingPercent: 100,
    fundingBasis: "Assumed in source",
    approvalStatus: "Not confirmed",
    loanNumber: "348332",
    borrower: "Synergi Holdings LLC",
  })
  await Draw.create({
    propertyId: college._id,
    budgetId: budget._id,
    title: "Draw 2",
    status: "Funded",
    amount: 63300,
    fundedAmount: 63300,
    fundedDate: "2026-09-12",
    cashBasis: "Confirmed receipt",
  })
  await DrawBudget.create({
    propertyId: lamoya._id,
    budget: 45500,
    fundingLimit: 45500,
    fundingPercent: 100,
    fundingBasis: "Reported in source",
    loanNumber: "TBD",
    borrower: "Rain City Capital",
  })
  await Expense.create({
    propertyId: college._id,
    title: "Lumber package",
    amount: 4200,
    category: "Materials",
    vendor: "Builders First",
    date: "2026-09-18",
    entity: "Construction company",
    costTreatment: "Include in construction margin",
    postedBy: admin._id,
  })
  await Task.create({ propertyId: properties[4]._id, title: "Confirm sale comparable beds and baths", owner: admin.name, due: "2026-10-03", priority: "High" })
  await Bill.create({ propertyId: college._id, title: "Mortgage payment", amount: 2140, category: "Mortgage", due: "2026-10-01", entity: "Investment company", vendor: "Loan servicer" })
  await ReviewItem.create([
    { title: "Pending properties under contract import", detail: "Blank loan terms, sale comps, and action items were left blank. Purchase dates were not invented.", importSource: { file: "Pending Properties under Contract.xlsx", sheet: "Properties", row: 2 } },
    { propertyId: college._id, title: "Loan terms need verification", detail: "Current balance is from the portfolio sheet. Servicing terms are not confirmed.", importSource: { file: "RE_Portfolio_Dashboard.xlsx", sheet: "Master Portfolio", row: 26 } },
  ])
  await ConstructionProject.create({
    propertyId: college._id,
    title: "2319 College Street contract",
    status: "In progress",
    contractAmount: 98000,
    changeOrders: 4000,
    estimatedCost: 72000,
    allocatedOverhead: 6000,
    lenderBudget: 120000,
    revenueReceived: 0,
  })
  await Activity.create({ actorId: admin._id, actorName: "SC", title: "Sale comp confirmation", detail: "Confirmed comparable price as a closed sale.", propertyId: properties[2]._id, createdAt: new Date("2026-09-22T15:03:21") })
}

export { PASSWORD }
