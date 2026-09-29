import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.join(import.meta.dirname, "..");

const nextConfig: NextConfig = {
  // The documented local URL uses this loopback host, including dev WebSockets.
  allowedDevOrigins: ["127.0.0.1"],
  // The workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@midgard-explorer/contracts", "@midgard-explorer/ui"],
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
  typescript: { ignoreBuildErrors: false },
  /**
   * Routes that used to exist and now answer somewhere else.
   *
   * `/l1/commitments` listed the Midgard block headers the explorer's own chain
   * index had observed on Cardano. The index is decommissioned, and the
   * question it answered — which blocks are committed, and when — is what
   * `/blocks` has always answered from the node's own records, including the
   * settlement transaction for each one. A permanent redirect rather than a
   * removal, because the link is in the wild and a 404 would tell a reader
   * nothing.
   */
  async redirects() {
    return [{ source: "/l1/commitments", destination: "/blocks", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
