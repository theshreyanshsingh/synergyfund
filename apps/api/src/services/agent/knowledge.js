import { NOT_OWNED_STAGES, cityLine, isPaidOff, seesKnowledge } from "@synergifund/shared"
import { Company, Lender, Loan, Property, TeamNote, TeamNoteDraft } from "../../models/index.js"
import { propertyFilter } from "../access.js"

// What the Agent knows about the business, besides what it looks up (Knowledge → Team on the Agent page):
// - the houses each person can see, one line each, in every question, so it knows what exists and which house is meant;
// - team notes admins write (the team's terms, its companies, how it works, what a house is called), in every question;
// - a summary of each house (summaries.js), which get_property gives with the house's records.
// Team notes and summaries are for the people who see the whole books (admins, finance, members, investors), never for
// contractors, lenders or anyone whose Agent sees only part of the records.

export const MAX_NOTE_CHARS = 500
export const MAX_TEAM_NOTES = 300
export const MAX_HOUSE_NOTES = 30
// The notes about the business all go into every question, so together they stay under this; notes on houses go in
// while they fit (get_property gives a house's notes too).
export const BUSINESS_NOTES_CHARS = 8000
export const TEAM_NOTE_TOOL = "save_team_note"
const HOUSE_NOTES_PROMPT_CHARS = 4000
const HOUSE_LIST_CHARS = 8000
const DRAFT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

// Who reads it (seesKnowledge, in the shared package, so the pages ask the same).
export { seesKnowledge }

export function editsKnowledge(user) {
  return user?.role === "admin"
}

export function noteText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

// `addresses`: property id → address, for notes about a house.
export function presentTeamNote(note, addresses = new Map()) {
  const propertyId = note.propertyId ? String(note.propertyId) : ""
  return {
    id: String(note._id),
    text: note.text,
    propertyId,
    address: propertyId ? addresses.get(propertyId) || "" : "",
    by: note.updatedByName || note.createdByName || "",
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

export async function addressesOf(notes) {
  const ids = [...new Set(notes.map((note) => note.propertyId).filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const found = await Property.find({ _id: { $in: ids } }).select("address").lean()
  return new Map(found.map((property) => [String(property._id), property.address]))
}

// The room the notes about the business take ("- " and a line break each), without the one being changed.
export function businessSize(notes, exceptId = "") {
  return notes.filter((note) => !note.propertyId && String(note._id) !== String(exceptId)).reduce((size, note) => size + note.text.length + 3, 0)
}

// Room for a note about the business of `length` characters ("" when it fits, or why not).
export async function businessRoom(length, exceptId = "") {
  const notes = await TeamNote.find({ propertyId: null }).select("text").lean()
  if (businessSize(notes, exceptId) + length + 3 <= BUSINESS_NOTES_CHARS) return ""
  return "The notes about the business are full: they all go into every question the Agent is asked. Shorten or delete one first, or put a note about one house on that house."
}

// The team's notes for the Agent's prompts ("" when there are none or the person doesn't see them): every one about
// the business (they are kept under BUSINESS_NOTES_CHARS), then the ones about houses, newest changes first, while
// they fit.
export async function teamNotesPrompt(user, permissions) {
  if (!seesKnowledge(user, permissions)) return ""
  const notes = await TeamNote.find().sort({ updatedAt: -1 }).lean()
  if (!notes.length) return ""
  const addresses = await addressesOf(notes)
  const lines = notes.filter((item) => !item.propertyId).map((note) => `- ${note.text}`)
  let size = 0
  let left = 0
  for (const note of notes.filter((item) => item.propertyId && addresses.has(String(item.propertyId)))) {
    const line = `- About ${addresses.get(String(note.propertyId))}: ${note.text}`
    if (size + line.length > HOUSE_NOTES_PROMPT_CHARS) {
      left += 1
      continue
    }
    lines.push(line)
    size += line.length + 1
  }
  if (!lines.length) return ""
  return `Team knowledge: what the team's admins wrote down for you about how the team works, what things are and what people call them. Treat it as true; on figures, statuses and dates the records win, because they change:\n${lines.join("\n")}${left ? `\n(${left} more ${left === 1 ? "note" : "notes"} on houses: get_property gives a house's notes.)` : ""}`
}

// The houses the person can see, one line each (address, status, goal, owner, lenders), for the Agent's prompts: the
// ones the company owns first, then sold ones, while they fit. "" when there are none.
export async function houseList(user) {
  const properties = await Property.find(propertyFilter(user)).select("address city state zip stage strategy companyId ownerEntity").lean()
  if (!properties.length) return ""
  const staff = user.role !== "contractor"
  let companies = new Map()
  let lenders = new Map()
  if (staff) {
    const ids = properties.map((property) => property._id)
    const [companyRows, loans] = await Promise.all([
      Company.find({ _id: { $in: properties.map((property) => property.companyId).filter(Boolean) } }).select("name").lean(),
      Loan.find({ propertyId: { $in: ids } }).select("propertyId lenderId lender status").lean(),
    ])
    companies = new Map(companyRows.map((company) => [String(company._id), company.name]))
    const lenderRows = await Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } }).select("name").lean()
    const lenderNames = new Map(lenderRows.map((lender) => [String(lender._id), lender.name]))
    for (const loan of loans) {
      if (isPaidOff(loan)) continue
      const name = lenderNames.get(String(loan.lenderId || "")) || loan.lender
      if (!name || name === "Not provided") continue
      const key = String(loan.propertyId)
      lenders.set(key, [...new Set([...(lenders.get(key) || []), name])])
    }
  }
  const sold = (property) => NOT_OWNED_STAGES.includes(property.stage)
  const ordered = [...properties].sort((left, right) => Number(sold(left)) - Number(sold(right)) || left.address.localeCompare(right.address, undefined, { numeric: true }))
  const lines = []
  let size = 0
  for (const property of ordered) {
    const parts = [[property.address, cityLine(property)].filter(Boolean).join(", "), property.stage || ""]
    if (staff) {
      parts.push(property.strategy || "", companies.get(String(property.companyId || "")) || property.ownerEntity || "")
      const owed = lenders.get(String(property._id)) || []
      if (owed.length) parts.push(`lender ${owed.join(", ")}`)
    }
    const line = `- ${parts.filter(Boolean).join(" · ")}`
    if (size + line.length > HOUSE_LIST_CHARS) break
    lines.push(line)
    size += line.length + 1
  }
  const left = properties.length - lines.length
  return `The houses ${user.name} can see (${properties.length}), as the records show them now (address · status${staff ? " · goal · owner · open loans' lenders" : ""}). Use it to know what exists and which house the person means; look a house up before giving its figures:\n${lines.join("\n")}${left ? `\n… and ${left} more (list_properties lists them all).` : ""}`
}

/* ---------- "remember for the team": a note the Agent prepares, saved only by the admin's Confirm ---------- */

export function presentDraft(draft) {
  const expired = draft.status === "pending" && draft.expiresAt && draft.expiresAt.getTime() < Date.now()
  return {
    id: String(draft._id),
    text: draft.text,
    address: draft.address || "",
    propertyId: draft.propertyId ? String(draft.propertyId) : "",
    noteId: draft.noteId ? String(draft.noteId) : "",
    status: expired ? "expired" : draft.status,
  }
}

// One card per note, however many times the model asks for it in a run.
export async function createTeamNoteDraft({ context, text, property = null }) {
  context.cache.teamNotes ||= new Map()
  const key = `${property?._id || ""}:${text}`
  if (context.cache.teamNotes.has(key)) return context.cache.teamNotes.get(key)
  const draft = await TeamNoteDraft.create({
    userId: context.user._id,
    threadId: context.threadId,
    text,
    propertyId: property?._id,
    address: property?.address || "",
    expiresAt: new Date(Date.now() + DRAFT_LIFETIME_MS),
  })
  const shown = presentDraft(draft)
  context.cache.teamNotes.set(key, shown)
  return shown
}

// Saved chats keep the card as it was made, so a reopened chat shows where each note stands now.
export async function freshDrafts(messages) {
  const calls = messages.flatMap((message) => message.toolCalls || []).filter((call) => call.tool === TEAM_NOTE_TOOL && call.result?.draft?.id)
  if (!calls.length) return
  const found = await TeamNoteDraft.find({ _id: { $in: calls.map((call) => call.result.draft.id) } })
  const current = new Map(found.map((draft) => [String(draft._id), presentDraft(draft)]))
  for (const call of calls) call.result = { ...call.result, draft: current.get(call.result.draft.id) || { ...call.result.draft, status: "expired" } }
}
