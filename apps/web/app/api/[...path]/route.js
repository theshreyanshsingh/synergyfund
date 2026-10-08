import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade", "host"])

async function proxy(request, context) {
  const { path = [] } = await context.params
  const target = new URL(`${process.env.API_URL || "http://127.0.0.1:4000"}/${path.map(encodeURIComponent).join("/")}`)
  target.search = new URL(request.url).search
  const headers = new Headers(request.headers)
  for (const name of HOP) headers.delete(name)
  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = Buffer.from(await request.arrayBuffer())
    init.body = body
    headers.delete("transfer-encoding")
    headers.set("content-length", String(body.length))
  }
  try {
    const response = await fetch(target, init)
    const outgoing = new Headers()
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie" && !HOP.has(key.toLowerCase())) outgoing.set(key, value)
    })
    for (const cookie of response.headers.getSetCookie?.() || []) outgoing.append("set-cookie", cookie)
    return new NextResponse(response.body, { status: response.status, headers: outgoing })
  } catch {
    return NextResponse.json({ error: "The API server is not responding. Start it, then sign in again." }, { status: 502 })
  }
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
export const PUT = proxy
export const DELETE = proxy
