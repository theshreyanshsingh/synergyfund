/** @type {import('next').NextConfig} */
const API_URL = (process.env.API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "")

const nextConfig = {
  transpilePackages: ["@synergifund/shared"],
  // A second dev server (a test run) keeps its build in its own folder (NEXT_DIST_DIR=.next-test), so it never serves
  // the other's stale pages. Unset, it is .next as always.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
