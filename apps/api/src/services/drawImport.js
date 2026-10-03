import xlsx from "xlsx"

const FIELD_ALIASES = [
  ["fundedAmount", ["funded amount", "lender cash", "received amount"]],
  ["requestedDate", ["forecast finish", "requested date", "request date", "est date", "forecast"]],
  ["fundedDate", ["funded date", "received date", "date received"]],
  ["rehabBudget", ["rehab budget", "rehab"]],
  ["address", ["property address", "street", "project", "property", "address"]],
  ["title", ["draw name", "scope item", "description", "draw", "line", "item"]],
  ["amount", ["draw amount", "gross", "amount"]],
  ["status", ["draw status", "status"]],
  ["city", ["location", "city"]],
]

export function readWorkbook(filePath) {
  const book = xlsx.readFile(filePath, { cellDates: false })
  const tables = []
  for (const name of book.SheetNames) {
    const grid = xlsx.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" })
    const headerIndex = grid.findIndex((line) => (line || []).some((cell) => String(cell || "").trim()))
    if (headerIndex < 0) continue
    const headers = grid[headerIndex].map((cell, index) => String(cell || "").trim() || `Column ${index + 1}`)
    const rows = []
    for (let index = headerIndex + 1; index < grid.length; index += 1) {
      const line = grid[index] || []
      if (line.every((cell) => String(cell || "").trim() === "")) continue
      const cells = {}
      headers.forEach((header, column) => {
        cells[header] = line[column] == null ? "" : String(line[column]).trim()
      })
      rows.push({ sheet: name, row: index + 1, cells })
    }
    if (rows.length) tables.push({ sheet: name, headers, rows })
  }
  return tables
}

export function classifyDrawRows(tables, properties, draws) {
  const propertiesByAddress = new Map()
  for (const property of properties) propertiesByAddress.set(normalize(property.address), property)
  const existingKeys = new Set()
  for (const draw of draws) {
    const property = properties.find((item) => String(item._id || item.id) === String(draw.propertyId))
    if (!property) continue
    existingKeys.add(drawKey(property.address, draw.title))
    if (isAmountTitle(draw.title) && draw.amount != null) existingKeys.add(amountKey(property.address, draw.amount))
  }
  const seen = new Set()
  const headers = []
  const rows = []
  for (const table of tables) {
    for (const header of table.headers) if (!headers.includes(header)) headers.push(header)
    for (const source of table.rows) {
      rows.push({ ...source, ...decideRow(source, propertiesByAddress, existingKeys, seen) })
    }
  }
  return {
    headers,
    rows,
    counts: {
      pending: rows.filter((row) => row.status === "new").length,
      duplicate: rows.filter((row) => row.status === "duplicate").length,
      skipped: rows.filter((row) => row.status === "skipped").length,
      added: 0,
    },
  }
}

export async function appendNewDrawRows({ rows, properties, draws, Draw, Property, userName }) {
  const liveProperties = [...properties]
  const liveDraws = [...draws]
  let added = 0
  let duplicate = 0
  let skipped = 0
  const marks = []
  const propertyIds = new Set()
  for (const source of rows) {
    const decision = decideRow(source, indexProperties(liveProperties), indexDraws(liveProperties, liveDraws), new Set())
    if (decision.status === "skipped") {
      skipped += 1
      marks.push(mark(source, "skipped", decision.reason))
      continue
    }
    if (decision.status === "duplicate") {
      duplicate += 1
      marks.push(mark(source, "duplicate", decision.reason))
      continue
    }
    const mapped = mapRow(source.cells)
    const address = String(mapped.address || "").trim()
    let property = liveProperties.find((item) => normalize(item.address) === normalize(address))
    if (!property) {
      property = await Property.create({
        address,
        city: String(mapped.city || "").trim(),
        rehabBudget: mapped.rehabBudget,
        updatedBy: userName,
      })
      liveProperties.push(property)
      propertyIds.add(String(property._id))
    } else if (property.rehabBudget == null && mapped.rehabBudget != null) {
      property.rehabBudget = mapped.rehabBudget
      if (!String(property.city || "").trim() && mapped.city) property.city = String(mapped.city).trim()
      await property.save()
      propertyIds.add(String(property._id))
    }
    const title = drawTitle(mapped)
    if (!title) {
      added += 1
      marks.push(mark(source, "added", "The property was missing a rehab budget, so only that blank was filled."))
      continue
    }
    const already = liveDraws.find((draw) => {
      if (String(draw.propertyId) !== String(property._id || property.id)) return false
      if (normalize(draw.title) === normalize(title)) return true
      return !String(mapped.title || "").trim() && isAmountTitle(draw.title) && draw.amount === mapped.amount
    })
    if (already) {
      duplicate += 1
      marks.push(mark(source, "duplicate", `${address} already has this draw. The original was left unchanged.`))
      continue
    }
    const status = drawStatus(mapped.status)
    const draw = await Draw.create({
      propertyId: property._id,
      title,
      status,
      amount: mapped.amount,
      fundedAmount: status === "Funded" ? mapped.fundedAmount : mapped.fundedAmount,
      requestedDate: mapped.requestedDate || "",
      fundedDate: status === "Funded" ? mapped.fundedDate || "" : mapped.fundedDate || "",
      notes: mapped.title ? "" : "Imported without a draw name. Matched later by address and amount.",
    })
    liveDraws.push(draw)
    added += 1
    marks.push(mark(source, "added", "Appended. Existing records were not changed."))
  }
    return { marks, propertyIds: [...propertyIds], counts: { pending: 0, added, duplicate, skipped } }
}

function decideRow(source, propertiesByAddress, existingKeys, seen) {
  const mapped = mapRow(source.cells)
  const address = String(mapped.address || "").trim()
  if (!address) return { status: "skipped", reason: "No address, so this row was not added." }
  const title = drawTitle(mapped)
  const property = propertiesByAddress.get(normalize(address))
  const keys = []
  if (title) keys.push(drawKey(address, title))
  if (!String(mapped.title || "").trim() && mapped.amount != null) keys.push(amountKey(address, mapped.amount))
  if (!title && mapped.rehabBudget == null) {
    return { status: "skipped", reason: "This row has no draw name, amount, or rehab budget." }
  }
  if (!title && property && property.rehabBudget != null) {
    return { status: "duplicate", reason: `${address} is already on file. Its rehab budget was not replaced.` }
  }
  if (keys.some((key) => existingKeys.has(key) || seen.has(key))) {
    return { status: "duplicate", reason: `${address} already has this draw. The original was left unchanged.` }
  }
  keys.forEach((key) => seen.add(key))
  if (!property) return { status: "new", reason: "New property. Only the cells with values will be saved." }
  if (title) return { status: "new", reason: "New draw on a property that is already on file. Nothing already stored will be replaced." }
  return { status: "new", reason: "Rehab budget is blank on this property, so this figure will be added." }
}

function mapRow(cells) {
  const headers = Object.keys(cells)
  const used = new Set()
  const mapped = {}
  const aliases = FIELD_ALIASES.flatMap(([field, names]) => names.map((name) => ({ field, name })))
  aliases.sort((left, right) => right.name.length - left.name.length)
  for (const alias of aliases) {
    if (mapped[alias.field] !== undefined) continue
    const header = headers.find((item) => !used.has(item) && item.trim().toLowerCase() === alias.name)
    if (!header) continue
    used.add(header)
    mapped[alias.field] = cells[header]
  }
  return {
    address: mapped.address || "",
    city: mapped.city || "",
    title: mapped.title || "",
    amount: numberOrEmpty(mapped.amount),
    fundedAmount: numberOrEmpty(mapped.fundedAmount),
    status: mapped.status || "",
    requestedDate: asDate(mapped.requestedDate),
    fundedDate: asDate(mapped.fundedDate),
    rehabBudget: numberOrEmpty(mapped.rehabBudget),
  }
}

function isAmountTitle(title) {
  return /^amount \d/i.test(String(title || "").trim())
}

function drawTitle(mapped) {
  const title = String(mapped.title || "").trim()
  if (title) return title
  if (mapped.amount == null) return ""
  return `Amount ${mapped.amount}`
}

function drawStatus(value) {
  const text = String(value || "").trim()
  if (!text) return "Requested"
  if (/^(funded|received|paid)$/i.test(text)) return "Funded"
  return text
}

function drawKey(address, title) {
  return `${normalize(address)}||title||${normalize(title)}`
}

function amountKey(address, amount) {
  return `${normalize(address)}||amount||${amount}`
}

function indexProperties(properties) {
  const map = new Map()
  for (const property of properties) map.set(normalize(property.address), property)
  return map
}

function indexDraws(properties, draws) {
  const keys = new Set()
  for (const draw of draws) {
    const property = properties.find((item) => String(item._id || item.id) === String(draw.propertyId))
    if (!property) continue
    keys.add(drawKey(property.address, draw.title))
    if (isAmountTitle(draw.title) && draw.amount != null) keys.add(amountKey(property.address, draw.amount))
  }
  return keys
}

function mark(source, status, reason) {
  return { sheet: source.sheet, row: source.row, status, reason }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ")
}

function numberOrEmpty(value) {
  if (value === "" || value == null) return undefined
  const number = Number(String(value).replace(/[$,]/g, ""))
  return Number.isFinite(number) ? number : undefined
}

function asDate(value) {
  const text = String(value || "").trim()
  if (!text) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!parts) return text
  const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3]
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
}
