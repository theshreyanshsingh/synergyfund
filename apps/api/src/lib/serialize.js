import { assignmentFee, can, cleanSounds, insurancePolicies, permissionsFor, propertyUtilities } from "@synergifund/shared"

export function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    title: user.title || "",
    company: user.company || "SynergiFund",
    extraPermissions: user.extraPermissions || [],
    deniedPermissions: user.deniedPermissions || [],
    permissions: permissionsFor(user),
    propertyIds: (user.propertyIds || []).map(String),
    sounds: cleanSounds(user.sounds),
    bot: Boolean(user.bot),
  }
}

// When the comps last changed. Older comps fall back to when the newest one was added.
function compsUpdatedAt(source) {
  if (source.compsUpdatedAt) return new Date(source.compsUpdatedAt).toISOString()
  const times = (source.comps || []).map((comp) => comp._id?.getTimestamp?.()?.getTime()).filter(Boolean)
  return times.length ? new Date(Math.max(...times)).toISOString() : null
}

export function presentProperty(property, user) {
  const source = property.toObject ? property.toObject() : property
  if (user?.role === "contractor") {
    return {
      id: String(source._id),
      address: source.address,
      city: source.city || "",
      state: source.state || "",
      zip: source.zip || "",
      stage: source.stage,
      accessInfo: source.accessInfo || "",
      scopeLines: (source.scopeLines || []).map((line) => ({
        _id: String(line._id),
        title: line.title,
        description: line.description || "",
        status: line.status || "Not started",
        statusBy: line.statusBy || "",
        forecastDate: line.forecastDate || "",
      })),
    }
  }
  const visible = {
    id: String(source._id),
    address: source.address,
    city: source.city || "",
    state: source.state || "",
    zip: source.zip || "",
    stage: source.stage,
    strategy: source.strategy || "",
    health: source.health || "Health not assessed",
    nextAction: source.nextAction || "",
    deadline: source.deadline || "",
    ownerEntity: source.ownerEntity || "",
    accessInfo: source.accessInfo || "",
    purchasePrice: source.purchasePrice ?? null,
    purchaseDate: source.purchaseDate || "",
    dealSource: source.dealSource || "",
    arv: source.arv ?? null,
    arvDate: source.arvDate || "",
    arvMethod: source.arvMethod || "",
    sqft: source.sqft ?? null,
    beds: source.beds ?? null,
    baths: source.baths ?? null,
    lat: source.lat ?? null,
    lng: source.lng ?? null,
    compsUpdatedAt: compsUpdatedAt(source),
    comps: (source.comps || []).map((comp) => ({
      id: String(comp._id),
      address: comp.address,
      city: comp.city || "",
      salePrice: comp.salePrice ?? null,
      saleDate: comp.saleDate || "",
      purchasePrice: comp.purchasePrice ?? null,
      purchaseDate: comp.purchaseDate || "",
      beds: comp.beds ?? null,
      baths: comp.baths ?? null,
      sqft: comp.sqft ?? null,
      zillowUrl: comp.zillowUrl || "",
      notes: comp.notes || "",
      include: comp.include !== false,
      photoIds: (comp.photoFileIds || []).map(String),
      lat: comp.lat ?? null,
      lng: comp.lng ?? null,
    })),
    marketRent: source.marketRent ?? null,
    actualRent: source.actualRent ?? null,
    rentStatus: source.rentStatus || "",
    rentMarket: source.rentMarket || "",
    rentNotes: source.rentNotes || "",
    customerTerms: user?.role === "contractor" ? "" : source.customerTerms || "",
    rehabBudget: source.rehabBudget ?? null,
    rehabRemaining: source.rehabRemaining ?? null,
    taxAmount: source.taxAmount ?? null,
    taxParcel: source.taxParcel || "",
    taxDueDate: source.taxDueDate || "",
    insurancePolicies: insurancePolicies(source),
    taxPaidOn: source.taxPaidOn || "",
    utilities: propertyUtilities(source.utilities),
    refinanceStage: source.refinanceStage || "",
    refinanceClosedAt: source.refinanceClosedAt || null,
    labels: source.labels || [],
    scopeLines: source.scopeLines || [],
    assignedUserIds: (source.assignedUserIds || []).map(String),
    companyId: source.companyId ? String(source.companyId) : "",
    importSource: source.importSource || null,
    updatedBy: source.updatedBy || "",
  }
  if (can(user, "internal.pricing")) {
    visible.houseBoughtPrice = source.houseBoughtPrice ?? null
    visible.assignmentFee = assignmentFee(source)
  }
  return visible
}
