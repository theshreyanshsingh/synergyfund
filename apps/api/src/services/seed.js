import bcrypt from "bcryptjs"
import {
  Activity,
  Bill,
  ConstructionProject,
  DocumentFile,
  Draw,
  DrawBudget,
  Expense,
  ExpenseRequest,
  Loan,
  PhotoSet,
  Property,
  ReviewItem,
  Task,
  User,
} from "../models/index.js"

const PASSWORD = "Synergi123!"

const SEEDED_ADDRESSES = [
  "1125 Market St",
  "1139 Evergreen Ave",
  "1521 W 2nd St",
  "3005 Ridgepine Dr",
  "1028 Lawfin St W",
  "10482 Pinehurst Drive",
  "5568 La Moya Ave APT 10",
  "2319 College Street",
  "3535 College Pl",
  "5823 Michigan Ave",
  "1888 SE 10th St",
  "2100 N Ocean Blvd",
]

export async function removeSeededPortfolio() {
  const properties = await Property.find({ address: { $in: SEEDED_ADDRESSES } }).select("_id")
  const ids = properties.map((property) => property._id)
  if (!ids.length) {
    await ConstructionProject.deleteMany({ title: "2319 College Street contract" })
    return
  }
  await Promise.all([
    Loan.deleteMany({ propertyId: { $in: ids } }),
    Draw.deleteMany({ propertyId: { $in: ids } }),
    DrawBudget.deleteMany({ propertyId: { $in: ids } }),
    Expense.deleteMany({ propertyId: { $in: ids } }),
    ExpenseRequest.deleteMany({ propertyId: { $in: ids } }),
    Task.deleteMany({ propertyId: { $in: ids } }),
    Bill.deleteMany({ propertyId: { $in: ids } }),
    ReviewItem.deleteMany({ $or: [{ propertyId: { $in: ids } }, { title: "Pending properties under contract import" }] }),
    PhotoSet.deleteMany({ propertyId: { $in: ids } }),
    DocumentFile.deleteMany({ propertyId: { $in: ids } }),
    Activity.deleteMany({ $or: [{ propertyId: { $in: ids } }, { title: "Sale comp confirmation" }] }),
    ConstructionProject.deleteMany({ $or: [{ propertyId: { $in: ids } }, { title: "2319 College Street contract" }] }),
    Property.deleteMany({ _id: { $in: ids } }),
  ])
}

export async function seedIfEmpty() {
  if (await User.countDocuments()) return
  await User.create({
    name: "Shreyansh Singh",
    email: "admin@synergifund.com",
    passwordHash: await bcrypt.hash(PASSWORD, 10),
    role: "admin",
    title: "Admin",
  })
}
