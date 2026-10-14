import xlsx from "xlsx"
import { COMPANY_TYPES } from "@synergifund/shared"

// The columns of the companies workbook, in the order of SynergiFund's Companies template.
// Headers are matched loosely ("Zip Code", "ZIP", "Wire - Bank Name", "Bank" all work).
export const COMPANY_COLUMNS = [
  { key: "name", header: "Company Name", required: true, example: "1512 Van Buren LLC", aliases: ["company name", "company", "name", "legal name", "llc name", "llc"] },
  { key: "entityType", header: "Entity Type", required: true, example: "LLC", note: `One of: ${COMPANY_TYPES.join(", ")}`, aliases: ["entity type", "type", "company type"] },
  { key: "stateOfFormation", header: "State of Formation", required: true, example: "Florida", aliases: ["state of formation", "formation state", "state formed", "state of organization", "jurisdiction"] },
  { key: "formedOn", header: "Effective Date", required: true, example: "2024-03-01", hint: "YYYY-MM-DD", note: "A date: 2024-03-01 or 3/1/2024", aliases: ["effective date", "formed on", "formation date", "date formed", "date of formation", "date of organization"] },
  { key: "contactName", header: "Authorized Member", required: true, example: "Jordan Lee", aliases: ["authorized member", "authorised member", "member", "managing member", "manager", "contact", "contact person", "authorized person"] },
  { key: "address", header: "Address", required: true, example: "100 Main St", aliases: ["address", "street", "street address", "address line 1", "address 1"] },
  { key: "city", header: "City", required: true, example: "Jacksonville", aliases: ["city", "town"] },
  { key: "state", header: "State", required: true, example: "FL", aliases: ["state", "st"] },
  { key: "zip", header: "Zip", required: true, example: "32207", aliases: ["zip", "zip code", "zipcode", "postal code", "postcode"] },
  { key: "notes", header: "Notes", required: false, example: "", aliases: ["notes", "note", "comments"] },
  { key: "properties", header: "Owned Properties", required: false, example: "3318 Nolan St, 634 Luna Ct", hint: "Property 1, Property 2", note: "Street addresses of properties already in SynergiFund, separated by commas. They are linked to the company.", aliases: ["owned properties", "properties", "property", "property addresses", "owns"] },
  { key: "wireBankName", header: "Wire - Bank Name", required: false, example: "Chase Bank", aliases: ["wire bank name", "bank name", "bank"] },
  { key: "wireRoutingNumber", header: "Wire - Routing Number", required: false, example: "021000021", note: "9 digits", aliases: ["wire routing number", "routing number", "routing", "routing no", "aba", "aba number", "aba routing number"] },
  { key: "wireAccountNumber", header: "Wire - Account Number", required: false, example: "000012345678", aliases: ["wire account number", "account number", "account", "account no", "acct", "acct number", "bank account number"] },
  { key: "wireEntityName", header: "Wire - Entity Name", required: false, example: "1512 Van Buren LLC", note: "The name on the bank account", aliases: ["wire entity name", "entity name", "account name", "name on account", "beneficiary", "beneficiary name", "account holder"] },
  { key: "wireAddress", header: "Wire - Bank Address", required: false, example: "270 Park Ave, New York NY 10017", aliases: ["wire bank address", "bank address", "wire address", "beneficiary address", "account address"] },
  { key: "ein", header: "EIN Number", required: false, example: "12-3456789", aliases: ["ein number", "ein", "fein", "tax id", "tax id number", "tin"] },
]

const MAX_ROWS = 500

function normal(text) {
  return String(text ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim()
}

const BY_ALIAS = new Map(COMPANY_COLUMNS.flatMap((column) => column.aliases.map((alias) => [normal(alias), column.key])))

// The header row is the first row (of the first 15) that names a company column and at least one other.
function findHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 15); index += 1) {
    const keys = (rows[index] || []).map((cell) => BY_ALIAS.get(normal(cell)) || "")
    if (keys.includes("name") && keys.filter(Boolean).length >= 2) return { index, keys }
  }
  return null
}

const TYPE_WORDS = new Map([
  ["llc", "LLC"], ["l l c", "LLC"], ["limited liability company", "LLC"],
  ["corporation", "Corporation"], ["corp", "Corporation"], ["inc", "Corporation"], ["c corp", "Corporation"], ["c corporation", "Corporation"],
  ["s corp", "S corporation"], ["s corporation", "S corporation"], ["scorp", "S corporation"],
  ["partnership", "Partnership"], ["general partnership", "Partnership"],
  ["lp", "Limited partnership"], ["l p", "Limited partnership"], ["limited partnership", "Limited partnership"],
  ["trust", "Trust"], ["sole proprietorship", "Sole proprietorship"], ["sole prop", "Sole proprietorship"], ["other", "Other"],
])

function cleanType(value) {
  const text = String(value ?? "").trim()
  return TYPE_WORDS.get(normal(text)) || text
}

function pad(number) {
  return String(number).padStart(2, "0")
}

// Excel keeps dates as day numbers; people also type them as text.
function cleanDate(value) {
  if (value === "" || value == null) return { value: "" }
  if (typeof value === "number") {
    const parts = xlsx.SSF.parse_date_code(value)
    if (parts?.y) return { value: `${parts.y}-${pad(parts.m)}-${pad(parts.d)}` }
    return { error: true }
  }
  const text = String(value).trim()
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (match) return checkedDate(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text)
  if (match) {
    let year = Number(match[3])
    if (year < 100) year += year < 50 ? 2000 : 1900
    return checkedDate(year, Number(match[1]), Number(match[2]))
  }
  if (/[a-z]/i.test(text)) {
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return checkedDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
  }
  return { error: true }
}

function checkedDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { error: true }
  return { value: `${year}-${pad(month)}-${pad(day)}` }
}

function cellText(value) {
  if (value == null) return ""
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value)
  return String(value).trim()
}

// The template's second row shows how to fill it in ("YYYY-MM-DD", "Property 1, Property 2"); it is not a company.
const HINTS = new Set([...COMPANY_COLUMNS.map((column) => normal(column.hint)).filter(Boolean), normal("Company 1, Company 2")])

function hintRow(cells, keys) {
  const filled = cells.map((cell, column) => ({ key: keys[column], text: cellText(cell) })).filter((item) => item.text)
  return filled.length > 0 && !filled.some((item) => item.key === "name") && filled.every((item) => HINTS.has(normal(item.text)))
}

// Reads a companies workbook into rows of company fields, ready to be checked like a form.
export function readCompanyWorkbook(buffer) {
  const book = xlsx.read(buffer, { type: "buffer" })
  for (const sheetName of book.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: true, defval: "" })
    const header = findHeader(rows)
    if (!header) continue
    const result = []
    for (let index = header.index + 1; index < rows.length; index += 1) {
      const cells = rows[index] || []
      if (!cells.some((cell) => cellText(cell)) || hintRow(cells, header.keys)) continue
      if (result.length >= MAX_ROWS) return { sheet: sheetName, rows: result, truncated: true }
      const fields = {}
      const problems = []
      header.keys.forEach((key, column) => {
        if (!key || key in fields) return
        const raw = cells[column]
        if (key === "formedOn") {
          const date = cleanDate(raw)
          if (date.error) problems.push(`Effective date “${cellText(raw)}” is not a date.`)
          fields.formedOn = date.value || ""
          return
        }
        let text = cellText(raw)
        if (key === "entityType") text = cleanType(text)
        // Excel drops leading zeros from numbers: 02134 becomes 2134, 021000021 becomes 21000021.
        if (key === "zip" && /^\d{3,4}$/.test(text)) text = text.padStart(5, "0")
        if (key === "wireRoutingNumber" && /^\d{7,8}$/.test(text)) text = text.padStart(9, "0")
        fields[key] = text
      })
      result.push({ row: index + 1, fields, problems })
    }
    return { sheet: sheetName, rows: result, truncated: false }
  }
  return { error: "No header row was found. The first sheet needs a “Company Name” column. Download the template to see the format." }
}

// The template people fill in: one sheet with the columns, one explaining them.
export function companyTemplate() {
  const book = xlsx.utils.book_new()
  const sheet = xlsx.utils.aoa_to_sheet([COMPANY_COLUMNS.map((column) => column.header), COMPANY_COLUMNS.map((column) => column.hint || "")])
  sheet["!cols"] = COMPANY_COLUMNS.map((column) => ({ wch: Math.max(14, column.header.length + 4, String(column.example).length + 2) }))
  xlsx.utils.book_append_sheet(book, sheet, "Companies")
  const help = xlsx.utils.aoa_to_sheet([
    ["Column", "Required", "Example", "Notes"],
    ...COMPANY_COLUMNS.map((column) => [column.header, column.required ? "Required" : "Optional", column.example, column.note || ""]),
    [],
    ["One company per row, from row 3 (row 2 shows the formats and is skipped). A company that already exists (same name) only has its blank details filled in; nothing is overwritten. Owned Properties are linked only if they are not in another company yet."],
  ])
  help["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 30 }, { wch: 60 }]
  xlsx.utils.book_append_sheet(book, help, "How to fill")
  return xlsx.write(book, { type: "buffer", bookType: "xlsx" })
}
