import { PhotoSet, PhotoReport, Property } from "../models/index.js"

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
