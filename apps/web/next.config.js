import fs from "node:fs"

/** @type {import('next').NextConfig} */
const API_URL = (process.env.API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "")

// The build the site runs on a server deployed with deploy.sh: each deploy builds into the folder the site is not
// using (.next-a and .next-b in turn) and names it in .next-live once it is ready, so a failed build never touches the
// site. A build made by hand there (npm run build) goes to the folder in use, as it always did. "" anywhere else.
function liveBuild() {
  try {
    const name = fs.readFileSync(new URL("./.next-live", import.meta.url), "utf8").trim()
    return /^\.next-[a-z]$/.test(name) ? name : ""
  } catch {
    return ""
  }
}

const nextConfig = {
  transpilePackages: ["@synergifund/shared"],
  // A second dev server (a test run) keeps its build in its own folder (NEXT_DIST_DIR=.next-test), so it never serves
  // the other's stale pages. Unset, it is the live build on a deployed server, and .next as always elsewhere.
  distDir: process.env.NEXT_DIST_DIR || liveBuild() || ".next",
  // Live chat and calls connect to this same site; the web server passes them on to the API
  // (long-polling and WebSockets), so no extra port or domain has to be open to the internet.
  async rewrites() {
    return [{ source: "/socket.io", destination: `${API_URL}/socket.io` }]
  },
  async redirects() {
    return [{ source: "/verify", destination: "/tasks", permanent: false }]
  },
}

export default nextConfig
