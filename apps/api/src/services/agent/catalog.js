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
