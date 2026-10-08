const START = "___start___"
const END = "___end___"
const MAX_RESUMES = 3

export function appendChunkToSsePayload(chunk, state) {
  state.carry += chunk
  let out = ""
  while (true) {
    const index = state.carry.indexOf("\n\n")
    if (index === -1) break
    const event = state.carry.slice(0, index)
    state.carry = state.carry.slice(index + 2)
    out += readEvent(event, state)
  }
  return out
}

export function flushSseCarry(state) {
  const out = readEvent(state.carry, state)
  state.carry = ""
  return out
}

function readEvent(event, state) {
  let out = ""
  for (const line of event.split("\n")) {
    if (line.startsWith("id:")) {
      const seq = Number(line.slice(3).trim())
      if (Number.isFinite(seq)) state.lastEventId = seq
      continue
    }
    if (!line.startsWith("data:")) continue
    const data = line.slice(5).trim()
    if (data === "[DONE]") {
      state.done = true
      continue
    }
    if (data === "stream_start") continue
    out += data
  }
  return out
}

function drainMarkers(buffer, onPacket) {
  let rest = buffer
  while (true) {
    const start = rest.indexOf(START)
    const end = rest.indexOf(END)
    if (start === -1 || end === -1 || end < start) break
    const text = rest.substring(start + START.length, end).trim()
    rest = rest.substring(end + END.length)
    try {
      onPacket(JSON.parse(text))
    } catch {}
  }
  return rest
}

export function streamPayloadToAssistantParts(parsed) {
  if (parsed.tokenUsage && typeof parsed.tokenUsage === "object" && !parsed.UsedTool) return { userMessage: "", toolResult: undefined, skipMessage: true }
  if (parsed.runId && !parsed.UsedTool && !parsed.u_msg) return { userMessage: "", toolResult: undefined, skipMessage: true }
  const userMessage = (typeof parsed.u_msg === "string" ? parsed.u_msg : "") || (typeof parsed.content === "string" ? parsed.content : "") || ""
  if (!parsed.UsedTool) return { userMessage, toolResult: undefined, skipMessage: !userMessage.trim(), error: Boolean(parsed.error) }
  return {
    userMessage: /^Executed\s/i.test(userMessage) ? "" : userMessage,
    toolResult: { UsedTool: parsed.UsedTool, result: parsed.result },
    skipMessage: false,
  }
}

async function readBody(response, state, onPacket) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += appendChunkToSsePayload(decoder.decode(value, { stream: true }), state)
      buffer = drainMarkers(buffer, onPacket)
    }
  } finally {
    buffer += flushSseCarry(state)
    drainMarkers(buffer, onPacket)
  }
}

async function failure(response) {
  const data = await response.json().catch(() => ({}))
  return new Error(data.error || "The agent could not answer. Try again.")
}

export async function streamAgent({ prompt, threadId }, { onPacket, onChatId }) {
  const response = await fetch("/api/agent/run", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, threadId: threadId || undefined }),
  })
  if (!response.ok || !response.body) throw await failure(response)
  const chatId = response.headers.get("x-chat-id")
  if (chatId) onChatId?.(chatId)
  const runId = response.headers.get("x-run-id")
  const state = { carry: "", lastEventId: 0, done: false }
  try {
    await readBody(response, state, onPacket)
  } catch {}
  for (let attempt = 0; !state.done && runId && attempt < MAX_RESUMES; attempt += 1) {
    const resumed = await fetch(`/api/agent/stream/${encodeURIComponent(runId)}?lastEventId=${state.lastEventId}`, { credentials: "include" }).catch(() => null)
    if (!resumed?.ok || !resumed.body) break
    state.carry = ""
    try {
      await readBody(resumed, state, onPacket)
    } catch {}
  }
  if (!state.done) throw new Error("The connection to the agent dropped. Open the chat again to see the saved answer.")
}
