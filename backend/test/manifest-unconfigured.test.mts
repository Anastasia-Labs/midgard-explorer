import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { createApp } from "../src/server/server.js";
import { reachable as isReachable } from "./helpers/reachable.mjs";

/**
 * An explorer with no deployment manifest configured.
 *
 * ADR 0003 lets a development instance serve L2 reads without one, and
 * `pnpm dev` starts in that state. The routes that describe the manifest threw
 * from `loadManifest` and answered 500, and search threw for every query
 * because one of its lookups matches manifest validators. They now say the
 * manifest is not configured, and search answers everything else.
 */

type Mutable = { MIDGARD_MANIFEST_PATH: string | undefined };
const mutable = config as unknown as Mutable;
const saved = mutable.MIDGARD_MANIFEST_PATH;

let server: Server;
let base: string;
let reachable = false;

beforeAll(async () => {
  mutable.MIDGARD_MANIFEST_PATH = undefined;
  server = await new Promise<Server>((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  reachable = await isReachable("node", "search without a manifest");
});

afterAll(async () => {
  mutable.MIDGARD_MANIFEST_PATH = saved;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const SCRIPT_HASH = "ab".repeat(28);

describe("routes that need the manifest, with none configured", () => {
  for (const path of ["/api/l1/validators", `/api/l1/validator?scriptHash=${SCRIPT_HASH}`]) {
    it(`${path.split("?")[0]} says the manifest is not configured`, async () => {
      const res = await fetch(base + path);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = (await res.json()) as { unavailable?: string; error?: string };
      expect(body.unavailable).toBe("manifest_not_configured");
      expect(body.error).toMatch(/manifest/i);
    });
  }
});

describe("search with no manifest configured", () => {
  it("answers the lookups that do not need it and names the one it skipped", async () => {
    if (!reachable) return void console.warn("skipped: no database reachable");
    const res = await fetch(`${base}/api/search?q=000000`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: unknown[]; unsearched?: string[] };
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.unsearched).toEqual(["validator"]);
  });
});
