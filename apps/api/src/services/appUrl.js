function isLocal(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(hostname)
}

function parse(value) {
  try {
    const url = new URL(String(value || "").trim())
    return /^https?:$/.test(url.protocol) && url.hostname ? url : null
  } catch {
    return null
  }
}

// The company's own domain, from the address app emails are sent from ("noreply@synergifund.com" → synergifund.com).
function ownDomain() {
  const from = String(process.env.RESEND_FROM || "noreply@synergifund.com")
  return (/@([a-z0-9.-]+\.[a-z]{2,})/i.exec(from)?.[1] || "").toLowerCase()
}

function listedOrigins() {
  return String(process.env.WEB_ORIGIN || "").split(",").map(parse).filter(Boolean)
}

// An address SynergiFund may be opened at: one listed in WEB_ORIGIN, any address on the company's own domain
// (admin.synergifund.com), or a local one while developing. Nothing else, so a link can never point at another site.
export function trustedOrigin(value) {
  const url = parse(value)
  if (!url) return ""
  const host = url.hostname.toLowerCase()
  const domain = ownDomain()
  const listed = listedOrigins().some((item) => item.origin === url.origin)
  const own = Boolean(domain) && (host === domain || host.endsWith(`.${domain}`)) && url.protocol === "https:"
  const local = process.env.NODE_ENV !== "production" && isLocal(host)
  return listed || own || local ? url.origin : ""
}

// The address people actually opened SynergiFund at, as the web app reports it with each request. It is trusted over
// WEB_ORIGIN, because a mistyped WEB_ORIGIN (once admin.synergyfund.com, a parked domain) sends every email link to
// the wrong site.
let seen = ""

export function rememberAppOrigin(value) {
  const origin = trustedOrigin(value)
  if (!origin) return
  // A public address is never replaced by a local one (someone running the app on their own computer).
  if (seen && !isLocal(new URL(seen).hostname) && isLocal(new URL(origin).hostname)) return
  seen = origin
}

// The address people open SynergiFund at, for links in emails: APP_URL when set; otherwise the address the app is
// being used at; otherwise the first public address in WEB_ORIGIN (which can list several, separated by commas).
export function appOrigin() {
  const chosen = parse(process.env.APP_URL)
  if (chosen) return chosen.origin
  if (seen) return seen
  const listed = listedOrigins()
  const pick = listed.find((url) => !isLocal(url.hostname)) || listed[0]
  return pick ? pick.origin : "http://localhost:3000"
}
