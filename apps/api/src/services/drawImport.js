import xlsx from "xlsx"

export const DRAW_FIELD_ALIASES = [
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

export function parsePortfolioWorkbook(filePath) {
  const book = xlsx.readFile(filePath, { cellDates: false })
  const sheet = book.Sheets.Dashboard
  if (!sheet) return null
  const grid = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
  const headerIndex = grid.findIndex((row) => {
    const cells = (row || []).map((cell) => String(cell || "").trim().toLowerCase())
    return cells[0] === "property" && cells.includes("total budget") && cells.some((cell) => /^draw\s+\d+$/.test(cell))
  })
  if (headerIndex < 0) return null
  const header = trimTrailing(grid[headerIndex].map((cell) => String(cell || "").trim()))
  const column = (label) => header.findIndex((name) => name.toLowerCase() === label.toLowerCase())
  const drawColumns = []
  header.forEach((name, index) => {
    const match = name.match(/^draw\s+(\d+)$/i)
    if (match) drawColumns.push({ index, title: `Draw ${match[1]}` })
  })
  const displayHeader = header.slice(0, Math.max(...drawColumns.map((item) => item.index)) + 1)
  const table = []
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const line = trimTrailing((grid[index] || []).map((cell) => String(cell || "").trim()))
    const address = line[0] || ""
    if (!address) continue
    if (/^portfolio total$/i.test(address) || /^how to use$/i.test(address)) break
    table.push(line)
  }
  const sheets = parsePropertySheets(book)
  const records = table.map((line) => {
    const label = line[0]
    const detail = matchSheet(sheets, label)
    const drawnGross = numberOrEmpty(line[column("Drawn to Date (gross)")])
    const cashReceived = numberOrEmpty(line[column("CASH RECEIVED (funded share)")])
    const fundedRatio = drawnGross > 0 && cashReceived != null ? cashReceived / drawnGross : 1
    const draws = drawColumns.flatMap((item) => {
      const amount = numberOrEmpty(line[item.index])
      if (amount == null || amount <= 0) return []
      const lines = (detail?.lines || []).flatMap((scope) => {
        const share = scope.draws[item.title]
        if (share == null || share <= 0) return []
        return [{ title: scope.title, description: scope.description, amount: share }]
      })
      return [{ title: item.title, amount, fundedAmount: Math.round(amount * fundedRatio * 100) / 100, lines }]
    })
    return {
      address: detail?.address || label,
      city: detail?.city || "",
      rehabBudget: numberOrEmpty(line[column("Total Budget")]),
      lenderFunding: numberOrEmpty(line[column("Lender Funding")]),
      status: line[column("Status")] || "",
      draws,
    }
  })
  return {
    columns: displayHeader,
    grid: table.map((line) => displayHeader.map((_, index) => line[index] || "")),
    records,
    counts: {
      pending: records.reduce((sum, record) => sum + record.draws.length, 0),
      duplicate: 0,
      skipped: 0,
      added: 0,
    },
  }
}

export async function importPortfolioRecords({ records, properties, draws, Draw, DrawBudget, Property, userName }) {
  const liveProperties = [...properties]
  const liveDraws = [...draws]
  let added = 0
  let duplicate = 0
  const propertyIds = new Set()
  const marks = []
  for (const record of records) {
    let property = liveProperties.find((item) => sameAddress(item.address, record.address))
    if (!property) {
      property = await Property.create({
        address: record.address,
        city: record.city,
        stage: /not started/i.test(record.status) ? "Under contract" : "Renovation",
        rehabBudget: record.rehabBudget,
        nextAction: record.status || "",
        updatedBy: userName,
      })
      liveProperties.push(property)
      propertyIds.add(String(property._id))
    }
    if (record.rehabBudget != null) property.rehabBudget = record.rehabBudget
    if (record.city && !property.city) property.city = record.city
    if (record.status) property.nextAction = record.status
    await property.save()
    if (record.lenderFunding != null) {
      const budget = await DrawBudget.findOne({ propertyId: property._id })
      if (!budget) {
        await DrawBudget.create({
          propertyId: property._id,
          title: "Lender funding",
          budget: record.rehabBudget,
          fundingLimit: record.lenderFunding,
          fundingBasis: "Imported workbook",
        })
      } else {
        budget.budget = record.rehabBudget ?? budget.budget
        budget.fundingLimit = record.lenderFunding
        await budget.save()
      }
    }
    for (const item of record.draws) {
      const exists = liveDraws.find((draw) => String(draw.propertyId) === String(property._id || property.id) && normalize(draw.title) === normalize(item.title))
      if (exists) {
        exists.amount = item.amount
        exists.fundedAmount = item.fundedAmount
        exists.lines = item.lines
        exists.status = "Funded"
        exists.notes = record.status ? `Workbook status: ${record.status}` : exists.notes
        exists.markModified("lines")
        await exists.save()
        duplicate += 1
        marks.push({ sheet: "Dashboard", row: record.address, status: "duplicate", reason: `${item.title} updated from the workbook.` })
        continue
      }
      const draw = await Draw.create({
        propertyId: property._id,
        title: item.title,
        status: "Funded",
        amount: item.amount,
        fundedAmount: item.fundedAmount,
        lines: item.lines,
        notes: record.status ? `Workbook status: ${record.status}` : "",
      })
      liveDraws.push(draw)
      propertyIds.add(String(property._id))
      added += 1
      marks.push({ sheet: "Dashboard", row: record.address, status: "added", reason: `${item.title} · ${item.amount}` })
    }
    const removed = await Draw.deleteMany({ _id: { $in: explodedDrawIds(liveDraws.filter((draw) => String(draw.propertyId) === String(property._id))) } })
    if (removed.deletedCount) {
      marks.push({ sheet: "Dashboard", row: record.address, status: "added", reason: `Removed ${removed.deletedCount} duplicated scope rows.` })
    }
  }
  return { marks, propertyIds: [...propertyIds], counts: { pending: 0, added, duplicate, skipped: 0 } }
}

export function explodedDrawIds(draws) {
  const ids = []
  for (const group of Map.groupBy(draws, (draw) => String(draw.propertyId)).values()) {
    const scheduled = group.filter((draw) => /^draw \d+$/i.test(draw.title))
    const scopeTitles = new Set(scheduled.flatMap((draw) => (draw.lines || []).map((line) => normalize(line.title))))
    const amounts = new Set(scheduled.map((draw) => Number(draw.amount)))
    for (const draw of group) {
      if (/^draw \d+$/i.test(draw.title)) continue
      const duplicatedScope = scopeTitles.has(normalize(draw.title))
      const duplicatedAmount = !(draw.lines || []).length && amounts.has(Number(draw.amount))
      const copiedScopeLine = !(draw.lines || []).length && String(draw.title || "").trim().length > 40
      if (/^amount \d/i.test(draw.title) || (scheduled.length && (duplicatedScope || duplicatedAmount || copiedScopeLine))) ids.push(draw._id || draw.id)
    }
  }
  return ids
}

export function readWorkbook(filePath, aliasNames = []) {
  const book = xlsx.readFile(filePath, { cellDates: false })
  const wanted = new Set(aliasNames.map((name) => String(name).trim().toLowerCase()))
  const tables = []
  for (const name of book.SheetNames) {
    const grid = xlsx.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" })
    const headerIndex = chooseHeader(grid, wanted)
    if (headerIndex < 0) continue
    if (String(grid[headerIndex]?.[0] || "").trim().toLowerCase() === "line item") continue
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

function parsePropertySheets(book) {
  const skip = new Set(["dashboard", "job p&l", "payments log"])
  const sheets = []
  for (const name of book.SheetNames) {
    if (skip.has(name.toLowerCase())) continue
    const grid = xlsx.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" })
    const addressRow = grid.find((row) => String(row?.[0] || "").trim().toLowerCase() === "address")
    const full = String(addressRow?.[2] || addressRow?.[1] || "").trim()
    const headerIndex = grid.findIndex((row) => String(row?.[0] || "").trim().toLowerCase() === "line item")
    if (headerIndex < 0 || !full) continue
    const header = grid[headerIndex] || []
    const budgetColumn = header.findIndex((cell) => String(cell || "").trim().toLowerCase() === "budget")
    const descriptionColumn = header.findIndex((cell) => /description/i.test(String(cell || "")))
    const drawColumns = []
    header.forEach((cell, index) => {
      const match = String(cell || "").match(/^draw\s*(\d+)/i)
      if (match) drawColumns.push({ index, title: `Draw ${match[1]}` })
    })
    const lines = []
    for (let index = headerIndex + 1; index < grid.length; index += 1) {
      const title = String(grid[index]?.[0] || "").trim()
      if (!title || /^total$/i.test(title) || /^property summary$/i.test(title)) break
      lines.push({
        title,
        description: descriptionColumn >= 0 ? String(grid[index]?.[descriptionColumn] || "").trim() : "",
        draws: Object.fromEntries(drawColumns.map((column) => [column.title, numberOrEmpty(grid[index]?.[column.index])])),
        budget: budgetColumn >= 0 ? numberOrEmpty(grid[index]?.[budgetColumn]) : undefined,
      })
    }
    const parts = full.split(",").map((part) => part.trim()).filter(Boolean)
    sheets.push({
      address: parts[0] || full,
      city: parts[1] || "",
      lines,
    })
  }
  return sheets
}

function matchSheet(sheets, address) {
  const key = normalize(address)
  return sheets.find((sheet) => {
    const street = normalize(sheet.address)
    return street === key || street.startsWith(key) || key.startsWith(street)
  })
}

function sameAddress(left, right) {
  const a = normalize(left)
  const b = normalize(right)
  return a === b || a.startsWith(b) || b.startsWith(a)
}

function trimTrailing(row) {
  let end = row.length
  while (end > 0 && !String(row[end - 1] || "").trim()) end -= 1
  return row.slice(0, end)
}

function chooseHeader(grid, wanted) {
  let bestIndex = -1
  let bestScore = 0
  const limit = Math.min(grid.length, 30)
  for (let index = 0; index < limit; index += 1) {
    const score = (grid[index] || []).filter((cell) => wanted.has(String(cell || "").trim().toLowerCase())).length
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  if (bestIndex >= 0) return bestIndex
  return grid.findIndex((line) => (line || []).some((cell) => String(cell || "").trim()))
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
  const aliases = DRAW_FIELD_ALIASES.flatMap(([field, names]) => names.map((name) => ({ field, name })))
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
