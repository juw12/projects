import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // CSP, headers, redirects — Phase 1
  experimental: {
    // Phase 1: typedRoutes
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
}
export default config
