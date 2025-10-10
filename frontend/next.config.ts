// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // turn this off only if you really need to during dev
  reactStrictMode: false,

  // these are fine to keep if you use them
  assetPrefix: "",
  trailingSlash: false,

  // (optional) only if you keep a monorepo or share code ABOVE this folder:
  // experimental: { outputFileTracingRoot: require("path").join(__dirname, "..") },
};

export default nextConfig;
