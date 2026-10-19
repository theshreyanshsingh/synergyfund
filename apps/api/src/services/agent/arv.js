// After Repair Value from comparable sales, following the team's ARV instructions:
// - a comp is a single-family house, fully renovated, already sold (not listed or pending), on the same side of
//   highways, rivers and train tracks, within 20% of the subject's size and 2 bedrooms / 2 bathrooms of it, and sold
//   in the last 6 months (the last 90 days preferred);
// - its price is adjusted $10,000 per bedroom and $5,000 per bathroom of difference (more rooms: subtract);
// - the closest, most recent comps are used first; one far from the others is left out when enough remain;
// - ARV = average of the adjusted prices, rounded to the nearest thousand; maximum offer = ARV x 0.70 - renovation.

export const ARV_RULES = {
  sqftRange: 0.2,
  maxRoomDifference: 2,
  bedroomValue: 10000,
  bathroomValue: 5000,
  preferredDays: 90,
  maxDays: 183,
  nearMiles: 1,
  minComps: 3,
  maxComps: 6,
  // A comp this far from the others' middle price is flagged to check; this far, left out (while 3 remain).
  outlierShare: 0.15,
  clearOutlierShare: 0.25,
  offerShare: 0.7,
}

const HOUSE_TYPES = new Set(["single-family", "single family", "house", "single-family home", "sfr", "sfh"])

function number(value) {
  if (value == null || value === "") return null
  const parsed = Number(String(value).replace(/[$,\s]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function dayKey(value) {
  const text = String(value || "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10)
}

// The comp's condition: as stated, or read from what its listing says (then it is flagged to check the photos).
export function readCondition(raw, today) {
  const stated = String(raw.condition || "").trim().toLowerCase()
  if (["renovated", "as-is", "new-construction"].includes(stated)) return { condition: stated, inferred: false }
  const text = `${raw.note || ""} ${raw.description || ""} ${stated}`.toLowerCase()
  const thisYear = Number(String(today || "").slice(0, 4)) || new Date().getFullYear()
  const built = Number(raw.yearBuilt) || Number((text.match(/\b(?:built in |year built:? ?)?((?:19|20)\d{2})\s*(?:build|built)\b/) || text.match(/\bbuilt in ((?:19|20)\d{2})\b/) || [])[1])
  if (/\bas[- ]is\b|investor special|needs (?:work|tlc|repairs|updating|some love)|\btlc\b|fixer|handyman|cash only|bring your contractor|foreclos|bank[- ]owned|\breo\b|distress|short sale/.test(text)) return { condition: "as-is", inferred: true }
  if (/new construction|newly built|brand[- ]new home|new build\b/.test(text) || (built && built >= thisYear - 2)) return { condition: "new-construction", inferred: true }
  if (/renovat|remodel|updated|updates|rehab|new (?:kitchen|roof|flooring|floors|cabinets|bath|hvac|ac\b|appliances|paint|windows)|\blvp\b|move[- ]in ready|turn[- ]?key|completely redone|fully redone/.test(text)) return { condition: "renovated", inferred: true }
  return { condition: stated || "unknown", inferred: false }
}

function daysBetween(from, to) {
  if (!from || !to) return null
  return Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000)
}

export function milesBetween(a, b) {
  if (!a || !b) return null
  const rad = (value) => (value * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

function money(value) {
  return `$${Math.round(Math.abs(value)).toLocaleString("en-US")}`
}

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
}

// Room adjustment for one comp: more rooms than the subject lowers its price, fewer raises it.
function adjustmentsFor(subject, comp) {
  const list = []
  const bedDiff = comp.beds - subject.beds
  const bathDiff = comp.baths - subject.baths
  if (bedDiff) list.push({ label: `${Math.abs(bedDiff)} ${bedDiff > 0 ? "extra" : "fewer"} ${Math.abs(bedDiff) === 1 ? "bedroom" : "bedrooms"}`, amount: -bedDiff * ARV_RULES.bedroomValue })
  if (bathDiff) list.push({ label: `${Math.abs(bathDiff)} ${bathDiff > 0 ? "extra" : "fewer"} ${Math.abs(bathDiff) === 1 ? "bathroom" : "bathrooms"}`, amount: -bathDiff * ARV_RULES.bathroomValue })
  return list
}

/**
 * subject: { address, beds, baths, sqft }
 * comps: [{ address, city, salePrice, saleDate, beds, baths, sqft, propertyType, condition, status, distanceMiles, acrossBarrier, url, note }]
 * condition: "renovated" | "as-is" | "unknown"; status: "sold" | "listed" | "pending"
 */
export function analyzeArv({ subject, comps, rehabEstimate = null, listPrice = null, today }) {
  const base = { beds: number(subject.beds), baths: number(subject.baths), sqft: number(subject.sqft) }
  const missing = ["beds", "baths", "sqft"].filter((key) => base[key] == null)
  if (missing.length) return { success: false, error: `The subject's ${missing.map((key) => (key === "sqft" ? "square footage" : key === "beds" ? "bedrooms" : "bathrooms")).join(", ")} ${missing.length === 1 ? "is" : "are"} needed. Find them on the listing or in the records first.` }

  const rows = (Array.isArray(comps) ? comps : []).filter((raw) => raw && typeof raw === "object").slice(0, 30).map((raw) => {
    // The model sometimes names fields its own way; take the usual ones.
    const pick = (...keys) => keys.map((key) => raw[key]).find((value) => value != null && value !== "")
    const read = readCondition(raw, today)
    const comp = {
      address: String(raw.address || "").trim(),
      city: String(raw.city || "").trim(),
      salePrice: number(pick("salePrice", "soldPrice", "closePrice", "price", "sale_price", "sold_price")),
      saleDate: dayKey(pick("saleDate", "soldDate", "closeDate", "sale_date", "sold_date", "date")),
      beds: number(pick("beds", "bedrooms", "bed")),
      baths: number(pick("baths", "bathrooms", "bath")),
      sqft: number(pick("sqft", "squareFeet", "sqFt", "square_feet", "livingArea", "size")),
      propertyType: String(raw.propertyType || raw.homeType || "unknown").trim().toLowerCase(),
      condition: read.condition,
      conditionInferred: read.inferred,
      status: String(raw.status || "sold").trim().toLowerCase(),
      distanceMiles: number(raw.distanceMiles),
      acrossBarrier: raw.acrossBarrier === true,
      url: String(raw.url || "").trim(),
      note: String(raw.note || "").trim().slice(0, 300),
      // From a search list only (skipped for size or rooms, so its listing was never opened to read its condition).
      listOnly: raw.listOnly === true,
      nearby: raw.nearby === true,
    }
    const reasons = []
    const age = daysBetween(comp.saleDate, today)
    if (!comp.address) reasons.push("No address")
    if (comp.status !== "sold") reasons.push(comp.status === "pending" ? "Pending, not sold yet" : "Listed, not sold yet")
    else if (!comp.salePrice) reasons.push("No sale price")
    if (comp.propertyType !== "unknown" && !HOUSE_TYPES.has(comp.propertyType)) reasons.push(`A ${comp.propertyType}, not a single-family house`)
    if (comp.condition === "as-is" || /as.?is|distress|bank|reo|foreclos|fixer|investor/.test(comp.condition)) reasons.push("Sold as-is or distressed")
    else if (comp.condition === "new-construction") reasons.push("New construction, not a renovated house")
    else if (comp.condition !== "renovated" && !comp.listOnly) reasons.push("Not confirmed renovated (check the photos)")
    if (!comp.saleDate) reasons.push("No sale date")
    else if (age > ARV_RULES.maxDays) reasons.push("Sold more than 6 months ago")
    else if (age < 0) reasons.push("Sale date is in the future")
    if (comp.sqft == null) reasons.push("No square footage")
    else if (Math.abs(comp.sqft - base.sqft) > base.sqft * ARV_RULES.sqftRange) reasons.push(`More than 20% ${comp.sqft > base.sqft ? "bigger" : "smaller"} (${comp.sqft.toLocaleString("en-US")} sq ft)`)
    if (comp.beds == null || comp.baths == null) reasons.push("No bedroom or bathroom count")
    else if (Math.abs(comp.beds - base.beds) > ARV_RULES.maxRoomDifference || Math.abs(comp.baths - base.baths) > ARV_RULES.maxRoomDifference) reasons.push("More than 2 bedrooms or bathrooms different")
    if (comp.acrossBarrier) reasons.push("Across a highway, river or train tracks")
    const adjustments = reasons.length ? [] : adjustmentsFor(base, comp)
    const adjustedPrice = reasons.length ? null : comp.salePrice + adjustments.reduce((sum, item) => sum + item.amount, 0)
    return { ...comp, ageDays: age, valid: !reasons.length, reasons, adjustments, adjustedPrice, flags: [] }
  })

  // Closest and most recent first: older or farther comps are only used when the nearby, recent ones are too few,
  // or when the recent ones include one far from the rest and more comps let it be left out.
  const valid = rows.filter((row) => row.valid).sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99))
  const recent = valid.filter((row) => row.ageDays <= ARV_RULES.preferredDays)
  const recentNear = recent.filter((row) => row.distanceMiles != null && row.distanceMiles <= ARV_RULES.nearMiles)
  const offBy = (row, group) => {
    const middle = median(group.map((item) => item.adjustedPrice))
    return Math.abs(row.adjustedPrice - middle) / middle
  }
  const choose = (tier) => {
    let chosen = tier.slice(0, ARV_RULES.maxComps)
    const removed = []
    // One much higher or lower than the rest is left out, while enough remain.
    while (chosen.length > ARV_RULES.minComps) {
      const scored = chosen.map((row) => ({ row, off: offBy(row, chosen.filter((other) => other !== row)) })).sort((a, b) => b.off - a.off)
      if (scored[0].off <= ARV_RULES.clearOutlierShare) break
      removed.push({ row: scored[0].row, high: scored[0].row.adjustedPrice > median(chosen.map((row) => row.adjustedPrice)) })
      chosen = chosen.filter((row) => row !== scored[0].row)
    }
    const clear = chosen.length >= 3 && chosen.some((row) => offBy(row, chosen.filter((other) => other !== row)) > ARV_RULES.clearOutlierShare)
    return { chosen, removed, flagged: clear }
  }
  // The nearest, most recent set with no comp clearly out of line (older or farther comps only come in when needed);
  // when every set has one, the set whose prices sit closest together.
  const spread = (attempt) => Math.max(...attempt.chosen.map((row) => offBy(row, attempt.chosen)))
  let pick = null
  for (const tier of [recentNear, recent, valid]) {
    if (tier.length < ARV_RULES.minComps) continue
    const attempt = choose(tier)
    if (!attempt.flagged) {
      pick = attempt
      break
    }
    if (!pick || spread(attempt) < spread(pick)) pick = attempt
  }
  if (!pick) pick = choose(valid)
  let chosen = pick.chosen
  for (const { row, high } of pick.removed) row.reasons.push(`${high ? "Much higher" : "Much lower"} than the other comps (left out)`)
  for (const row of valid) {
    if (chosen.includes(row) || row.reasons.length) continue
    row.reasons.push(row.ageDays > ARV_RULES.preferredDays ? "Sold more than 90 days ago, and there are enough recent comps" : row.distanceMiles != null && row.distanceMiles > ARV_RULES.nearMiles ? "More than a mile away, and there are enough closer comps" : "Enough closer comps")
  }
  if (chosen.length >= 2) {
    for (const row of chosen) if (offBy(row, chosen) > ARV_RULES.outlierShare) row.flags.push("Far from the others")
  }
  for (const row of chosen) {
    if (row.ageDays > ARV_RULES.preferredDays) row.flags.push("Sold 90+ days ago")
    if (row.distanceMiles != null && row.distanceMiles > ARV_RULES.nearMiles) row.flags.push("Over 1 mile away")
    if (row.distanceMiles == null) row.flags.push("Distance unknown")
    if (row.nearby) row.flags.push("Next ZIP over")
    if (row.propertyType === "unknown") row.flags.push("House type unconfirmed")
    if (row.conditionInferred) row.flags.push("Check photos")
  }
  const used = new Set(chosen)
  const average = chosen.length ? chosen.reduce((sum, row) => sum + row.adjustedPrice, 0) / chosen.length : null
  const arv = average == null ? null : Math.round(average / 1000) * 1000
  const rehab = number(rehabEstimate)
  const list = number(listPrice)
  const maxOffer = arv != null && rehab != null ? Math.round(arv * ARV_RULES.offerShare - rehab) : null
  const ready = chosen.length >= ARV_RULES.minComps
  const present = (row) => ({
    address: row.address,
    city: row.city,
    salePrice: row.salePrice,
    saleDate: row.saleDate,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    distanceMiles: row.distanceMiles == null ? null : Math.round(row.distanceMiles * 10) / 10,
    condition: row.condition,
    url: row.url,
    note: row.note,
    adjustments: row.adjustments,
    adjustedPrice: row.adjustedPrice,
    flags: row.flags,
    reasons: row.reasons,
  })
  return {
    success: true,
    clearOutlier: pick?.flagged || false,
    subject: { address: String(subject.address || ""), beds: base.beds, baths: base.baths, sqft: base.sqft, sqftRange: [Math.round(base.sqft * (1 - ARV_RULES.sqftRange)), Math.round(base.sqft * (1 + ARV_RULES.sqftRange))] },
    ready,
    arv,
    average: average == null ? null : Math.round(average),
    used: chosen.map(present),
    skipped: rows.filter((row) => !used.has(row)).map(present),
    rehabEstimate: rehab,
    listPrice: list,
    maxOffer,
    offerFormula: maxOffer == null ? "" : `${money(arv)} x 0.70 - ${money(rehab)} = ${money(maxOffer)}${maxOffer < 0 ? " (below zero)" : ""}`,
    listGap: maxOffer != null && list != null ? list - maxOffer : null,
    math: chosen.length ? `(${chosen.map((row) => money(row.adjustedPrice)).join(" + ")}) / ${chosen.length} = ${money(average)}, rounded to ${money(arv)}` : "",
    summary: ready
      ? `ARV ${money(arv)} from ${plural(chosen.length, "comp")}.`
      : chosen.length
        ? `Only ${plural(chosen.length, "usable comp")}: ${ARV_RULES.minComps} are needed for a reliable ARV. Add more comps.`
        : "No comps passed the rules. Add sold, renovated single-family houses nearby.",
  }
}
