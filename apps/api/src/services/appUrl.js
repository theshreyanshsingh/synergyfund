function isLocal(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(hostname)
}

// The address people open SynergiFund at, for links in emails. APP_URL when set; otherwise from WEB_ORIGIN, which can
// list several addresses separated by commas (each is allowed to connect): the first public one, so a link never
// points at localhost or at the whole list run together.
export function appOrigin() {
  const parse = (value) => {
    try {
      const url = new URL(String(value || "").trim())
      return /^https?:$/.test(url.protocol) && url.hostname ? url : null
    } catch {
      return null
    }
  }
  const chosen = parse(process.env.APP_URL)
  if (chosen) return chosen.origin
  const listed = String(process.env.WEB_ORIGIN || "").split(",").map(parse).filter(Boolean)
  const pick = listed.find((url) => !isLocal(url.hostname)) || listed[0]
  return pick ? pick.origin : "http://localhost:3000"
}
