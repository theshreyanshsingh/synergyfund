import { PhotoSet, PhotoReport, Property } from "../models/index.js"

const MARKETS = [
  { code: "fll", name: "Fort Lauderdale" },
  { code: "jax", name: "Jacksonville" },
  { code: "miami", name: "Miami" },
]

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0)
}

export function answerQuestion(question, properties, documents) {
  const text = question.toLowerCase()
  const market = MARKETS.find((item) => text.includes(item.code) || text.includes(item.name.toLowerCase()))

  if (text.includes("highest") && text.includes("rent")) {
    let pool = properties.filter((property) => property.rentStatus === "Rented" && property.actualRent != null)
    if (/rented/.test(text)) pool = pool.filter((property) => property.rentStatus === "Rented")
    if (market) {
      pool = pool.filter((property) => {
        const city = `${property.city} ${property.rentMarket}`.toLowerCase()
        return city.includes(market.code) || city.includes(market.name.toLowerCase())
      })
    }
    if (!pool.length) {
      const where = market ? market.name : "that market"
      return {
        content: `No rented property is on file for ${where}. The books do not contain a rent to report.`,
        sources: [],
      }
    }
    const top = pool.sort((a, b) => Number(b.actualRent) - Number(a.actualRent))[0]
    return {
      content: `${top.address}, ${top.city} is the highest rented rent${market ? ` in ${market.name}` : ""} at ${money(top.actualRent)}. Source: property record${top.rentNotes ? `, ${top.rentNotes}` : ""}.`,
      sources: [{ type: "property", id: String(top._id), label: top.address }],
    }
  }

  if (text.includes("missing") && text.includes("scope")) {
    const missing = properties.filter((property) => !(property.scopeLines || []).length)
    if (!missing.length) return { content: "Every visible property has at least one scope line.", sources: [] }
    return {
      content: `${missing.length} properties have no scope of work: ${missing.map((property) => property.address).join(", ")}.`,
      sources: missing.slice(0, 8).map((property) => ({ type: "property", id: String(property._id), label: property.address })),
    }
  }

  if (text.includes("receipt") || text.includes("document") || text.includes("where")) {
    const hit = documents.find((file) => text.includes(file.name.toLowerCase()) || file.name.toLowerCase().split(" ").some((word) => word.length > 3 && text.includes(word)))
    if (hit) {
      return {
        content: `${hit.name} is filed in the knowledge base${hit.propertyId ? " and linked to a property" : ""}.`,
        sources: [{ type: "document", id: String(hit._id), label: hit.name }],
      }
    }
  }

  const named = properties.find((property) => text.includes(property.address.toLowerCase()))
  if (named) {
    return {
      content: `${named.address}, ${named.city || "city not entered"}. Stage: ${named.stage}. Next step: ${named.nextAction || "not set"}. Purchase: ${named.purchasePrice == null ? "not entered" : money(named.purchasePrice)}. ARV: ${named.arv == null ? "not entered" : money(named.arv)}.`,
      sources: [{ type: "property", id: String(named._id), label: named.address }],
    }
  }

  return {
    content: "I can answer from the records you are allowed to see. Ask for the highest rented rent in a market, which properties are missing a scope of work, or name a property address.",
    sources: [],
  }
}

export async function comparePhotosForDraw(draw) {
  const sets = await PhotoSet.find({ propertyId: draw.propertyId }).sort({ weekOf: -1 }).limit(2)
  const property = await Property.findById(draw.propertyId)
  const current = sets[0]
  const previous = sets[1]
  const scope = (property?.scopeLines || []).filter((line) => ["In progress", "Complete"].includes(line.status))
  const changes = []
  if (!current) changes.push("No weekly photo set is on file. A full set of house photos is required before the change report can describe the work.")
  else if (!previous) changes.push(`Only one photo set is filed (${current.weekOf}, ${current.fileIds.length} photos). The prior week is missing, so nothing is compared.`)
  else {
    changes.push(`Compared ${current.weekOf} (${current.fileIds.length} photos) with ${previous.weekOf} (${previous.fileIds.length} photos).`)
    if (current.note) changes.push(`This week’s note: ${current.note}`)
    if (previous.note) changes.push(`Prior week’s note: ${previous.note}`)
  }
  if (scope.length) {
    changes.push(`Value on file follows existing scope, not a new ARV: ${scope.map((line) => `${line.title} (${line.status})`).join("; ")}.`)
  } else {
    changes.push("No in-progress or complete scope lines are on this property, so no added value is inferred.")
  }
  const summary = changes[0]
  return PhotoReport.create({
    propertyId: draw.propertyId,
    drawId: draw._id,
    summary,
    changes,
    currentSetId: current?._id,
    previousSetId: previous?._id,
  })
}
