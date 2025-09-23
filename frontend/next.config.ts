import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Essential for Replit environment: allow all hosts
  // since the user sees a proxy, not localhost directly
  experimental: {
    allowedHosts: true,
  },
  // Development server configuration for Replit
  devIndicators: {
    buildActivity: false,
  },
  // Disable strict mode for development compatibility
  reactStrictMode: false,
};

export default nextConfig;
