/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@synergifund/shared"],
  async redirects() {
    return [{ source: "/verify", destination: "/tasks", permanent: false }]
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL || "http://127.0.0.1:4000"}/:path*`,
      },
    ]
  },
}

export default nextConfig
