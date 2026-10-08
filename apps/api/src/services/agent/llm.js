const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
const MAX_ATTEMPTS = 4
const TIMEOUT_MS = 120000

export function modelKey() {
  return String(process.env.OPENROUTER_API_KEY || process.env.MODEL_API_KEY || "").trim()
}

export function createUsageTracker() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 }
}

function trackUsage(tracker, usage) {
  if (!tracker || !usage) return
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
  tracker.promptTokens += prompt
  tracker.completionTokens += completion
  tracker.totalTokens += Number(usage.total_tokens ?? prompt + completion) || 0
  tracker.calls += 1
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function chat({ model, messages, tools, toolChoice, temperature = 0.2, maxTokens = 4000, tracker }) {
  const key = modelKey()
  if (!key) throw new Error("The agent is not connected to a model yet. Add OPENROUTER_API_KEY to the server .env file.")
  const body = { model, messages, temperature, max_tokens: maxTokens }
  if (tools?.length) {
    body.tools = tools
    if (toolChoice) body.tool_choice = toolChoice
  }
  let lastError = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch(`${(process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.WEB_ORIGIN || "http://localhost:3000",
          "X-Title": "SynergiFund",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.error) {
        const message = data.error?.message || `The model service answered ${response.status}.`
        const retryable = response.status === 429 || response.status >= 500
        lastError = new Error(message)
        lastError.fatal = !retryable
        if (!retryable || attempt === MAX_ATTEMPTS) throw lastError
      } else {
        trackUsage(tracker, data.usage)
        const message = data.choices?.[0]?.message || {}
        return {
          content: typeof message.content === "string" ? message.content : "",
          toolCalls: (message.tool_calls || []).map((call, index) => ({
            id: call.id || `call_${index}_${Date.now()}`,
            name: call.function?.name || "",
            arguments: call.function?.arguments || "{}",
          })),
        }
      }
    } catch (error) {
      lastError = error.name === "AbortError" ? new Error("The model took too long to answer.") : error
      if (lastError.fatal || attempt === MAX_ATTEMPTS) throw lastError
    } finally {
      clearTimeout(timer)
    }
    await wait(500 * 2 ** (attempt - 1))
  }
  throw lastError || new Error("The model did not answer.")
}
