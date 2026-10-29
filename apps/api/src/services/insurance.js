import { EARLIER_POLICY, POLICY_BILLING, POLICY_TYPES, insurancePolicies } from "@synergifund/shared"
import { Loan } from "../models/index.js"

const EARLIER_FIELDS = ["insuranceCarrier", "insuranceAmount", "insuranceFrequency", "insuranceDue", "insurancePolicy", "insurancePaidOn"]
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// A property's insurance from before the policy list shows as its first policy. The first time any policy on that
// property is added, changed, removed or paid, it is saved into the list and the old fields are cleared, so it is
// never shown or moved twice.
export function keepEarlierPolicy(property) {
  if (property.insurancePolicies?.length) return false
  const [earlier] = insurancePolicies(property)
  if (!earlier) return false
  const { id, ...fields } = earlier
  property.insurancePolicies = [fields]
  for (const key of EARLIER_FIELDS) property[key] = undefined
  return true
}

// Insurance once kept on loans moves to the property at start-up only while the property has none (insuranceMove.js).
// Once a property's policies are changed here it may be left with none on purpose, so whatever is still on its loans
// (other loans than the one moved, which nothing shows) is cleared and can't come back as a policy.
export function clearLoanInsurance(propertyId) {
  return Loan.updateMany(
    { propertyId, $or: [{ insurancePayment: { $ne: null } }, { insuranceDue: { $nin: [null, ""] } }] },
    { $unset: { insurancePayment: 1, insuranceFrequency: 1, insuranceDue: 1 } },
  )
}

// The policy subdocument for an id from the page. The earlier insurance's id works only while it is still unsaved
// (a page opened before it was saved gets "not found" and reloads, rather than changing another policy).
export function findPolicy(property, policyId) {
  const saved = keepEarlierPolicy(property)
  if (policyId === EARLIER_POLICY) return saved ? property.insurancePolicies[0] : null
  return /^[a-f0-9]{24}$/i.test(String(policyId || "")) ? property.insurancePolicies.id(policyId) : null
}

function day(value) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  const match = DAY.exec(text)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCDate() === Number(match[3]) && date.getUTCMonth() === Number(match[2]) - 1 ? text : null
}

const clean = (value, max) => String(value ?? "").trim().replace(/[ \t]+/g, " ").slice(0, max)

// A policy as entered in the form: { policy } to save, or { error } for the first field that cannot be saved.
export function readPolicy(body = {}) {
  const type = POLICY_TYPES.find((item) => item.toLowerCase() === clean(body.type, 40).toLowerCase())
  if (!type) return { error: "Choose the policy type." }
  let premium
  const typed = String(body.premium ?? "").replace(/[$,\s]/g, "")
  if (typed) {
    premium = Number(typed)
    if (!Number.isFinite(premium) || premium < 0) return { error: "Enter the premium in dollars, like 1640." }
    premium = Math.round(premium * 100) / 100
  }
  const billing = body.billing ? POLICY_BILLING.find((item) => item.toLowerCase() === clean(body.billing, 20).toLowerCase()) : "Annual"
  if (!billing) return { error: `Choose how it is billed: ${POLICY_BILLING.join(", ")}.` }
  const effectiveDate = day(body.effectiveDate)
  if (effectiveDate === null) return { error: "Enter the effective date as a date." }
  const expirationDate = day(body.expirationDate)
  if (expirationDate === null) return { error: "Enter the expiration date as a date." }
  if (effectiveDate && expirationDate && expirationDate < effectiveDate) return { error: "The expiration date is before the effective date." }
  return {
    policy: {
      type,
      carrier: clean(body.carrier, 120),
      policyNumber: clean(body.policyNumber, 120),
      premium,
      billing,
      effectiveDate,
      expirationDate,
      notes: String(body.notes ?? "").trim().slice(0, 2000),
    },
  }
}

export const POLICY_FIELDS = [
  ["type", "Policy type"],
  ["carrier", "Carrier"],
  ["policyNumber", "Policy #"],
  ["premium", "Premium", true],
  ["billing", "Billing"],
  ["effectiveDate", "Effective"],
  ["expirationDate", "Expires"],
  ["notes", "Notes"],
]
