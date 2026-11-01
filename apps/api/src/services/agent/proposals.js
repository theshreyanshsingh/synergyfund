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
    changes: (proposal.changes || []).map((change) => ({ field: change.field, label: change.label, from: change.from ?? null, to: change.to })),
    status: expired ? "expired" : proposal.status,
  }
}

// Saved chats keep the card as it was when it was made, so a reopened chat shows where each change stands now.
export async function freshProposals(messages) {
  const calls = messages.flatMap((message) => message.toolCalls || []).filter((call) => call.tool === CHANGE_TOOL && call.result?.proposal?.id)
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
