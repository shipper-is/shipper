import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Anchor Turbopack to web/ so it resolves node_modules/next here, not at the
  // repo root (which also has a bun.lock but no Next.js install).
  turbopack: {
    root: webRoot,
  },
};

export default nextConfig;
