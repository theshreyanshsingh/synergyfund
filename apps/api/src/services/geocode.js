const cache = new Map()
let last = 0
let chain = Promise.resolve()

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function lookup(query) {
  const gap = 1100 - (Date.now() - last)
  if (gap > 0) await wait(gap)
  last = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "SynergiFund/1.0 (property comps map)", "Accept-Language": "en" } })
    if (!response.ok) return null
    const [hit] = await response.json()
    if (!hit) return null
    const lat = Number(hit.lat)
    const lng = Number(hit.lon)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function geocode(address, city = "") {
  const query = [address, city].map((part) => String(part || "").trim()).filter(Boolean).join(", ")
  if (!query) return Promise.resolve(null)
  const key = query.toLowerCase()
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  const result = chain.then(() => lookup(query)).then((value) => {
    cache.set(key, value)
    return value
  })
  chain = result.catch(() => null)
  return result
}
