export function orderProperties(list) {
  return [...list].sort((a, b) => {
    const left = Number.isFinite(a.position) ? a.position : Number.POSITIVE_INFINITY
    const right = Number.isFinite(b.position) ? b.position : Number.POSITIVE_INFINITY
    if (left !== right) return left - right
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a._id).localeCompare(String(b._id))
  })
}
