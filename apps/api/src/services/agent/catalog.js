// OpenRouter's list of models (their ids, prices and what they can do), kept for an hour: Settings lists them, and a
// call whose answer came without a cost is priced from it (llm.js).

const CATALOG_TTL_MS = 60 * 60 * 1000
let catalog = { at: 0, models: null }

export async function openRouterModels() {
  if (catalog.models && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.models
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`${(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/models`, { signal: controller.signal })
    const data = await response.json()
    if (!response.ok || !Array.isArray(data.data)) return null
    catalog = { at: Date.now(), models: new Map(data.data.map((model) => [model.id, model])) }
    return catalog.models
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// The list as last fetched, without waiting: an old one is fetched again in the background, and before the first
// fetch there is none (null). An answer never waits for the list.
let refreshing = null

export function modelsNow() {
  if (!catalog.models || Date.now() - catalog.at >= CATALOG_TTL_MS) refreshing ||= openRouterModels().finally(() => { refreshing = null })
  return catalog.models
}

// Whether OpenRouter lists `parameter` (such as "reasoning") among the settings `model` takes; false while that is
// not known, so a setting is only sent to a model known to take it.
export function modelTakes(model, parameter) {
  return Boolean(modelsNow()?.get(model)?.supported_parameters?.includes(parameter))
}

// The short names OpenRouter takes for a model's providers (in a request's `provider.order`), by the name an answer
// reports ("Io Net" → "io-net"). Fetched in the background (providerSlugs) and kept for an hour.
const providerNames = new Map()

export function providerSlugs(model) {
  const known = providerNames.get(model)
  if (!model || (known && (known.loading || Date.now() - known.at < CATALOG_TTL_MS))) return
  const next = { at: Date.now(), names: known?.names || new Map(), loading: true }
  providerNames.set(model, next)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  fetch(`${(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/models/${model}/endpoints`, { signal: controller.signal })
    .then((response) => response.json())
    .then((data) => {
      const names = new Map()
      for (const endpoint of data?.data?.endpoints || []) {
        const slug = String(endpoint.tag || "").split("/")[0]
        if (endpoint.provider_name && slug) names.set(endpoint.provider_name, slug)
      }
      next.names = names
    })
    // (Not known: requests go wherever OpenRouter sends them, and it is asked again in an hour.)
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer)
      next.loading = false
    })
}

export function providerSlug(model, name) {
  providerSlugs(model)
  return (name && providerNames.get(model)?.names.get(name)) || null
}

// What a call to `model` cost by its listed price (US dollars), or null when the model or its price is not listed.
export async function listedCost(model, { promptTokens = 0, completionTokens = 0, cachedTokens = 0 } = {}) {
  const pricing = (await openRouterModels())?.get(model)?.pricing
  const rate = (value) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
  }
  const prompt = rate(pricing?.prompt)
  const completion = rate(pricing?.completion)
  if (prompt == null || completion == null) return null
  const cached = Math.min(cachedTokens, promptTokens)
  const cacheRead = rate(pricing.input_cache_read) ?? prompt
  return (promptTokens - cached) * prompt + cached * cacheRead + completionTokens * completion + (rate(pricing.request) || 0)
}
