import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development server configuration for Replit
  devIndicators: {
    buildActivity: false,
  },
  // Disable strict mode for development compatibility
  reactStrictMode: false,
  // Essential for Replit environment
  assetPrefix: '',
  trailingSlash: false,
};

export default nextConfig;
