import { NextResponse } from "next/server"

// A visit Cloudflare took over plain http goes to the same address over https, with the same path and query.
//
// Cloudflare says which scheme the visitor used in its CF-Visitor header ({"scheme":"http"}). X-Forwarded-Proto isn't
// used: nginx between Cloudflare and the site can set it to http on every request, which would redirect forever. The
// matcher below runs this only for those visits, so ordinary https traffic (and its uploads, whose bodies Next cuts
// off when they pass through middleware) never comes here.
export function middleware(request) {
  const target = httpsAddress(request.headers.get("x-forwarded-host") || request.headers.get("host"), request.nextUrl)
  return target ? NextResponse.redirect(target, 308) : NextResponse.next()
}

// The https address for a request to `host`, or null when the host isn't a public name (nginx may pass on its own
// address instead of the visitor's, and a redirect there would lead nowhere).
export function httpsAddress(host, url) {
  const name = String(host || "").trim().toLowerCase()
  const bare = name.replace(/:\d+$/, "")
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) || /^\d+(\.\d+){3}$/.test(bare) || bare.endsWith(".localhost")) return null
  return `https://${bare}${url.pathname}${url.search}`
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon\\.ico).*)",
      has: [{ type: "header", key: "cf-visitor", value: '.*"scheme"\\s*:\\s*"http".*' }],
    },
  ],
}
