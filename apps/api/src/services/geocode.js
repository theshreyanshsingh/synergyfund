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

// The US Census address lookup places a house on its own lot (OpenStreetMap often only knows the street).
async function census(query) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query)}&benchmark=Public_AR_Current&format=json`
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const match = (await response.json())?.result?.addressMatches?.[0]?.coordinates
    const lat = Number(match?.y)
    const lng = Number(match?.x)
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
  const result = census(query).then((spot) => spot || chain.then(() => lookup(query))).then((value) => {
    cache.set(key, value)
    return value
  })
  chain = result.catch(() => null)
  return result
}

async function reverse(lat, lng) {
  const gap = 1100 - (Date.now() - last)
  if (gap > 0) await wait(gap)
  last = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&addressdetails=1&lat=${lat}&lon=${lng}`
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "SynergiFund/1.0 (property comps map)", "Accept-Language": "en" } })
    if (!response.ok) return ""
    const data = await response.json()
    return String(data?.address?.postcode || "").slice(0, 5)
  } catch {
    return ""
  } finally {
    clearTimeout(timer)
  }
}

// ZIP codes next to a place: what lies about two miles north, south, east, west and on the diagonals. Only ZIPs
// sharing the first three digits are kept (the map's data has the odd stray), up to `limit`.
export async function nearbyZips(spot, zip, limit = 3) {
  if (!spot) return []
  const found = []
  for (const [dLat, dLng] of [[0.03, 0], [-0.03, 0], [0, 0.035], [0, -0.035], [0.022, 0.026], [-0.022, -0.026], [0.022, -0.026], [-0.022, 0.026]]) {
    const key = `zip:${(spot.lat + dLat).toFixed(3)},${(spot.lng + dLng).toFixed(3)}`
    let value = cache.get(key)
    if (value === undefined) {
      const result = chain.then(() => reverse(spot.lat + dLat, spot.lng + dLng))
      chain = result.catch(() => "")
      value = await result.catch(() => "")
      cache.set(key, value)
    }
    if (/^\d{5}$/.test(value) && value !== zip && value.slice(0, 3) === String(zip).slice(0, 3) && !found.includes(value)) found.push(value)
    if (found.length >= limit) break
  }
  return found
}
