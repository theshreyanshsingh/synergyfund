import { drawFigures } from "@synergifund/shared"
import xlsx from "xlsx"

export const DRAW_FIELD_ALIASES = [
  ["fundedAmount", ["funded amount", "lender cash", "received amount", "cash received", "pulled", "amount pulled"]],
  ["requestedDate", ["forecast finish", "requested date", "request date", "est date", "forecast"]],
  ["fundedDate", ["funded date", "received date", "date received"]],
  ["rehabBudget", ["rehab budget", "rehab", "total budget"]],
  ["fundingLimit", ["lender funding", "funding limit", "lender limit"]],
  ["address", ["property address", "street", "project", "property", "address"]],
  ["lineAmount", ["line amount", "line item amount", "item amount", "scope amount"]],
  ["lineBudget", ["line budget", "line item budget", "scope budget"]],
  ["lineDescription", ["line description", "line item description", "scope description", "description"]],
  ["lineTitle", ["line item", "scope item", "scope of work", "scope", "line", "item"]],
  ["title", ["draw name", "draw"]],
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
  let totalLine = null
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const line = trimTrailing((grid[index] || []).map((cell) => String(cell || "").trim()))
    const address = line[0] || ""
    if (!address) continue
    if (/^portfolio total$/i.test(address)) {
      totalLine = line
      break
    }
    if (/^how to use$/i.test(address)) break
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
    const lastDraw = Math.max(detail?.lastDrawNumber || 0, ...draws.map((draw) => Number(draw.title.replace(/\D+/g, "")) || 0))
    const pendingLines = (detail?.lines || []).flatMap((scope) => (scope.pending > 0 ? [{ title: scope.title, description: scope.description, amount: scope.pending }] : []))
    return {
      address: detail?.address || label,
      label,
      city: detail?.city || "",
      rehabBudget: numberOrEmpty(line[column("Total Budget")]),
      lenderFunding: numberOrEmpty(line[column("Lender Funding")]),
      fundedPercent: detail?.fundedPercent ?? null,
      status: line[column("Status")] || "",
      draws,
      pending: numberOrEmpty(line[column("Pending Draws")]) || pendingLines.reduce((sum, item) => sum + item.amount, 0),
      pendingTitle: `Draw ${lastDraw + 1}`,
      pendingLines,
      lines: (detail?.lines || []).map((scope) => ({
        title: scope.title,
        description: scope.description,
        budget: scope.budget ?? null,
        drawn: drawColumns.reduce((sum, column) => sum + Math.max(0, Number(scope.draws?.[column.title]) || 0), 0) || Object.values(scope.draws || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0),
        pending: Math.max(0, Number(scope.pending) || 0),
      })),
      sheet: {
        budget: numberOrEmpty(line[column("Total Budget")]),
        lenderFunding: numberOrEmpty(line[column("Lender Funding")]),
        drawn: numberOrEmpty(line[column("Drawn to Date (gross)")]) || 0,
        received: cashReceived || 0,
        pending: numberOrEmpty(line[column("Pending Draws")]) || 0,
        available: numberOrEmpty(line[column("Available to Withdraw")]) || 0,
        remaining: numberOrEmpty(line[column("Remaining Budget")]) || 0,
      },
    }
  })
  const totalAt = (label) => (totalLine ? numberOrEmpty(totalLine[column(label)]) : null)
  const totals = totalLine
    ? {
      budget: totalAt("Total Budget") || 0,
      lenderFunding: totalAt("Lender Funding") || 0,
      drawn: totalAt("Drawn to Date (gross)") || 0,
      received: totalAt("CASH RECEIVED (funded share)") || 0,
      pending: totalAt("Pending Draws") || 0,
      available: totalAt("Available to Withdraw") || 0,
      remaining: totalAt("Remaining Budget") || 0,
    }
    : null
  return {
    columns: displayHeader,
    grid: table.map((line) => displayHeader.map((_, index) => line[index] || "")),
    records,
    totals,
    counts: {
      pending: records.reduce((sum, record) => sum + record.draws.length, 0),
      duplicate: 0,
      skipped: 0,
      added: 0,
    },
  }
}

const WORKBOOK_SOURCE = "workbook"

function fromWorkbook(draw) {
  return draw.source === WORKBOOK_SOURCE || /^workbook status/i.test(String(draw.notes || ""))
}

export async function importPortfolioRecords({ records, properties, draws, Draw, DrawBudget, Property, userName, totals }) {
  const liveProperties = [...properties]
  let liveDraws = [...draws]
  let added = 0
  let duplicate = 0
  let removedCount = 0
  let lineCount = 0
  const propertyIds = new Set()
  const marks = []
  const checks = []
  for (const record of records) {
    let property = findProperty(liveProperties, record)
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
    }
    propertyIds.add(String(property._id))
    if (record.rehabBudget != null) property.rehabBudget = record.rehabBudget
    if (record.city && !property.city) property.city = record.city
    if (record.status) property.nextAction = record.status
    if (record.lines?.length) {
      lineCount += record.lines.length
      const before = new Map()
      for (const line of property.scopeLines || []) {
        const key = normalize(line.title)
        if (!before.has(key)) before.set(key, [])
        before.get(key).push(line)
      }
      property.scopeLines = record.lines.map((line) => {
        const kept = before.get(normalize(line.title))?.shift()
        return {
          ...(kept?._id ? { _id: kept._id } : {}),
          title: line.title,
          description: line.description || "",
          budget: line.budget ?? undefined,
          status: kept?.status || "Not started",
        }
      })
      property.markModified?.("scopeLines")
    }
    await property.save()
    let budget = await DrawBudget.findOne({ propertyId: property._id })
    if (record.lenderFunding != null || record.fundedPercent != null) {
      if (!budget) {
        budget = await DrawBudget.create({
          propertyId: property._id,
          title: "Lender funding",
          budget: record.rehabBudget,
          fundingLimit: record.lenderFunding ?? record.rehabBudget,
          fundingPercent: record.fundedPercent ?? 100,
          fundingBasis: "Imported workbook",
        })
      } else {
        budget.budget = record.rehabBudget ?? budget.budget
        if (record.lenderFunding != null) budget.fundingLimit = record.lenderFunding
        if (record.fundedPercent != null) budget.fundingPercent = record.fundedPercent
        await budget.save()
      }
    }
    const notes = record.status ? `Workbook status: ${record.status}` : ""
    const own = () => liveDraws.filter((draw) => String(draw.propertyId) === String(property._id))
    const wanted = new Set(record.draws.map((item) => normalize(item.title)))
    if (record.pending > 0) wanted.add(normalize(record.pendingTitle))
    const incoming = [
      ...record.draws.map((item) => ({ ...item, status: "Funded" })),
      ...(record.pending > 0 ? [{ title: record.pendingTitle, amount: record.pending, fundedAmount: null, lines: record.pendingLines, status: "Requested" }] : []),
    ]
    for (const item of incoming) {
      const exists = own().find((draw) => normalize(draw.title) === normalize(item.title))
      if (exists) {
        exists.amount = item.amount
        exists.fundedAmount = item.fundedAmount ?? undefined
        exists.lines = item.lines
        exists.status = item.status
        exists.source = WORKBOOK_SOURCE
        exists.notes = notes || exists.notes
        exists.markModified?.("lines")
        await exists.save()
        duplicate += 1
        marks.push({ sheet: "Dashboard", row: record.address, status: "duplicate", reason: `${item.title} updated from the workbook.` })
        continue
      }
      const draw = await Draw.create({
        propertyId: property._id,
        title: item.title,
        status: item.status,
        amount: item.amount,
        fundedAmount: item.fundedAmount ?? undefined,
        lines: item.lines,
        source: WORKBOOK_SOURCE,
        notes,
      })
      liveDraws.push(draw)
      added += 1
      marks.push({ sheet: "Dashboard", row: record.address, status: "added", reason: `${item.title} · ${item.amount}${item.status === "Requested" ? " (pending)" : ""}` })
    }
    const stale = own().filter((draw) => fromWorkbook(draw) && !wanted.has(normalize(draw.title))).map((draw) => draw._id || draw.id)
    const exploded = explodedDrawIds(own())
    const doomed = [...new Set([...stale, ...exploded].map(String))]
    if (doomed.length) {
      const removed = await Draw.deleteMany({ _id: { $in: doomed } })
      removedCount += removed.deletedCount || 0
      liveDraws = liveDraws.filter((draw) => !doomed.includes(String(draw._id || draw.id)))
      if (removed.deletedCount) marks.push({ sheet: "Dashboard", row: record.address, status: "duplicate", reason: `Removed ${removed.deletedCount} draws that are no longer in the workbook.` })
    }
    const figures = drawFigures({
      budget: property.rehabBudget,
      lenderFunding: budget?.fundingLimit,
      fundedPercent: budget?.fundingPercent,
      draws: own(),
    })
    checks.push({ address: record.address, app: figures, sheet: record.sheet })
  }
  return {
    marks,
    propertyIds: [...propertyIds],
    counts: { pending: 0, added, duplicate, skipped: 0, removed: removedCount, lines: lineCount },
    reconciliation: reconcile(checks, totals),
  }
}

const RECONCILE_FIELDS = [
  ["budget", "Total budget"],
  ["drawn", "Drawn"],
  ["received", "Cash received"],
  ["pending", "Pending"],
  ["available", "Available to withdraw"],
  ["remaining", "Remaining budget"],
]

export function reconcile(checks, totals) {
  const differences = []
  const app = Object.fromEntries(RECONCILE_FIELDS.map(([key]) => [key, 0]))
  for (const check of checks) {
    for (const [key, label] of RECONCILE_FIELDS) {
      const mine = Number(check.app[key]) || 0
      app[key] += mine
      if (!check.sheet) continue
      const theirs = Number(check.sheet[key]) || 0
      if (Math.abs(mine - theirs) > 1) differences.push({ address: check.address, field: label, app: Math.round(mine * 100) / 100, sheet: theirs })
    }
  }
  const sheet = totals ? Object.fromEntries(RECONCILE_FIELDS.map(([key]) => [key, Number(totals[key]) || 0])) : null
  return {
    matches: differences.length === 0,
    properties: checks.length,
    app: Object.fromEntries(Object.entries(app).map(([key, value]) => [key, Math.round(value * 100) / 100])),
    sheet,
    differences,
  }
}

export function explodedDrawIds(draws) {
  const ids = []
  for (const group of Map.groupBy(draws, (draw) => String(draw.propertyId)).values()) {
    const scheduled = group.filter((draw) => /^draw \d+$/i.test(draw.title))
    const scopeTitles = new Set(scheduled.flatMap((draw) => (draw.lines || []).map((line) => normalize(line.title))))
    const amounts = new Set(scheduled.map((draw) => Number(draw.amount)))
    for (const draw of group) {
      if (/^draw \d+$/i.test(draw.title)) continue
      if (/^amount \d/i.test(draw.title)) {
        ids.push(draw._id || draw.id)
        continue
      }
      if (!fromWorkbook(draw) || !scheduled.length) continue
      const duplicatedScope = scopeTitles.has(normalize(draw.title))
      const duplicatedAmount = !(draw.lines || []).length && amounts.has(Number(draw.amount))
      const copiedScopeLine = !(draw.lines || []).length && String(draw.title || "").trim().length > 40
      if (duplicatedScope || duplicatedAmount || copiedScopeLine) ids.push(draw._id || draw.id)
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

function planDrawRows(rows, properties, draws) {
  const byAddress = indexProperties(properties)
  const existing = new Map()
  for (const draw of draws) {
    const property = properties.find((item) => String(item._id || item.id) === String(draw.propertyId))
    if (property) existing.set(drawKey(property.address, draw.title), draw)
  }
  const groups = new Map()
  const decisions = rows.map((source) => {
    const mapped = mapRow(source.cells)
    const address = String(mapped.address || "").trim()
    if (!address) return { status: "skipped", reason: "No address, so this row was not added." }
    const property = byAddress.get(normalize(address))
    const title = String(mapped.title || "").trim()
    const lineTitle = String(mapped.lineTitle || "").trim()
    if (!title) {
      if (lineTitle) {
        const known = (property?.scopeLines || []).some((line) => normalize(line.title) === normalize(lineTitle))
        if (known) return { status: "duplicate", reason: `${lineTitle} is already a line item on ${address}.`, mapped, scopeOnly: true }
        return { status: "new", reason: `Adds ${lineTitle} to the line items of ${address}.`, mapped, scopeOnly: true }
      }
      if (mapped.rehabBudget == null) {
        return { status: "skipped", reason: mapped.amount != null ? "This amount has no draw name. Add a Draw column (Draw 1, Draw 2…) so it can be saved as a draw." : "This row has no draw, line item or budget." }
      }
      if (property && property.rehabBudget != null) return { status: "duplicate", reason: `${address} is already on file. Its budget was not replaced.` }
      return { status: "new", reason: property ? "The budget is blank on this property, so this figure will be added." : "New property. Only the cells with values will be saved.", mapped, budgetOnly: true }
    }
    const key = drawKey(address, title)
    let group = groups.get(key)
    if (!group) {
      group = { key, address, title, mapped, property, existing: existing.get(key), rows: [], lines: [] }
      groups.set(key, group)
    }
    group.rows.push(source)
    if (lineTitle) {
      group.lines.push({
        title: lineTitle,
        description: String(mapped.lineDescription || "").trim(),
        amount: mapped.lineAmount,
        budget: mapped.lineBudget,
        row: source,
      })
    }
    const lineNote = lineTitle ? `${lineTitle}${mapped.lineAmount != null ? ` · $${Number(mapped.lineAmount).toLocaleString("en-US")}` : ""}` : ""
    if (group.existing && ((group.existing.lines || []).length || !lineTitle)) {
      return { status: "duplicate", reason: `${address} already has ${title}. The original was left unchanged.`, group }
    }
    if (group.existing) return { status: "new", reason: `Adds the line item ${lineNote} to ${title}, which is already on file.`, group }
    if (group.rows.length > 1) return { status: "new", reason: `Line item of ${title}${lineNote ? `: ${lineNote}` : ""}.`, group, line: true }
    const where = property ? `New draw on ${address}.` : "New property and draw."
    return { status: "new", reason: `${where}${lineNote ? ` First line item: ${lineNote}.` : ""}`, group }
  })
  return { decisions, groups: [...groups.values()] }
}

export function classifyDrawRows(tables, properties, draws) {
  const headers = []
  const rows = []
  for (const table of tables) {
    for (const header of table.headers) if (!headers.includes(header)) headers.push(header)
    rows.push(...table.rows)
  }
  const { decisions, groups } = planDrawRows(rows, properties, draws)
  const marked = rows.map((source, index) => ({ ...source, status: decisions[index].status, reason: decisions[index].reason }))
  const newGroups = groups.filter((group) => decisions.some((decision) => decision.group === group && decision.status === "new"))
  return {
    headers,
    rows: marked,
    counts: {
      pending: marked.filter((row) => row.status === "new").length,
      draws: newGroups.filter((group) => !group.existing).length,
      lines: newGroups.reduce((total, group) => total + group.lines.length, 0),
      duplicate: marked.filter((row) => row.status === "duplicate").length,
      skipped: marked.filter((row) => row.status === "skipped").length,
      added: 0,
    },
  }
}

function mergeLines(lines, fallbackAmount) {
  const merged = new Map()
  for (const line of lines) {
    const key = normalize(line.title)
    const amount = line.amount ?? (lines.length === 1 ? fallbackAmount : null)
    const current = merged.get(key)
    if (current) {
      if (amount != null) current.amount = (current.amount || 0) + amount
      if (!current.description && line.description) current.description = line.description
      if (current.budget == null && line.budget != null) current.budget = line.budget
    } else {
      merged.set(key, { title: line.title, description: line.description || "", amount: amount ?? undefined, budget: line.budget ?? null })
    }
  }
  return [...merged.values()]
}

function addScopeLines(property, lines) {
  const known = new Set((property.scopeLines || []).map((line) => normalize(line.title)))
  let added = 0
  for (const line of lines) {
    if (known.has(normalize(line.title))) continue
    known.add(normalize(line.title))
    property.scopeLines = [...(property.scopeLines || []), { title: line.title, description: line.description || "", budget: line.budget ?? undefined, status: "Not started" }]
    added += 1
  }
  if (added) property.markModified?.("scopeLines")
  return added
}

export async function appendNewDrawRows({ rows, properties, draws, Draw, DrawBudget, Property, userName }) {
  const liveProperties = [...properties]
  const { decisions, groups } = planDrawRows(rows, liveProperties, draws)
  const marks = rows.map((source, index) => mark(source, decisions[index].status, decisions[index].reason))
  const propertyIds = new Set()
  let added = 0
  let lineCount = 0

  async function propertyFor(address, mapped) {
    let property = liveProperties.find((item) => normalize(item.address) === normalize(address))
    if (!property) {
      property = await Property.create({ address, city: String(mapped.city || "").trim(), rehabBudget: mapped.rehabBudget ?? undefined, updatedBy: userName })
      liveProperties.push(property)
    } else if (property.rehabBudget == null && mapped.rehabBudget != null) {
      property.rehabBudget = mapped.rehabBudget
      if (!String(property.city || "").trim() && mapped.city) property.city = String(mapped.city).trim()
    }
    propertyIds.add(String(property._id))
    return property
  }

  for (const group of groups) {
    const wanted = decisions.filter((decision) => decision.group === group && decision.status === "new")
    if (!wanted.length) continue
    const property = await propertyFor(group.address, group.mapped)
    const lines = mergeLines(group.lines, group.mapped.amount)
    const lineTotal = lines.reduce((total, line) => total + (Number(line.amount) || 0), 0)
    lineCount += addScopeLines(property, lines)
    await property.save()
    const drawLines = lines.filter((line) => line.amount != null).map((line) => ({ title: line.title, description: line.description, amount: line.amount }))
    if (group.existing) {
      const draw = await Draw.findById(group.existing._id || group.existing.id)
      if (draw && !(draw.lines || []).length) {
        draw.lines = drawLines
        if (draw.amount == null && lineTotal) draw.amount = lineTotal
        await draw.save()
      }
    } else {
      const status = drawStatus(group.mapped.status)
      await Draw.create({
        propertyId: property._id,
        title: group.title,
        status,
        amount: group.mapped.amount ?? (lineTotal || undefined),
        fundedAmount: group.mapped.fundedAmount ?? undefined,
        requestedDate: group.mapped.requestedDate || "",
        fundedDate: group.mapped.fundedDate || "",
        lines: drawLines,
        notes: group.mapped.amount != null && lineTotal && Math.abs(lineTotal - group.mapped.amount) > 0.5 ? `Line items add up to $${lineTotal.toLocaleString("en-US")}; the sheet's draw amount is $${group.mapped.amount.toLocaleString("en-US")}.` : "",
      })
      added += 1
    }
    for (const decision of wanted) {
      const at = decisions.indexOf(decision)
      marks[at] = mark(rows[at], "added", decision.reason.replace(/^New property and draw\.|^New draw on [^.]+\./, "Added."))
    }
  }
  for (const [index, decision] of decisions.entries()) {
    if (decision.status !== "new" || decision.group) continue
    const mapped = decision.mapped
    const property = await propertyFor(String(mapped.address).trim(), mapped)
    if (decision.scopeOnly) {
      lineCount += addScopeLines(property, [{ title: String(mapped.lineTitle).trim(), description: String(mapped.lineDescription || "").trim(), budget: mapped.lineBudget ?? mapped.lineAmount ?? mapped.amount ?? null }])
    }
    await property.save()
    marks[index] = mark(rows[index], "added", decision.scopeOnly ? "Line item added." : "Budget added.")
  }

  let budgetsFilled = 0
  const touched = new Map()
  for (const [index, decision] of decisions.entries()) {
    const mapped = decision.mapped || decision.group?.mapped
    if (decision.status === "skipped" || !mapped) continue
    const rowMapped = mapRow(rows[index].cells)
    const address = String(rowMapped.address || "").trim()
    const property = liveProperties.find((item) => normalize(item.address) === normalize(address))
    if (!property) continue
    let changed = false
    if (property.rehabBudget == null && rowMapped.rehabBudget != null) {
      property.rehabBudget = rowMapped.rehabBudget
      changed = true
      budgetsFilled += 1
    }
    const lineTitle = String(rowMapped.lineTitle || "").trim()
    if (lineTitle && rowMapped.lineBudget != null) {
      const line = (property.scopeLines || []).find((item) => normalize(item.title) === normalize(lineTitle))
      if (line && (line.budget == null || line.budget === "")) {
        line.budget = rowMapped.lineBudget
        property.markModified?.("scopeLines")
        changed = true
        budgetsFilled += 1
      }
    }
    if (changed) touched.set(String(property._id), property)
    if (DrawBudget && rowMapped.fundingLimit != null && !touched.has(`funding:${property._id}`)) {
      touched.set(`funding:${property._id}`, true)
      const record = await DrawBudget.findOne({ propertyId: property._id })
      if (!record) {
        await DrawBudget.create({ propertyId: property._id, title: "Lender funding", budget: property.rehabBudget ?? rowMapped.rehabBudget ?? undefined, fundingLimit: rowMapped.fundingLimit, fundingBasis: "Imported workbook" })
        budgetsFilled += 1
      } else if (record.fundingLimit == null) {
        record.fundingLimit = rowMapped.fundingLimit
        await record.save()
        budgetsFilled += 1
      }
    }
  }
  for (const [id, property] of touched) {
    if (id.startsWith("funding:")) continue
    await property.save()
    propertyIds.add(id)
  }
  return {
    marks,
    propertyIds: [...propertyIds],
    counts: {
      pending: 0,
      added,
      budgets: budgetsFilled,
      lines: lineCount,
      duplicate: decisions.filter((decision) => decision.status === "duplicate").length,
      skipped: decisions.filter((decision) => decision.status === "skipped").length,
    },
  }
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
    const pendingColumn = header.findIndex((cell) => /^pending/i.test(String(cell || "").trim()))
    const drawColumns = []
    header.forEach((cell, index) => {
      const match = String(cell || "").trim().match(/^draws?\s*(\d+)(?:\s*[–—-]\s*(\d+))?/i)
      if (match) drawColumns.push({ index, title: `Draw ${match[1]}`, last: Number(match[2] || match[1]) })
    })
    const fundedRow = grid.find((row) => /lender funded %/i.test(String(row?.[0] || "")))
    const fundedText = String(fundedRow?.[2] || fundedRow?.[1] || "").replace(/[%\s]/g, "")
    const lines = []
    let blanks = 0
    for (let index = headerIndex + 1; index < grid.length; index += 1) {
      const title = String(grid[index]?.[0] || "").trim()
      if (/^total$/i.test(title) || /^property summary$/i.test(title)) break
      if (!title) {
        blanks += 1
        if (blanks >= 3 && lines.length) break
        continue
      }
      blanks = 0
      lines.push({
        title,
        description: descriptionColumn >= 0 ? String(grid[index]?.[descriptionColumn] || "").trim() : "",
        draws: Object.fromEntries(drawColumns.map((column) => [column.title, numberOrEmpty(grid[index]?.[column.index])])),
        budget: budgetColumn >= 0 ? numberOrEmpty(grid[index]?.[budgetColumn]) : undefined,
        pending: pendingColumn >= 0 ? numberOrEmpty(grid[index]?.[pendingColumn]) : null,
      })
    }
    const usedColumns = drawColumns.filter((column) => lines.some((line) => (line.draws[column.title] || 0) > 0))
    const parts = full.split(",").map((part) => part.trim()).filter(Boolean)
    sheets.push({
      address: parts[0] || full,
      city: parts[1] || "",
      lines,
      fundedPercent: fundedText && Number.isFinite(Number(fundedText)) ? Number(fundedText) : null,
      lastDrawNumber: usedColumns.reduce((max, column) => Math.max(max, column.last), 0),
    })
  }
  return sheets
}

const STREET_TYPES = {
  street: "st", st: "st", avenue: "ave", ave: "ave", av: "ave", road: "rd", rd: "rd", drive: "dr", dr: "dr",
  boulevard: "blvd", blvd: "blvd", lane: "ln", ln: "ln", court: "ct", ct: "ct", place: "pl", pl: "pl",
  terrace: "ter", ter: "ter", circle: "cir", cir: "cir", way: "way", parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy", trail: "trl", trl: "trl", square: "sq", sq: "sq",
}
const DIRECTIONS = { n: "n", north: "n", s: "s", south: "s", e: "e", east: "e", w: "w", west: "w" }

function streetKey(address) {
  const text = String(address || "").toLowerCase().split(",")[0].replace(/\(.*?\)/g, " ")
  const unitMatch = text.match(/(?:#|\b(?:apt|unit|suite|ste)\b\.?\s*)\s*([a-z0-9-]+)/)
  const unit = unitMatch ? unitMatch[1] : ""
  const words = text.replace(/(?:#|\b(?:apt|unit|suite|ste)\b\.?\s*)\s*[a-z0-9-]+/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean)
  const number = /^\d+[a-z]?$/.test(words[0] || "") ? words[0] : ""
  if (!number) return ""
  const parts = []
  let type = ""
  for (const word of words.slice(1)) {
    if (DIRECTIONS[word] && !parts.length) parts.push(DIRECTIONS[word])
    else if (STREET_TYPES[word]) type = STREET_TYPES[word]
    else parts.push(word)
  }
  const name = parts.filter((word) => !DIRECTIONS[word] || parts.length === 1)
  if (!name.length) return ""
  return [number, ...parts, type, unit ? `#${unit}` : ""].filter(Boolean).join(" ")
}

function looseKey(address) {
  const key = streetKey(address)
  return key.replace(/ (st|ave|rd|dr|blvd|ln|ct|pl|ter|cir|way|pkwy|hwy|trl|sq)(?= |$)/, "")
}

function matchSheet(sheets, address) {
  const key = normalize(address)
  const exact = sheets.find((sheet) => {
    const street = normalize(sheet.address)
    return street === key || prefixAt(street, key) || prefixAt(key, street)
  })
  if (exact) return exact
  return uniqueMatch(sheets, (sheet) => sheet.address, address)
}

function streetType(address) {
  return (streetKey(address).match(/ (st|ave|rd|dr|blvd|ln|ct|pl|ter|cir|way|pkwy|hwy|trl|sq)(?= |$)/) || [])[1] || ""
}

function uniqueMatch(items, addressOf, address) {
  const type = streetType(address)
  const typesAgree = (other) => !type || !streetType(other) || streetType(other) === type
  for (const keyOf of [streetKey, looseKey]) {
    const wanted = keyOf(address)
    if (!wanted) continue
    const candidates = items.filter((item) => keyOf(addressOf(item)) === wanted && typesAgree(addressOf(item)))
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) return undefined
  }
  return undefined
}

function findProperty(properties, record) {
  const names = [record.address, record.label].filter(Boolean)
  const direct = properties.find((item) => names.some((name) => sameAddress(item.address, name)))
  if (direct) return direct
  return uniqueMatch(properties, (item) => item.address, record.label || record.address) || uniqueMatch(properties, (item) => item.address, record.address)
}

function sameAddress(left, right) {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return false
  return a === b || prefixAt(a, b) || prefixAt(b, a)
}

function prefixAt(long, short) {
  return long.startsWith(short) && /^[\s,(]/.test(long.slice(short.length))
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
    lineTitle: mapped.lineTitle || "",
    lineDescription: mapped.lineDescription || "",
    lineAmount: numberOrEmpty(mapped.lineAmount),
    lineBudget: numberOrEmpty(mapped.lineBudget),
    fundingLimit: numberOrEmpty(mapped.fundingLimit),
  }
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

function indexProperties(properties) {
  const map = new Map()
  for (const property of properties) map.set(normalize(property.address), property)
  return map
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
