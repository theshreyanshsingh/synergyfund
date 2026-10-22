import xlsx from "xlsx"
import { fromCents, toCents } from "@synergifund/shared"
import { Expense, ExpenseRequest, Property, User } from "../models/index.js"
import { propertyFilter } from "./access.js"
import { appOrigin } from "./appUrl.js"
import { teamToday } from "../lib/dates.js"

// Expense tracking: every cost on the books and every one waiting for approval, item by item, with totals per
// property, category and buyer. The same rows feed the page and the Excel, CSV and QuickBooks exports.

export const OPEN_STATUSES = ["Submitted", "Needs information", "Needs second approval"]
const ID = /^[a-f0-9]{24}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

export function readFilters(query = {}) {
  const day = (value) => (DAY.test(String(value || "")) ? String(value) : "")
  const property = String(query.propertyId || "")
  return {
    from: day(query.from),
    to: day(query.to),
    propertyId: ID.test(property) ? property : property === "none" ? "none" : "",
    category: String(query.category || "").slice(0, 60),
    buyerId: ID.test(String(query.buyerId || "")) ? String(query.buyerId) : "",
    status: ["approved", "pending"].includes(query.status) ? query.status : "all",
    q: String(query.q || "").replace(/\s+/g, " ").trim().slice(0, 80),
  }
}

function dayOf(value, createdAt) {
  const day = String(value || "").slice(0, 10)
  if (DAY.test(day)) return day
  return createdAt ? teamToday(new Date(createdAt)) : ""
}

function fileList(item) {
  const ids = (item.proofFileIds || []).map(String)
  if (item.proofFileId && !ids.includes(String(item.proofFileId))) ids.unshift(String(item.proofFileId))
  return ids
}

function add(map, key, seed, row) {
  const entry = map.get(key) || { ...seed, approvedCents: 0, pendingCents: 0, count: 0 }
  entry[row.state === "approved" ? "approvedCents" : "pendingCents"] += toCents(row.amount) || 0
  entry.count += 1
  map.set(key, entry)
}

function totalsOf(map) {
  return [...map.values()]
    .map(({ approvedCents, pendingCents, ...rest }) => ({ ...rest, approved: fromCents(approvedCents), pending: fromCents(pendingCents), total: fromCents(approvedCents + pendingCents) }))
    .sort((a, b) => b.total - a.total)
}

// Everything that matches, for someone who sees expenses (contractors have their own list on the Expenses page).
export async function trackingData(user, filters) {
  const properties = await Property.find(propertyFilter(user)).select("address").sort({ address: 1 }).lean()
  const names = new Map(properties.map((property) => [String(property._id), property.address]))
  if (filters.propertyId && filters.propertyId !== "none" && !names.has(filters.propertyId)) return { notFound: true }
  const scope = filters.propertyId === "none" ? { propertyId: null } : filters.propertyId ? { propertyId: filters.propertyId } : {}
  const [expenses, requests] = await Promise.all([
    filters.status === "pending" ? [] : Expense.find(scope).lean(),
    filters.status === "approved" ? [] : ExpenseRequest.find({ ...scope, status: { $in: OPEN_STATUSES } }).lean(),
  ])
  // Who bought it: the buyer saved with the cost, or (older costs) whoever asked for it, or whoever posted it.
  const askedIds = expenses.filter((item) => !item.submittedBy && item.requestId).map((item) => item.requestId)
  const asked = askedIds.length ? await ExpenseRequest.find({ _id: { $in: askedIds } }).select("requestedBy").lean() : []
  const askedBy = new Map(asked.map((item) => [String(item._id), item.requestedBy ? String(item.requestedBy) : ""]))
  const buyerOf = (item) => String(item.submittedBy || askedBy.get(String(item.requestId || "")) || item.postedBy || "")
  const peopleIds = [...new Set([...expenses.map(buyerOf), ...requests.map((item) => String(item.requestedBy || ""))].filter((id) => ID.test(id)))]
  const people = new Map((peopleIds.length ? await User.find({ _id: { $in: peopleIds } }).select("name").lean() : []).map((person) => [String(person._id), person.name]))
  const place = (id) => (id ? names.get(id) || "Removed property" : "Company-wide")

  const rows = []
  for (const item of expenses) {
    const propertyId = item.propertyId ? String(item.propertyId) : ""
    const buyerId = buyerOf(item)
    rows.push({
      id: String(item._id),
      state: "approved",
      status: "Approved",
      date: dayOf(item.date, item.createdAt),
      propertyId,
      property: place(propertyId),
      vendor: item.vendor || "",
      description: item.title || "",
      category: item.category || "Other",
      amount: Number(item.amount) || 0,
      buyerId,
      buyer: people.get(buyerId) || item.submittedByName || "",
      receiptId: item.receiptId ? String(item.receiptId) : "",
      fileIds: fileList(item),
      requestId: item.requestId ? String(item.requestId) : "",
      entity: item.entity || "",
      costTreatment: item.costTreatment || "",
      kind: item.lineKind || (item.receiptId ? "item" : "cost"),
      createdAt: item.createdAt,
    })
  }
  for (const item of requests) {
    const propertyId = item.propertyId ? String(item.propertyId) : ""
    const buyerId = item.requestedBy ? String(item.requestedBy) : ""
    const base = {
      state: "pending",
      status: item.status,
      date: dayOf(item.date, item.createdAt),
      propertyId,
      property: place(propertyId),
      vendor: item.vendor || "",
      buyerId,
      buyer: people.get(buyerId) || "",
      receiptId: item.receiptId ? String(item.receiptId) : "",
      fileIds: fileList(item),
      requestId: String(item._id),
      entity: item.entity || "",
      costTreatment: item.costTreatment || "",
      createdAt: item.createdAt,
    }
    if ((item.lines || []).length) {
      item.lines.forEach((line, index) => rows.push({ ...base, id: `${item._id}-${index}`, description: line.description || "", category: line.category || "Other", amount: Number(line.amount) || 0, kind: line.kind || "item" }))
    } else {
      rows.push({ ...base, id: String(item._id), description: item.title || "", category: item.category || "Other", amount: Number(item.amount) || 0, kind: "cost" })
    }
  }

  // The choices in the filters come from everything in range, so picking one category still lists the others.
  const inRange = rows.filter((row) => (!filters.from || (row.date && row.date >= filters.from)) && (!filters.to || (row.date && row.date <= filters.to)))
  const needle = filters.q.toLowerCase()
  const shown = inRange
    .filter((row) => !filters.category || row.category === filters.category)
    .filter((row) => !filters.buyerId || row.buyerId === filters.buyerId)
    .filter((row) => !needle || `${row.vendor} ${row.description} ${row.property} ${row.category} ${row.buyer}`.toLowerCase().includes(needle))
    .sort((a, b) => b.date.localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt))

  const byProperty = new Map()
  const byCategory = new Map()
  const byBuyer = new Map()
  let approvedCents = 0
  let pendingCents = 0
  for (const row of shown) {
    add(byProperty, row.propertyId || "none", { propertyId: row.propertyId, property: row.property }, row)
    add(byCategory, row.category, { category: row.category }, row)
    add(byBuyer, row.buyerId || "unknown", { buyerId: row.buyerId, buyer: row.buyer || "Not recorded" }, row)
    if (row.state === "approved") approvedCents += toCents(row.amount) || 0
    else pendingCents += toCents(row.amount) || 0
  }
  const buyers = new Map()
  for (const row of inRange) if (row.buyerId && !buyers.has(row.buyerId)) buyers.set(row.buyerId, row.buyer || "Former member")
  return {
    rows: shown,
    totals: {
      approved: fromCents(approvedCents),
      pending: fromCents(pendingCents),
      total: fromCents(approvedCents + pendingCents),
      count: shown.length,
      receipts: new Set(shown.map((row) => row.receiptId).filter(Boolean)).size,
    },
    byProperty: totalsOf(byProperty),
    byCategory: totalsOf(byCategory),
    byBuyer: totalsOf(byBuyer),
    options: {
      categories: [...new Set(inRange.map((row) => row.category))].sort(),
      buyers: [...buyers.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      properties: properties.map((property) => ({ id: String(property._id), address: property.address })),
    },
  }
}

// ---- Exports ----

// A text cell that starts like a formula opens as text in a spreadsheet, not as a formula.
function safeText(value) {
  const text = String(value ?? "")
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

function csvCell(value) {
  const text = typeof value === "number" ? value.toFixed(2) : safeText(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

function receiptLinks(row) {
  return row.fileIds.map((id) => `${appOrigin()}/api/documents/${id}/raw`).join(" ")
}

const HEADER = ["Date", "Property", "Vendor", "Item", "Category", "Amount", "Status", "Bought by", "Paying entity", "Construction margin", "Receipt", "Receipt ID"]

function line(row) {
  return [
    row.date,
    row.property,
    row.vendor,
    row.description,
    row.category,
    row.amount,
    row.status,
    row.buyer,
    row.entity,
    row.costTreatment === "Exclude from construction margin" ? "Excluded" : "Included",
    receiptLinks(row),
    row.receiptId,
  ]
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

export function exportName(data, filters, extension) {
  const place = filters.propertyId && filters.propertyId !== "none" ? slug(data.options.properties.find((item) => item.id === filters.propertyId)?.address) : ""
  const range = filters.from || filters.to ? `${filters.from || "start"}-to-${filters.to || teamToday()}` : teamToday()
  return `${["synergifund-expenses", place, range].filter(Boolean).join("-")}.${extension}`
}

export function expensesCsv(data) {
  return `﻿${csv([HEADER, ...data.rows.map(line)])}`
}

export function expensesWorkbook(data) {
  const book = xlsx.utils.book_new()
  const sheet = (rows, widths) => {
    const ws = xlsx.utils.aoa_to_sheet(rows)
    ws["!cols"] = widths.map((wch) => ({ wch }))
    return ws
  }
  const items = data.rows.map((row) => line(row).map((cell) => (typeof cell === "number" ? cell : String(cell ?? ""))))
  xlsx.utils.book_append_sheet(book, sheet([HEADER, ...items, [], ["", "", "", "Total", "", data.totals.total]], [11, 30, 22, 40, 20, 12, 22, 20, 22, 18, 60, 26]), "Expenses")
  const totals = (title, key, list) => sheet([[title, "Approved", "Waiting for approval", "Total", "Items"], ...list.map((entry) => [entry[key], entry.approved, entry.pending, entry.total, entry.count]), [], ["All", data.totals.approved, data.totals.pending, data.totals.total, data.totals.count]], [34, 14, 22, 14, 8])
  xlsx.utils.book_append_sheet(book, totals("Property", "property", data.byProperty), "By property")
  xlsx.utils.book_append_sheet(book, totals("Category", "category", data.byCategory), "By category")
  xlsx.utils.book_append_sheet(book, totals("Bought by", "buyer", data.byBuyer), "By buyer")
  return xlsx.write(book, { type: "buffer", bookType: "xlsx" })
}

function usDate(day) {
  const [year, month, date] = String(day || "").split("-")
  return year && month && date ? `${month}/${date}/${year}` : ""
}

// QuickBooks Online: Settings › Import data › Journal entries. One journal entry per receipt and property (or per
// cost): each item is a debit to an expense account, balanced by one credit to the account it was paid from. Only
// approved costs. Journal numbers are fixed per entry, so QuickBooks can warn about importing one twice.
export function quickbooksCsv(data, { account = "", paidFrom = "", useCategory = false } = {}) {
  const expenseAccount = String(account || "").trim().slice(0, 100) || "Job Supplies"
  const sourceAccount = String(paidFrom || "").trim().slice(0, 100) || "Contractor purchases"
  const groups = new Map()
  for (const row of data.rows) {
    if (row.state !== "approved") continue
    const key = row.receiptId ? `${row.receiptId}|${row.propertyId}` : row.requestId ? `${row.requestId}|${row.propertyId}` : row.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const out = [["Journal No", "Journal Date", "Account Name", "Debits", "Credits", "Description", "Name", "Class"]]
  const amount = (cents) => (cents / 100).toFixed(2)
  const entries = [...groups.values()].sort((a, b) => a[0].date.localeCompare(b[0].date))
  for (const rows of entries) {
    const first = rows[0]
    const number = `SF-${rows.map((row) => row.id).sort()[0].slice(-8).toUpperCase()}`
    const date = usDate(first.date)
    const place = first.propertyId ? first.property : ""
    let net = 0
    for (const row of rows) {
      const cents = toCents(row.amount) || 0
      if (!cents) continue
      net += cents
      out.push([number, date, useCategory ? row.category : expenseAccount, cents > 0 ? amount(cents) : "", cents < 0 ? amount(-cents) : "", `${row.description}${place ? ` · ${place}` : ""}`, row.vendor, place])
    }
    if (!net) continue
    out.push([number, date, sourceAccount, net < 0 ? amount(-net) : "", net > 0 ? amount(net) : "", `${first.vendor || "Purchase"}${rows.length > 1 ? ` (${rows.length} lines)` : ""}${place ? ` · ${place}` : ""}`, first.vendor, place])
  }
  return csv(out.map((row) => row.map((cell) => String(cell))))
}
