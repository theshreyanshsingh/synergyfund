import { Router } from "express"
import { COMPANY_FOLDERS, folderOf, loanSummary, missingCompanyDocuments } from "@synergifund/shared"
import { Company, DocumentFile, Loan, Property } from "../models/index.js"
import { asyncHandler, blockContractors, requirePermission, sendError } from "../lib/http.js"
import { orderProperties } from "../services/propertyOrder.js"
import { changeSummary, recordActivity } from "../services/notify.js"
import { COMPANY_COLUMNS, companyTemplate, readCompanyWorkbook } from "../services/companyImport.js"
import { receiveFile } from "../services/files.js"

// Companies (LLCs, corporations, trusts…) that own properties. Staff only: contractors never see them.
export const companiesRouter = Router()
companiesRouter.use(blockContractors)

// Chat attachments and comp photos are not library files.
const LIBRARY = { $nin: ["chat", "comp"] }

// [field, label, longest, required]. formedOn is the effective date; contactName is the authorized member.
const TEXT_FIELDS = [
  ["name", "Company Name", 120, true],
  ["entityType", "Entity Type", 60, true],
  ["stateOfFormation", "State of Formation", 60, true],
  ["formedOn", "Effective Date", 10, true],
  ["contactName", "Authorized Member", 120, true],
  ["address", "Address", 200, true],
  ["city", "City", 80, true],
  ["state", "State", 40, true],
  ["zip", "Zip", 10, true],
  ["notes", "Notes", 4000, false],
]

// Banking details: shown only on the company's own page and never written into the activity log.
const BANK_FIELDS = [
  ["ein", "EIN Number"],
  ["wireBankName", "Bank Name"],
  ["wireRoutingNumber", "Routing Number"],
  ["wireAccountNumber", "Account Number"],
  ["wireEntityName", "Entity Name"],
  ["wireAddress", "Bank Address"],
]

function isId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || ""))
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ")
}

// Reads the company fields from a request. With `partial`, fields that were not sent are left alone,
// but a required field that is sent cannot be blank.
export function companyFields(body = {}, partial = false) {
  const fields = {}
  for (const [key, , max] of TEXT_FIELDS) {
    if (!(key in body)) continue
    const raw = key === "notes" ? String(body[key] ?? "").trim() : cleanName(body[key])
    fields[key] = raw.slice(0, max)
  }
  for (const [key, label, , required] of TEXT_FIELDS) {
    if (!required || (partial && !(key in fields))) continue
    if (!fields[key]) return { error: key === "name" ? "Give the company a name." : `Enter the ${label}.` }
  }
  if (fields.formedOn && !/^\d{4}-\d{2}-\d{2}$/.test(fields.formedOn)) return { error: "The Effective Date needs to be in YYYY-MM-DD form." }
  if (fields.zip) {
    const digits = fields.zip.replace(/\D/g, "")
    if (!/^\d{5}(\d{4})?$/.test(digits)) return { error: "Enter a 5-digit Zip (or ZIP+4)." }
    fields.zip = digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
  }
  const banking = bankFields(body)
  if (banking.error) return banking
  return { fields: { ...fields, ...banking.fields } }
}

// EIN and wire instructions. Blank clears a field. Numbers are checked so a pasted typo is caught before anyone wires money.
function bankFields(body) {
  const fields = {}
  if ("ein" in body) {
    const digits = String(body.ein ?? "").replace(/\D/g, "")
    if (digits && digits.length !== 9) return { error: "The EIN Number has 9 digits, like 12-3456789." }
    fields.ein = digits ? `${digits.slice(0, 2)}-${digits.slice(2)}` : ""
  }
  if ("wireRoutingNumber" in body) {
    const raw = String(body.wireRoutingNumber ?? "").trim()
    const digits = raw.replace(/[\s-]/g, "")
    if (digits && !/^\d{9}$/.test(digits)) return { error: "The Routing Number has 9 digits." }
    fields.wireRoutingNumber = digits
  }
  if ("wireAccountNumber" in body) {
    const value = String(body.wireAccountNumber ?? "").replace(/[\s-]/g, "")
    if (value && !/^[0-9A-Za-z]{4,34}$/.test(value)) return { error: "The Account Number has 4 to 34 letters or digits, with no other characters." }
    fields.wireAccountNumber = value
  }
  if ("wireBankName" in body) fields.wireBankName = cleanName(body.wireBankName).slice(0, 120)
  if ("wireEntityName" in body) fields.wireEntityName = cleanName(body.wireEntityName).slice(0, 120)
  if ("wireAddress" in body) fields.wireAddress = String(body.wireAddress ?? "").trim().replace(/\n{3,}/g, "\n\n").slice(0, 300)
  return { fields }
}

async function nameTaken(name, exceptId = null) {
  const filter = { name: new RegExp(`^${escapeRegex(name)}$`, "i") }
  if (exceptId) filter._id = { $ne: exceptId }
  return Boolean(await Company.exists(filter))
}

export function presentCompany(company, { banking = false } = {}) {
  const shown = {
    id: String(company._id),
    name: company.name,
    entityType: company.entityType || "",
    stateOfFormation: company.stateOfFormation || "",
    formedOn: company.formedOn || "",
    address: company.address || "",
    city: company.city || "",
    state: company.state || "",
    zip: company.zip || "",
    contactName: company.contactName || "",
    notes: company.notes || "",
    updatedBy: company.updatedBy || "",
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  }
  if (banking) {
    shown.ein = company.ein || ""
    shown.wire = {
      bankName: company.wireBankName || "",
      routingNumber: company.wireRoutingNumber || "",
      accountNumber: company.wireAccountNumber || "",
      entityName: company.wireEntityName || "",
      address: company.wireAddress || "",
    }
  }
  return shown
}

async function loadCompany(req, res) {
  const company = isId(req.params.id) ? await Company.findById(req.params.id) : null
  if (!company) {
    sendError(res, 404, "That company is not available.")
    return null
  }
  return company
}

// Loan status and open balance for each property, from its loans.
async function loanTotals(properties) {
  const loans = properties.length ? await Loan.find({ propertyId: { $in: properties.map((property) => property._id) } }).select("propertyId status balance payment") : []
  const byProperty = new Map()
  for (const loan of loans) {
    const key = String(loan.propertyId)
    if (!byProperty.has(key)) byProperty.set(key, [])
    byProperty.get(key).push(loan)
  }
  return new Map(properties.map((property) => [String(property._id), loanSummary(byProperty.get(String(property._id)) || [])]))
}

function sum(list, pick) {
  const known = list.map(pick).filter((value) => value != null && Number.isFinite(Number(value)))
  return known.length ? known.reduce((total, value) => total + Number(value), 0) : null
}

// Moves properties into a company. Properties already in another company move over. Returns those that changed.
async function assignProperties(company, ids, user) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(isId)
  if (!wanted.length) return []
  const properties = await Property.find({ _id: { $in: wanted } }).select("_id address companyId")
  const moving = properties.filter((property) => String(property.companyId || "") !== String(company._id))
  if (!moving.length) return []
  const formerIds = [...new Set(moving.map((property) => property.companyId && String(property.companyId)).filter(Boolean))]
  const former = formerIds.length ? await Company.find({ _id: { $in: formerIds } }).select("name") : []
  const formerNames = new Map(former.map((item) => [String(item._id), item.name]))
  await Property.updateMany({ _id: { $in: moving.map((property) => property._id) } }, { $set: { companyId: company._id, updatedBy: user.name } })
  for (const property of moving) {
    const from = property.companyId ? formerNames.get(String(property.companyId)) : ""
    await recordActivity({ user, title: "Property assigned to a company", detail: `${property.address} → ${company.name}${from ? ` (was ${from})` : ""}`, propertyId: property._id, href: `/companies/${company._id}?tab=properties` })
  }
  return moving
}

companiesRouter.get(
  "/",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const companies = (await Company.find()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    const ids = companies.map((company) => company._id)
    const [properties, files, unlinked, unassigned] = await Promise.all([
      ids.length ? Property.find({ companyId: { $in: ids } }).select("_id companyId purchasePrice arv") : [],
      ids.length ? DocumentFile.aggregate([{ $match: { companyId: { $in: ids }, kind: LIBRARY } }, { $group: { _id: "$companyId", count: { $sum: 1 } } }]) : [],
      Property.find({ companyId: null, ownerEntity: { $nin: [null, ""] } }).select("_id address ownerEntity"),
      Property.countDocuments({ companyId: null }),
    ])
    const [loans, propertyFiles, ownFiles] = await Promise.all([
      loanTotals(properties),
      properties.length ? DocumentFile.aggregate([{ $match: { propertyId: { $in: properties.map((property) => property._id) }, kind: LIBRARY } }, { $group: { _id: "$propertyId", count: { $sum: 1 } } }]) : [],
      ids.length ? DocumentFile.find({ companyId: { $in: ids }, kind: LIBRARY }).select("companyId folder labels kind name mime") : [],
    ])
    // Which of the required company documents (articles, operating agreement, EIN letter, good standing) are missing.
    const filesByCompany = new Map()
    for (const file of ownFiles) {
      const key = String(file.companyId)
      if (!filesByCompany.has(key)) filesByCompany.set(key, [])
      filesByCompany.get(key).push(file)
    }
    // The company's own files plus its properties' files: everything in its Documents tab.
    const fileCounts = new Map(files.map((item) => [String(item._id), item.count]))
    const ownerOf = new Map(properties.map((property) => [String(property._id), String(property.companyId)]))
    for (const item of propertyFiles) {
      const owner = ownerOf.get(String(item._id))
      if (owner) fileCounts.set(owner, (fileCounts.get(owner) || 0) + item.count)
    }

    // Owner names typed on properties that are not in a company yet, so they can become companies in one step.
    const companyByName = new Map(companies.map((company) => [company.name.toLowerCase(), company]))
    const owners = new Map()
    for (const property of unlinked) {
      const name = cleanName(property.ownerEntity)
      if (!name) continue
      const key = name.toLowerCase()
      if (!owners.has(key)) owners.set(key, { name, companyId: companyByName.has(key) ? String(companyByName.get(key)._id) : "", propertyIds: [], addresses: [] })
      owners.get(key).propertyIds.push(String(property._id))
      owners.get(key).addresses.push(property.address)
    }

    res.json({
      items: companies.map((company) => {
        const own = properties.filter((property) => String(property.companyId) === String(company._id))
        const summaries = own.map((property) => loans.get(String(property._id)))
        return {
          ...presentCompany(company),
          properties: own.length,
          purchaseTotal: sum(own, (property) => property.purchasePrice),
          arvTotal: sum(own, (property) => property.arv),
          loanBalance: sum(summaries, (summary) => summary.balance),
          monthlyPayment: sum(summaries, (summary) => summary.payment),
          documents: fileCounts.get(String(company._id)) || 0,
          missingDocuments: missingCompanyDocuments(filesByCompany.get(String(company._id)) || []).map((folder) => folder.name),
        }
      }),
      unassigned,
      owners: [...owners.values()].sort((a, b) => b.propertyIds.length - a.propertyIds.length || a.name.localeCompare(b.name)).slice(0, 20),
    })
  }),
)

companiesRouter.post(
  "/",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const { fields, error } = companyFields(req.body)
    if (error) return sendError(res, 400, error)
    if (await nameTaken(fields.name)) return sendError(res, 409, `A company named ${fields.name} already exists.`)
    const company = await Company.create({ ...fields, createdBy: req.user._id, updatedBy: req.user.name })
    await recordActivity({ user: req.user, title: "Company added", detail: [company.name, company.entityType, company.stateOfFormation].filter(Boolean).join(" · "), href: `/companies/${company._id}` })
    const assigned = await assignProperties(company, req.body.propertyIds, req.user)
    res.status(201).json({ company: presentCompany(company), assigned: assigned.length })
  }),
)

const IMPORT_KEYS = new Set(COMPANY_COLUMNS.map((column) => column.key))

// Street words written either way: "3318 Nolan Street" and "3318 Nolan St" are the same property.
const STREET_WORDS = { street: "st", road: "rd", avenue: "ave", av: "ave", court: "ct", drive: "dr", lane: "ln", boulevard: "blvd", place: "pl", terrace: "ter", circle: "cir", parkway: "pkwy", highway: "hwy", trail: "trl", north: "n", south: "s", east: "e", west: "w" }

function addressKey(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map((word) => STREET_WORDS[word] || word).join(" ")
}

// The properties named in an "Owned Properties" cell: street addresses separated by commas. A piece may carry the
// city after the street ("3318 Nolan St Jacksonville"); city or state pieces between commas are passed over.
function matchProperties(text, properties) {
  const pieces = String(text ?? "").split(/[,;\n]+/).map((piece) => piece.trim()).filter(Boolean)
  const found = []
  const missing = []
  for (const piece of pieces) {
    const key = addressKey(piece)
    if (!key) continue
    let matches = properties.filter((property) => property.key === key)
    if (!matches.length) matches = properties.filter((property) => key.startsWith(`${property.key} `) || property.key.startsWith(`${key} `))
    if (matches.length === 1) {
      if (!found.includes(matches[0])) found.push(matches[0])
    } else if (/^\d/.test(piece)) {
      missing.push(matches.length > 1 ? `${piece} (more than one property matches)` : piece)
    }
  }
  return { found, missing }
}
const IMPORT_FIELDS = [...TEXT_FIELDS, ...BANK_FIELDS].filter(([key]) => key !== "name")

// Checks imported rows against the companies already saved: a new company, blank details to fill in on an existing one
// (nothing is ever overwritten), nothing to do, or a problem to fix in the workbook.
async function planImport(rows) {
  const [existing, allProperties] = await Promise.all([Company.find(), Property.find().select("_id address companyId")])
  const byName = new Map(existing.map((company) => [company.name.toLowerCase(), company]))
  const companyNames = new Map(existing.map((company) => [String(company._id), company.name]))
  const properties = allProperties.map((property) => ({ id: String(property._id), address: property.address, companyId: property.companyId ? String(property.companyId) : "", key: addressKey(property.address) }))
  const claimed = new Map()
  const seen = new Map()
  // Owned Properties: link the ones that are in no company yet (or already in this one); never move one from another company.
  function links(fields, row, companyId = "") {
    const { found, missing } = matchProperties(fields.properties, properties)
    const ids = []
    const notes = []
    for (const property of found) {
      if (companyId && property.companyId === companyId) continue
      if (property.companyId) {
        notes.push(`${property.address} is already in ${companyNames.get(property.companyId) || "another company"}, so it is not moved.`)
      } else if (claimed.has(property.id) && claimed.get(property.id) !== row) {
        notes.push(`${property.address} is also listed on row ${claimed.get(property.id)} and goes to that company.`)
      } else {
        claimed.set(property.id, row)
        ids.push(property.id)
      }
    }
    if (missing.length) notes.push(`Not found in Properties: ${missing.join(", ")}.`)
    return { ids, names: ids.map((id) => properties.find((property) => property.id === id).address), notes }
  }
  return rows.map(({ row, fields, problems = [] }) => {
    const name = cleanName(fields.name)
    const base = { row, name, fields }
    if (problems.length) return { ...base, status: "error", message: problems.join(" ") }
    if (!name) return { ...base, status: "error", message: "The company name is missing." }
    const key = name.toLowerCase()
    if (seen.has(key)) return { ...base, status: "error", message: `Same company as row ${seen.get(key)}.` }
    seen.set(key, row)
    const found = byName.get(key)
    if (!found) {
      const checked = companyFields(fields)
      if (checked.error) return { ...base, status: "error", message: checked.error }
      const linked = links(fields, row)
      return { ...base, status: "new", message: "New company", links: linked.names, notes: linked.notes, clean: checked.fields, propertyIds: linked.ids }
    }
    const blanks = {}
    const filled = []
    for (const [field, label] of IMPORT_FIELDS) {
      if (!String(fields[field] ?? "").trim() || found[field]) continue
      blanks[field] = fields[field]
      filled.push(label)
    }
    const linked = links(fields, row, String(found._id))
    if (!filled.length && !linked.ids.length) return { ...base, status: "same", message: "Already saved. Nothing new to add.", notes: linked.notes }
    const checked = companyFields(blanks, true)
    if (checked.error) return { ...base, status: "error", message: checked.error }
    const adds = [filled.length ? `adds ${filled.join(", ")}` : "", linked.names.length ? `links ${linked.names.join(", ")}` : ""].filter(Boolean).join(" and ")
    return { ...base, status: "update", message: `Already saved; ${adds}.`, links: linked.names, notes: linked.notes, clean: checked.fields, id: found._id, propertyIds: linked.ids }
  })
}

// Only the known columns, as text, from rows the app sends back after the preview.
function importRows(list) {
  return (Array.isArray(list) ? list : []).slice(0, 500).map((item) => {
    const fields = {}
    for (const [key, value] of Object.entries(item?.fields || {})) {
      if (IMPORT_KEYS.has(key) && (typeof value === "string" || typeof value === "number")) fields[key] = String(value).slice(0, 4000)
    }
    return { row: Number(item?.row) || 0, fields }
  })
}

// The workbook to fill in for an import.
companiesRouter.get(
  "/import-template",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition", 'attachment; filename="SynergiFund companies template.xlsx"')
    res.send(companyTemplate())
  }),
)

// Reads a workbook and says what importing it would do, row by row. Nothing is saved yet.
companiesRouter.post(
  "/import/preview",
  requirePermission("properties.write"),
  receiveFile("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return sendError(res, 400, "Choose an Excel workbook.")
    if (!/\.(xlsx|xls|xlsm|csv)$/i.test(req.file.originalname || "")) return sendError(res, 400, "Import an Excel workbook (.xlsx, .xls) or a .csv file.")
    let read
    try {
      read = readCompanyWorkbook(req.file.buffer)
    } catch {
      return sendError(res, 400, "That workbook could not be read. Save it as .xlsx and try again.")
    }
    if (read.error) return sendError(res, 400, read.error)
    if (!read.rows.length) return sendError(res, 400, "The workbook has a header row but no companies under it.")
    const plan = await planImport(read.rows)
    res.json({
      sheet: read.sheet,
      truncated: read.truncated,
      rows: plan.map(({ row, name, status, message, notes = [], links = [], fields }) => ({ row, name, status, message, notes, links, fields })),
    })
  }),
)

// Saves the rows from the preview: adds new companies and fills in blank details on existing ones.
companiesRouter.post(
  "/import",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const rows = importRows(req.body.rows)
    if (!rows.length) return sendError(res, 400, "There is nothing to import.")
    const plan = await planImport(rows)
    let created = 0
    let updated = 0
    let linked = 0
    const errors = []
    for (const item of plan) {
      try {
        if (item.status === "new") {
          const company = await Company.create({ ...item.clean, createdBy: req.user._id, updatedBy: req.user.name })
          created += 1
          linked += (await assignProperties(company, item.propertyIds, req.user)).length
        } else if (item.status === "update") {
          await Company.updateOne({ _id: item.id }, { $set: { ...item.clean, updatedBy: req.user.name } })
          updated += 1
          if (item.propertyIds?.length) linked += (await assignProperties(await Company.findById(item.id), item.propertyIds, req.user)).length
        } else if (item.status === "error") {
          errors.push({ row: item.row, name: item.name, message: item.message })
        }
      } catch (error) {
        errors.push({ row: item.row, name: item.name, message: error.message })
      }
    }
    const skipped = plan.filter((item) => item.status === "same").length
    if (created || updated) {
      await recordActivity({ user: req.user, title: "Companies imported", detail: [created ? `${created} added` : "", updated ? `${updated} filled in` : "", linked ? `${linked} ${linked === 1 ? "property" : "properties"} linked` : "", skipped ? `${skipped} unchanged` : "", errors.length ? `${errors.length} not imported` : ""].filter(Boolean).join(" · ") })
    }
    res.json({ created, updated, linked, skipped, errors })
  }),
)

companiesRouter.get(
  "/:id",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const company = await loadCompany(req, res)
    if (!company) return
    const properties = orderProperties(await Property.find({ companyId: company._id }).select("_id address city stage strategy labels purchasePrice arv rehabBudget position createdAt"))
    const [loans, ownFiles, propertyFiles] = await Promise.all([
      loanTotals(properties),
      DocumentFile.find({ companyId: company._id, kind: LIBRARY }).select("companyId folder labels kind name mime"),
      properties.length ? DocumentFile.aggregate([{ $match: { propertyId: { $in: properties.map((property) => property._id) }, kind: LIBRARY } }, { $group: { _id: "$propertyId", count: { $sum: 1 } } }]) : [],
    ])
    const fileCounts = new Map(propertyFiles.map((item) => [String(item._id), item.count]))
    const items = properties.map((property) => {
      const summary = loans.get(String(property._id))
      return {
        id: String(property._id),
        address: property.address,
        city: property.city || "",
        stage: property.stage || "",
        strategy: property.strategy || "",
        labels: property.labels || [],
        purchasePrice: property.purchasePrice ?? null,
        arv: property.arv ?? null,
        rehabBudget: property.rehabBudget ?? null,
        loanStatus: summary.status,
        loanBalance: summary.balance,
        monthlyPayment: summary.payment,
        documents: fileCounts.get(String(property._id)) || 0,
      }
    })
    res.json({
      company: presentCompany(company, { banking: true }),
      properties: items,
      totals: {
        properties: items.length,
        purchase: sum(items, (item) => item.purchasePrice),
        arv: sum(items, (item) => item.arv),
        loanBalance: sum(items, (item) => item.loanBalance),
        monthlyPayment: sum(items, (item) => item.monthlyPayment),
        documents: ownFiles.length,
        propertyDocuments: items.reduce((total, item) => total + item.documents, 0),
      },
      // Each required company document: on file (with how many files) or missing.
      required: COMPANY_FOLDERS.filter((folder) => folder.required).map((folder) => {
        const count = ownFiles.filter((file) => folderOf(file) === folder.id).length
        return { id: folder.id, name: folder.name, files: count, missing: count === 0 }
      }),
    })
  }),
)

companiesRouter.patch(
  "/:id",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const company = await loadCompany(req, res)
    if (!company) return
    const { fields, error } = companyFields(req.body, true)
    if (error) return sendError(res, 400, error)
    if (fields.name && fields.name.toLowerCase() !== company.name.toLowerCase() && await nameTaken(fields.name, company._id)) {
      return sendError(res, 409, `A company named ${fields.name} already exists.`)
    }
    const before = company.toObject()
    company.set({ ...fields, updatedBy: req.user.name })
    await company.save()
    const after = company.toObject()
    // Banking changes are noted by name only; the numbers never go into the activity log.
    const bankChanged = BANK_FIELDS.filter(([key]) => (before[key] || "") !== (after[key] || "")).map(([, label]) => label)
    const changes = [
      changeSummary(before, after, TEXT_FIELDS.map(([key, label]) => [key, label])),
      bankChanged.length ? `${bankChanged.join(", ")} updated` : "",
    ].filter(Boolean).join(" · ")
    await recordActivity({ user: req.user, title: "Company updated", detail: `${company.name}${changes ? `: ${changes}` : " · saved with no changes"}`, href: `/companies/${company._id}` })
    res.json({ company: presentCompany(company, { banking: true }) })
  }),
)

companiesRouter.delete(
  "/:id",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const company = await loadCompany(req, res)
    if (!company) return
    // Its properties and files stay; they are just no longer linked to a company.
    const [properties, files] = await Promise.all([
      Property.updateMany({ companyId: company._id }, { $unset: { companyId: 1 } }),
      DocumentFile.updateMany({ companyId: company._id }, { $unset: { companyId: 1 } }),
    ])
    await company.deleteOne()
    const kept = [
      properties.modifiedCount ? `${properties.modifiedCount} ${properties.modifiedCount === 1 ? "property" : "properties"} unassigned` : "",
      files.modifiedCount ? `${files.modifiedCount} ${files.modifiedCount === 1 ? "file" : "files"} kept in Documents` : "",
    ].filter(Boolean).join(" · ")
    await recordActivity({ user: req.user, title: "Company deleted", detail: [company.name, kept].filter(Boolean).join(" · ") })
    res.json({ ok: true })
  }),
)

companiesRouter.post(
  "/:id/properties",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const company = await loadCompany(req, res)
    if (!company) return
    const ids = Array.isArray(req.body.propertyIds) ? req.body.propertyIds : []
    if (!ids.some(isId)) return sendError(res, 400, "Choose at least one property.")
    const assigned = await assignProperties(company, ids, req.user)
    res.json({ assigned: assigned.length })
  }),
)

companiesRouter.delete(
  "/:id/properties/:propertyId",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const company = await loadCompany(req, res)
    if (!company) return
    const property = isId(req.params.propertyId) ? await Property.findOne({ _id: req.params.propertyId, companyId: company._id }).select("_id address") : null
    if (!property) return sendError(res, 404, "That property is not in this company.")
    await Property.updateOne({ _id: property._id }, { $unset: { companyId: 1 }, $set: { updatedBy: req.user.name } })
    await recordActivity({ user: req.user, title: "Property removed from a company", detail: `${property.address} is no longer in ${company.name}`, propertyId: property._id, href: `/companies/${company._id}?tab=properties` })
    res.json({ ok: true })
  }),
)
