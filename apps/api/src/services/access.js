export function propertyFilter(user) {
  if (user.role === "contractor") return { assignedUserIds: user._id }
  return {}
}

export function ownsProperty(user, property) {
  if (user.role !== "contractor") return true
  return (property.assignedUserIds || []).some((id) => String(id) === String(user._id))
}
