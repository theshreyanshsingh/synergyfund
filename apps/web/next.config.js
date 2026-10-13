/** @type {import('next').NextConfig} */
const API_URL = (process.env.API_URL || "http://127.0.0.1:4000").replace(/\/+$/, "")

const nextConfig = {
  transpilePackages: ["@synergifund/shared"],
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
