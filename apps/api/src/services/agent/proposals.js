import { AgentProposal } from "../../models/index.js"
import { teamToday } from "../../lib/dates.js"
import { changeSummary, recordActivity } from "../notify.js"

// The figures the Agent can prepare a change to. It saves nothing itself: the person sees the old and new figures on a
// card in the chat, and only their Confirm saves it, with their own permissions and under their own name.
export const CHANGE_FIELDS = [
  ["rehabBudget", "Rehab budget", true],
  ["arv", "ARV", true],
  ["purchasePrice", "Purchase price", true],
  ["marketRent", "Market rent", true],
  ["actualRent", "Actual rent", true],
]

export const CHANGE_TOOL = "propose_property_change"
export const LOAN_CHANGE_TOOL = "propose_loan_change"

// A loan's figures the Agent can prepare an update to (as on the loan's form). `kind`: how it reads.
export const LOAN_CHANGE_FIELDS = [
  ["balance", "Balance", "money"],
  ["payment", "Monthly payment", "money"],
  ["originalAmount", "Original loan amount", "money"],
  ["interestRate", "Interest rate", "percent"],
]

const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const MAX_FIGURE = 1e10

const dollars = (value) => `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`

// The changes the Agent asked for: { changes, unchanged } (a figure already at that number needs no change), or
// { error } for the first one that can't be used.
export function readChanges(list, property) {
  if (!Array.isArray(list) || !list.length) return { error: "Say which figure to change and the new number." }
  const changes = []
  const unchanged = []
  const seen = new Set()
  for (const item of list) {
    const field = CHANGE_FIELDS.find(([key]) => key === item?.field)
    if (!field) return { error: `${item?.field || "That figure"} can't be changed here. Only these can: ${CHANGE_FIELDS.map(([, label]) => label).join(", ")}.` }
    const [key, label] = field
    if (seen.has(key)) return { error: `${label} was given twice. Ask which number is right.` }
    seen.add(key)
    const typed = String(item.value ?? "").replace(/[$,\s]/g, "")
    const number = Number(typed)
    if (!typed || !Number.isFinite(number) || number <= 0 || number >= MAX_FIGURE) return { error: `${label} must be a dollar amount above $0. To remove a figure, use Modify on the property.` }
    const to = Math.round(number * 100) / 100
    const from = property[key] ?? null
    if (from === to) unchanged.push(`${label} is already ${dollars(to)}`)
    else changes.push({ field: key, label, from, to })
  }
  return { changes, unchanged }
}

// Every number written in a text ("$116,250.00", "13.000%", "1,259.38"), for checking a figure is really there.
export function numbersIn(text) {
  return (String(text || "").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) || []).map(Number)
}

// The figures written in a document or message: its numbers, leaving out page markers ("[Page 13]") and the parts of
// dates ("10/28/2026", "2026-11-12", "Oct 28, 2026"), which are not amounts a loan could take.
const NOT_FIGURES = [
  /\[Page \d+\]/gi,
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi,
]
export function writtenNumbers(text) {
  return numbersIn(NOT_FIGURES.reduce((rest, pattern) => rest.replace(pattern, " "), String(text || "")))
}

// The loan figures the Agent asked for: { changes, unchanged } or { error }. `allowed`: the numbers in the person's
// message or in the document the figures come from. A figure that is not among them is refused, so the Agent can only
// ever offer a number someone wrote (never one it worked out, misread or was told to by a file).
export function readLoanChanges(list, loan, allowed, where) {
  if (!Array.isArray(list) || !list.length) return { error: "Say which figure to update and the new number." }
  const changes = []
  const unchanged = []
  const seen = new Set()
  for (const item of list) {
    const field = LOAN_CHANGE_FIELDS.find(([key]) => key === item?.field)
    if (!field) return { error: `${item?.field || "That figure"} can't be updated here. Only these can: ${LOAN_CHANGE_FIELDS.map(([, label]) => label).join(", ")}.` }
    const [key, label, kind] = field
    if (seen.has(key)) return { error: `${label} was given twice. Ask which number is right.` }
    seen.add(key)
    const number = Number(String(item.value ?? "").replace(/[$,%\s]/g, ""))
    const valid = kind === "percent" ? Number.isFinite(number) && number > 0 && number <= 100 : Number.isFinite(number) && number >= 0 && number < MAX_FIGURE
    if (!String(item.value ?? "").trim() || !valid) return { error: kind === "percent" ? `${label} must be a percent above 0, like 10.25.` : `${label} must be a dollar amount.` }
    const to = Math.round(number * 1000) / 1000
    if (!allowed.some((written) => Math.abs(written - to) < 0.005)) return { error: `${label} ${kind === "percent" ? `${to}%` : dollars(to)} is not written in ${where}. Only offer a figure that is written there, exactly as written.` }
    const from = loan[key] ?? null
    if (from === to) unchanged.push(`${label} is already ${kind === "percent" ? `${to}%` : dollars(to)}`)
    else changes.push({ field: key, label, from, to })
  }
  return { changes, unchanged }
}

export async function createLoanProposal({ context, loan, property, changes, source }) {
  context.cache.proposals ||= new Map()
  const key = `loan:${loan._id}:${JSON.stringify(changes)}`
  if (context.cache.proposals.has(key)) return context.cache.proposals.get(key)
  const proposal = await AgentProposal.create({
    userId: context.user._id,
    threadId: context.threadId,
    propertyId: property._id,
    address: property.address,
    kind: "loan",
    loanId: loan._id,
    lender: `${loan.lender || "Loan"}${loan.loanNumber ? ` #${loan.loanNumber}` : ""}`,
    ...(source ? { sourceId: source._id, sourceName: source.name } : {}),
    changes,
    expiresAt: new Date(Date.now() + LIFETIME_MS),
  })
  const shown = presentProposal(proposal)
  context.cache.proposals.set(key, shown)
  return shown
}

// One card per property and set of changes, however many times the model asks for it in a run.
export async function createProposal({ context, property, changes }) {
  context.cache.proposals ||= new Map()
  const key = `${property._id}:${JSON.stringify(changes)}`
  if (context.cache.proposals.has(key)) return context.cache.proposals.get(key)
  const proposal = await AgentProposal.create({
    userId: context.user._id,
    threadId: context.threadId,
    propertyId: property._id,
    address: property.address,
    changes,
    expiresAt: new Date(Date.now() + LIFETIME_MS),
  })
  const shown = presentProposal(proposal)
  context.cache.proposals.set(key, shown)
  return shown
}

export function presentProposal(proposal) {
  const expired = proposal.status === "pending" && proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()
  return {
    id: String(proposal._id),
    propertyId: String(proposal.propertyId),
    address: proposal.address,
    kind: proposal.kind || "property",
    ...(proposal.kind === "loan" ? { loanId: String(proposal.loanId), lender: proposal.lender || "", ...(proposal.sourceId ? { source: { id: String(proposal.sourceId), name: proposal.sourceName || "" } } : {}) } : {}),
    changes: (proposal.changes || []).map((change) => ({ field: change.field, label: change.label, from: change.from ?? null, to: change.to, ...(LOAN_CHANGE_FIELDS.find(([key]) => key === change.field)?.[2] === "percent" && proposal.kind === "loan" ? { percent: true } : {}) })),
    status: expired ? "expired" : proposal.status,
  }
}

// Saved chats keep the card as it was when it was made, so a reopened chat shows where each change stands now.
export async function freshProposals(messages) {
  const calls = messages.flatMap((message) => message.toolCalls || []).filter((call) => [CHANGE_TOOL, LOAN_CHANGE_TOOL].includes(call.tool) && call.result?.proposal?.id)
  if (!calls.length) return
  const found = await AgentProposal.find({ _id: { $in: calls.map((call) => call.result.proposal.id) } })
  const current = new Map(found.map((proposal) => [String(proposal._id), presentProposal(proposal)]))
  for (const call of calls) call.result = { ...call.result, proposal: current.get(call.result.proposal.id) || { ...call.result.proposal, status: "expired" } }
}

// What stops a confirmed change: a figure that moved after the card was made (the person agreed to an old → new that
// is no longer true). Returns the message to show, or "".
export function changedSince(proposal, property) {
  const moved = proposal.changes.find((change) => (property[change.field] ?? null) !== (change.from ?? null))
  if (!moved) return ""
  const now = property[moved.field] ?? null
  if (moved.field === "interestRate") return `Not saved: the interest rate is ${now == null ? "not entered" : `${now}%`} now, not the ${moved.from == null ? "blank" : `${moved.from}%`} this was based on. Ask the agent again.`
  return `Not saved: the ${moved.label.toLowerCase()} is ${now == null ? "not entered" : dollars(now)} now, not the ${moved.from == null ? "blank" : dollars(moved.from)} this was based on. Ask the agent again.`
}

// Saves a confirmed change, the same way as typing it on the property (an ARV typed in is no longer a comps analysis).
export async function applyProposal(proposal, property, user) {
  const before = property.toObject()
  for (const change of proposal.changes) property[change.field] = change.to
  if (proposal.changes.some((change) => change.field === "arv")) {
    property.arvMethod = "Confirmed through the Agent"
    property.arvDate = teamToday()
  }
  property.updatedBy = user.name
  await property.save()
  await recordActivity({ user, title: "Property updated", detail: `Through the Agent: ${changeSummary(before, property.toObject(), CHANGE_FIELDS)}`, propertyId: property._id })
}

// Saves a confirmed loan update, as saving the loan's form would, under the person's name and with where it came from.
export async function applyLoanProposal(proposal, loan, user) {
  const said = (change, value) => (value == null ? "blank" : change.field === "interestRate" ? `${value}%` : dollars(value))
  const before = proposal.changes.map((change) => `${change.label} ${said(change, loan[change.field] ?? null)} → ${said(change, change.to)}`)
  for (const change of proposal.changes) loan[change.field] = change.to
  await loan.save()
  await recordActivity({ user, title: "Loan updated", detail: [proposal.lender, `Through the Agent${proposal.sourceName ? `, from ${proposal.sourceName}` : ""}: ${before.join(", ")}`].filter(Boolean).join(" · "), propertyId: loan.propertyId })
}
