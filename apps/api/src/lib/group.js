// Records grouped by the property they belong to, in one pass. Filtering the whole list again for every property
// (and turning each id into text each time) took seconds once a portfolio reached a few hundred houses.
export function groupByProperty(items) {
  const groups = new Map()
  for (const item of items) {
    const key = String(item.propertyId || "")
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}

export const sumAmounts = (items = []) => items.reduce((total, item) => total + (Number(item.amount) || 0), 0)
