import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The API server never loads the ingester's network stack.
 *
 * Fetching DA payloads over libp2p, and unwrapping them, belongs to
 * `pnpm ingest`. A request handler that imported any of it would put a libp2p
 * node, and a 64 MiB decompression path, inside the process that answers the
 * public API. Everything under `src/` is the request path.
 */
const FORBIDDEN = [
  /["']@al-ft\/midgard-fault-proofs["']/,
  /["']midgard-watcher["']/,
  /["'](@libp2p\/[^"']+|libp2p|@chainsafe\/libp2p-[^"']+)["']/,
  /\bunwrapDaPayload\b/,
  /\bdecodeDaPayload\b/,
  // The ingester itself, which loads all of the above.
  /["'](?:\.\.\/)+ingest\//,
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|mts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });

describe("the request path", () => {
  it("imports no libp2p, fault-proof, payload-decoding or ingester code", () => {
    const root = new URL("../src", import.meta.url).pathname;
    const offenders = sources(root).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${relative(root, file)}: ${pattern.source}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
