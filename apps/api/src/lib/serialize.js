import { assignmentFee, can, permissionsFor } from "@synergifund/shared"

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
  }
}

export function presentProperty(property, user) {
  const source = property.toObject ? property.toObject() : property
  const visible = {
    id: String(source._id),
    address: source.address,
    city: source.city || "",
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
    marketRent: source.marketRent ?? null,
    actualRent: source.actualRent ?? null,
    rentStatus: source.rentStatus || "",
    rentMarket: source.rentMarket || "",
    rentNotes: source.rentNotes || "",
    rehabBudget: source.rehabBudget ?? null,
    rehabRemaining: source.rehabRemaining ?? null,
    scopeLines: source.scopeLines || [],
    assignedUserIds: (source.assignedUserIds || []).map(String),
    importSource: source.importSource || null,
    updatedBy: source.updatedBy || "",
  }
  if (can(user, "internal.pricing")) {
    visible.houseBoughtPrice = source.houseBoughtPrice ?? null
    visible.assignmentFee = assignmentFee(source)
  }
  return visible
}
