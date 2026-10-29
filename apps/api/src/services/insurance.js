import { EARLIER_POLICY, POLICY_BILLING, POLICY_STATUSES, POLICY_TYPES, insurancePolicies, monthlyAmount, monthlyFromPremium } from "@synergifund/shared"
import { Loan } from "../models/index.js"

const EARLIER_FIELDS = ["insuranceCarrier", "insuranceAmount", "insuranceFrequency", "insuranceDue", "insurancePolicy", "insurancePaidOn"]
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// A property's insurance from before the policy list shows as its first policy. The first time any policy on that
// property is added, changed, removed or paid, it is saved into the list and the old fields are cleared, so it is
// never shown or moved twice. Policies saved before Monthly Payment are saved with it then too (see settlePolicies).
export function keepEarlierPolicy(property) {
  settlePolicies(property)
  if (property.insurancePolicies?.length) return false
  const [earlier] = insurancePolicies(property)
  if (!earlier) return false
  const { id, ...fields } = earlier
  property.insurancePolicies = [fields]
  for (const key of EARLIER_FIELDS) property[key] = undefined
  return true
}

// Policies saved before Monthly Payment and the payment counts: the premium is saved as the monthly payment (a
// twelfth of an annual one) and the counts as 0, as they already show, so the change log only has what was changed.
function settlePolicies(property) {
  for (const policy of property.insurancePolicies || []) {
    if (policy.premium != null) {
      if (policy.monthlyPayment == null) policy.monthlyPayment = monthlyFromPremium(policy.premium, policy.billing || "Annual")
      policy.premium = undefined
    }
    if (policy.paymentsTotal == null) policy.paymentsTotal = 0
    if (policy.paymentsPaid == null) policy.paymentsPaid = 0
  }
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

function money(value) {
  const typed = String(value ?? "").replace(/[$,\s]/g, "")
  if (!typed) return { value: undefined }
  const number = Number(typed)
  return Number.isFinite(number) && number >= 0 ? { value: monthlyAmount(number) } : { error: true }
}

function payments(value) {
  const typed = String(value ?? "").replace(/[,\s]/g, "")
  if (!typed) return { value: 0 }
  const number = Number(typed)
  return Number.isInteger(number) && number >= 0 && number <= 1000 ? { value: number } : { error: true }
}

// A policy as entered in the form: { policy } to save, or { error } for the first field that cannot be saved. When
// changing a policy (current), a field left out keeps what it was. A page from before Monthly Payment sends the
// premium instead, which is read the same way as a saved one.
export function readPolicy(body = {}, current = null) {
  const given = (key) => Object.prototype.hasOwnProperty.call(body, key)
  const pick = (key) => (given(key) || !current ? body[key] : current[key])
  const type = POLICY_TYPES.find((item) => item.toLowerCase() === clean(pick("type"), 40).toLowerCase())
  if (!type) return { error: "Choose the category." }
  const billingText = clean(pick("billing"), 20)
  const billing = billingText ? POLICY_BILLING.find((item) => item.toLowerCase() === billingText.toLowerCase()) : "Annual"
  if (!billing) return { error: `Choose how it is billed: ${POLICY_BILLING.join(", ")}.` }
  let monthlyPayment
  if (given("monthlyPayment") || (!given("premium") && !current)) {
    const read = money(body.monthlyPayment)
    if (read.error) return { error: "Enter the monthly payment in dollars, like 136.67." }
    monthlyPayment = read.value
  } else if (given("premium")) {
    const read = money(body.premium)
    if (read.error) return { error: "Enter the monthly payment in dollars, like 136.67." }
    monthlyPayment = read.value == null ? undefined : monthlyFromPremium(read.value, billing)
  } else {
    monthlyPayment = current.monthlyPayment ?? undefined
  }
  const effectiveDate = day(pick("effectiveDate"))
  if (effectiveDate === null) return { error: "Enter the effective date as a date." }
  const expirationDate = day(pick("expirationDate"))
  if (expirationDate === null) return { error: "Enter the expiration date as a date." }
  if (effectiveDate && expirationDate && expirationDate < effectiveDate) return { error: "The expiration date is before the effective date." }
  const statusText = clean(given("status") || current ? pick("status") : "Active", 20)
  const status = statusText ? POLICY_STATUSES.find((item) => item.toLowerCase() === statusText.toLowerCase()) : ""
  if (status === undefined) return { error: `Choose the status: ${POLICY_STATUSES.join(", ").replace(/, ([^,]*)$/, " or $1")}.` }
  const total = payments(pick("paymentsTotal"))
  if (total.error) return { error: "Enter the No. of Payments as a whole number, like 12." }
  const paid = payments(pick("paymentsPaid"))
  if (paid.error) return { error: "Enter the No. of Payments Paid as a whole number, like 3." }
  return {
    policy: {
      type,
      borrowerEntity: clean(pick("borrowerEntity"), 160),
      payee: clean(pick("payee"), 160),
      carrier: clean(pick("carrier"), 120),
      policyNumber: clean(pick("policyNumber"), 120),
      accountCode: clean(pick("accountCode"), 120),
      monthlyPayment,
      billing,
      effectiveDate,
      expirationDate,
      notes: String(pick("notes") ?? "").trim().slice(0, 2000),
      status,
      paymentsTotal: total.value,
      paymentsPaid: paid.value,
    },
  }
}

export const POLICY_FIELDS = [
  ["borrowerEntity", "Borrower entity"],
  ["payee", "Payee"],
  ["carrier", "Carrier"],
  ["policyNumber", "Policy #"],
  ["accountCode", "Account code"],
  ["type", "Category"],
  ["monthlyPayment", "Monthly payment", true],
  ["notes", "Notes"],
  ["billing", "Billing"],
  ["effectiveDate", "Effective"],
  ["expirationDate", "Expires"],
  ["status", "Status"],
  ["paymentsTotal", "No. of payments"],
  ["paymentsPaid", "Payments paid"],
]
