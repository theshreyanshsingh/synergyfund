import { randomUUID } from "node:crypto"

const MAX_EVENTS = 2000
const MAX_RUNS = 200
const TTL_AFTER_END_MS = 10 * 60 * 1000
const HEARTBEAT_MS = 15000

const runs = new Map()

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
}

export function createRun({ runId = randomUUID(), ownerId = "" } = {}) {
  if (runs.size >= MAX_RUNS) {
    const oldest = [...runs.values()].sort((left, right) => left.createdAt - right.createdAt)[0]
    if (oldest) removeRun(oldest.runId)
  }
  const run = { runId, ownerId: String(ownerId), events: [], nextSeq: 1, ended: false, endedAt: null, subscribers: new Set(), cleanupTimer: null, createdAt: Date.now() }
  runs.set(runId, run)
  return run
}

export function getRun(runId) {
  return runs.get(runId) || null
}

function appendEvent(runId, data) {
  const run = runs.get(runId)
  if (!run) return 0
  const seq = run.nextSeq++
  run.events.push({ seq, data })
  if (run.events.length > MAX_EVENTS) run.events.shift()
  for (const subscriber of run.subscribers) subscriber({ seq, data })
  return seq
}

function endRun(runId) {
  const run = runs.get(runId)
  if (!run || run.ended) return
  run.ended = true
  run.endedAt = Date.now()
  for (const subscriber of run.subscribers) subscriber({ done: true })
  run.subscribers.clear()
  run.cleanupTimer = setTimeout(() => removeRun(runId), TTL_AFTER_END_MS)
  run.cleanupTimer.unref?.()
}

function removeRun(runId) {
  const run = runs.get(runId)
  if (run?.cleanupTimer) clearTimeout(run.cleanupTimer)
  runs.delete(runId)
}

function hash(text) {
  let value = 0
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) | 0
  return value
}

export function frame(payload) {
  return `___start___${JSON.stringify(payload)}___end___`
}

export class StreamProcessor {
  constructor(res, runId) {
    this.res = res
    this.runId = runId
    this.socketOpen = true
    this.sent = new Set()
    this.heartbeat = null
    res.on("close", () => {
      this.socketOpen = false
      this.stopHeartbeat()
    })
  }

  start() {
    if (!this.res.headersSent) {
      this.res.writeHead(200, { ...SSE_HEADERS, "X-Run-Id": this.runId })
      this.res.flushHeaders?.()
    }
    this.res.socket?.setNoDelay?.(true)
    this.safeWrite("data: stream_start\n\n")
    this.heartbeat = setInterval(() => this.safeWrite(": keepalive\n\n"), HEARTBEAT_MS)
    this.heartbeat.unref?.()
    this.send({ runId: this.runId })
  }

  safeWrite(text) {
    if (!this.socketOpen || this.res.writableEnded) return
    try {
      this.res.write(text)
    } catch {
      this.socketOpen = false
    }
  }

  sendRaw(content) {
    const seq = appendEvent(this.runId, content)
    this.safeWrite(`id: ${seq}\ndata: ${content}\n\n`)
  }

  send(payload) {
    const content = frame(payload)
    const key = hash(content)
    if (this.sent.has(key)) return
    this.sent.add(key)
    this.sendRaw(content)
  }

  sendToolResult(name, result) {
    this.send({ UsedTool: name, result, u_msg: `Executed ${name}` })
  }

  sendError(message) {
    this.send({ error: true, u_msg: `Error: ${message}`, NextNode: "END" })
  }

  stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  end() {
    this.stopHeartbeat()
    this.sendRaw("[DONE]")
    endRun(this.runId)
    if (this.socketOpen && !this.res.writableEnded) this.res.end()
  }
}

export function resumeRun(req, res) {
  const run = getRun(req.params.runId)
  if (!run || run.ownerId !== String(req.user._id)) {
    res.status(410).json({ success: false, error: "run_expired_or_unknown", runId: req.params.runId })
    return
  }
  const lastEventId = Number(req.get("Last-Event-ID") || req.query.lastEventId || 0) || 0
  res.writeHead(200, { ...SSE_HEADERS, "X-Run-Id": run.runId })
  res.flushHeaders?.()
  res.write("data: stream_start\n\n")
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    clearInterval(beat)
    run.subscribers.delete(listener)
    if (!res.writableEnded) res.end()
  }
  const write = (event) => {
    if (closed) return
    res.write(`id: ${event.seq}\ndata: ${event.data}\n\n`)
    if (event.data === "[DONE]") finish()
  }
  const listener = (event) => (event.done ? finish() : write(event))
  const beat = setInterval(() => !closed && res.write(": keepalive\n\n"), HEARTBEAT_MS)
  beat.unref?.()
  req.on("close", finish)
  for (const event of run.events) if (event.seq > lastEventId) write(event)
  if (closed) return
  if (run.ended) {
    if (!run.events.some((event) => event.data === "[DONE]")) res.write("data: [DONE]\n\n")
    finish()
    return
  }
  run.subscribers.add(listener)
}
