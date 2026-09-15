import { execFileSync } from "node:child_process";
import { createServer, get as httpGet, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { edgeImage, startEdge } from "../bench/edge.mjs";

/**
 * The edge proxy is where a client's bytes are decided, so the benchmark runs
 * the deployed image with the repository's template in front of the server
 * under test, and these check that proxy rather than a description of it.
 */

describe("edgeImage", () => {
  it("reads the digest the deployed cache service runs", () => {
    const compose = [
      "services:",
      "  other:",
      "    image: postgres:17",
      "  explorer-api-cache:",
      "    # pinned",
      "    image: nginx:1.27-alpine@sha256:" + "a".repeat(64),
      "    container_name: midgard-explorer-api-cache",
    ].join("\n");
    expect(edgeImage(compose)).toBe("nginx:1.27-alpine@sha256:" + "a".repeat(64));
  });

  it("names the image in this repository's compose file", () => {
    expect(edgeImage()).toMatch(/^nginx:[\w.-]+@sha256:[0-9a-f]{64}$/);
  });

  it("refuses a compose file without the service", () => {
    expect(() => edgeImage("services:\n  other:\n    image: x\n")).toThrow(/explorer-api-cache/);
  });
});

const dockerAvailable = (() => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const withDocker = dockerAvailable || process.env.REQUIRE_DB === "1" ? describe : describe.skip;

withDocker("the edge proxy", () => {
  it("compresses JSON for clients that accept it, from one identity cache entry", async () => {
    const body = JSON.stringify({
      rows: Array.from({ length: 80 }, (_, i) => ({ i, hash: "ab".repeat(28) })),
    });
    const encodings: string[] = [];
    const origin: Server = createServer((req, res) => {
      // The readiness probe reads `/healthz`, which is never cached, so only
      // the cached `/api/` location is held to identity requests.
      if (req.url?.startsWith("/api/")) encodings.push(req.headers["accept-encoding"] ?? "");
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("x-accel-expires", "30");
      res.end(req.url === "/api/small" ? "{}" : body);
    });
    await new Promise<void>((resolve) => origin.listen(0, resolve));
    const originPort = (origin.address() as AddressInfo).port;
    const edge = await startEdge(originPort, originPort + 1);
    try {
      // Raw bytes: `fetch` decompresses on the way in, which would hide
      // exactly what this checks.
      const get = (path: string, encoding?: string) =>
        new Promise<{ headers: IncomingHttpHeaders; bytes: Buffer }>((resolve, reject) => {
          httpGet(
            `${edge.base}${path}`,
            { headers: encoding ? { "accept-encoding": encoding } : {} },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk: Buffer) => chunks.push(chunk));
              res.on("end", () => resolve({ headers: res.headers, bytes: Buffer.concat(chunks) }));
            },
          ).on("error", reject);
        });
      const gzipped = await get("/api/big", "gzip");
      expect(gzipped.headers["content-encoding"]).toBe("gzip");
      expect(gzipped.headers.vary).toMatch(/accept-encoding/i);
      expect(gzipped.bytes.byteLength).toBeLessThan(body.length);
      expect(gunzipSync(gzipped.bytes).toString()).toBe(body);

      // A cache hit is still compressed, and a client that offers nothing is
      // served identity bytes from the same entry.
      const hit = await get("/api/big", "gzip");
      expect(hit.headers["x-reverse-proxy-cache"]).toBe("HIT");
      expect(hit.headers["content-encoding"]).toBe("gzip");
      const plain = await get("/api/big");
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.bytes.toString()).toBe(body);

      // Below the threshold the framing would cost more than it saves.
      const small = await get("/api/small", "gzip");
      expect(small.headers["content-encoding"]).toBeUndefined();

      // The origin is always asked for identity bytes, so the cached body is
      // one every client can read.
      expect(encodings.filter((e) => e !== "")).toEqual([]);
    } finally {
      await edge.stop();
      origin.close();
    }
  }, 120_000);
});
