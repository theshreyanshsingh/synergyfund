import { earlierTaxYear } from "@synergifund/shared"
import { Property } from "../models/index.js"

// Taxes used to be one yearly amount and a due date; they are kept one row per year now (Property Info). At start-up
// each property's amount becomes the property taxes for its due date's year (this year when no due date was entered),
// once: a property that has rows is left as it is. The old amount and due date stay until the property's taxes are
// next saved (keepEarlierTaxes), and are never shown again.
export async function moveTaxYears() {
  const properties = await Property.find({ taxAmount: { $ne: null }, "taxYears.0": { $exists: false } }).select("taxAmount taxDueDate").lean()
  let moved = 0
  for (const property of properties) {
    const amount = Number(property.taxAmount)
    if (!Number.isFinite(amount)) continue
    const row = { year: earlierTaxYear(property), propertyTaxes: Math.round(amount * 100) / 100 }
    const result = await Property.updateOne({ _id: property._id, "taxYears.0": { $exists: false } }, { $set: { taxYears: [row] } })
    moved += result.modifiedCount || 0
  }
  if (moved) console.log(`Moved the tax amount of ${moved} ${moved === 1 ? "property" : "properties"} into its tax years`)
  return moved
}
