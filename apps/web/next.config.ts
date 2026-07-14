import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to the Argus monorepo root — an unrelated lockfile in the
  // user's home directory would otherwise confuse Turbopack's auto-detection.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
};

export default nextConfig;
