/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@synergifund/shared"],
  async redirects() {
    return [{ source: "/verify", destination: "/tasks", permanent: false }]
  },
}

export default nextConfig
