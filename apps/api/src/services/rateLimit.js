// Counts tries in memory, per key (an email, an address, or both): the API runs as one process (ecosystem.config.cjs),
// so one count is the whole server's. `blocked` says how many minutes are left once `max` tries fell inside `windowMs`.
export function createLimiter({ max, windowMs }) {
  const hits = new Map()

  function recent(key, now) {
    const list = (hits.get(key) || []).filter((at) => now - at < windowMs)
    if (list.length) hits.set(key, list)
    else hits.delete(key)
    return list
  }

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const key of [...hits.keys()]) recent(key, now)
  }, Math.min(windowMs, 10 * 60 * 1000))
  sweep.unref?.()

  return {
    blocked(key, now = Date.now()) {
      const list = recent(key, now)
      return list.length >= max ? Math.max(1, Math.ceil((list[0] + windowMs - now) / 60000)) : 0
    },
    hit(key, now = Date.now()) {
      const list = recent(key, now)
      list.push(now)
      hits.set(key, list)
    },
    clear(key) {
      hits.delete(key)
    },
    // Clears every key `match` picks (for example all of one email's addresses).
    clearWhere(match) {
      for (const key of [...hits.keys()]) if (match(key)) hits.delete(key)
    },
  }
}

// Where a request came from. The site reaches the API through Cloudflare, nginx and the website's own proxy, so the
// connection itself always comes from this server; Cloudflare names the visitor in CF-Connecting-IP.
export function clientAddress(req) {
  const cloudflare = String(req.headers?.["cf-connecting-ip"] || "").trim()
  if (cloudflare) return cloudflare
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim()
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown"
}

export function minutes(count) {
  return `${count} minute${count === 1 ? "" : "s"}`
}
