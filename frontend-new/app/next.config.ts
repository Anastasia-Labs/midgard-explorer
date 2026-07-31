import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.join(import.meta.dirname, "..");

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@midgard-explorer/contracts", "@midgard-explorer/ui"],
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
