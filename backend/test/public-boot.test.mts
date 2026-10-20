import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { loadManifest } from "../src/db/manifest.js";
import { fixturePayloadSource, type FixtureBlock } from "../ingest/fixtureSource.js";
import { runIngest } from "../ingest/run.js";

/**
 * The public source boots in a process given no database setting at all, and
 * serves without opening a connection to anything but the node.
 */

const backend = new URL("..", import.meta.url).pathname;
const fixtures = new URL("./fixtures/", import.meta.url);
const txs = JSON.parse(readFileSync(new URL("da-payloads-transactions.json", fixtures), "utf8")) as { chain: FixtureBlock[] };

let child: ChildProcess;
let node: Server;
let nodePort = 0;
let base = "";
let connections = "";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "public-boot-"));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, gunzipSync(readFileSync(new URL("manifest-v1-f4cf28ca1-preprod-testing.json.gz", fixtures))));
  const fingerprint = loadManifest(manifestPath).deploymentId;
  const archive = join(dir, "archive");
  await runIngest({
    store: new FsArchiveStore(archive),
    fingerprint,
    headerHashes: [],
    seeds: [{ headerHash: txs.chain[2]!.headerHash, source: "fixture" }],
    genesisHeaderHash: "00".repeat(28),
    sources: [fixturePayloadSource(txs.chain, "boot")],
    limits: { maxPayloadBytes: 64 * 1024 * 1024 },
    retries: 0,
    owner: "boot",
    leaseMs: 60_000,
  });

  node = createServer((req, res) => {
    if (req.url === "/protocol-info") return res.end(JSON.stringify({ deploymentMarker: { manifestId: fingerprint } }));
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => node.listen(0, "127.0.0.1", () => resolve()));
  nodePort = (node.address() as AddressInfo).port;
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  connections = join(dir, "connections.txt");
  writeFileSync(connections, "");

  // Only what the public source reads: no POSTGRES_* of any kind.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_OPTIONS: `-r ${join(backend, "test/helpers/recordConnections.cjs")}`,
    RECORD_CONNECTIONS: connections,
    EXPLORER_DOTENV: "off",
    L2_SOURCE: "public",
    ARCHIVE_DIR: archive,
    MIDGARD_NODE_URL: `http://127.0.0.1:${nodePort}`,
    MIDGARD_MANIFEST_PATH: manifestPath,
    BACKEND_PORT: String(port),
    LOG_LOCATION: join(dir, "logs"),
    RECENT_BLOCKS_LIMIT: "10",
    RECENT_TRANSACTIONS_LIMIT: "10",
    TRANSACTIONS_PER_PAGE: "25",
    BLOCKS_PER_PAGE: "25",
  };
  child = spawn(join(backend, "node_modules/.bin/ts-node"), ["--transpile-only", "src/index.ts"], { cwd: backend, env, stdio: "pipe" });
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  for (let i = 0; i < 300; i += 1) {
    if (child.exitCode !== null) throw new Error(`the server exited: ${output}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the server never answered: ${output}`);
}, 60_000);

afterAll(async () => {
  child?.kill("SIGKILL");
  await new Promise<void>((resolve) => node.close(() => resolve()));
});

describe("the public source, booted with no database setting", () => {
  it("serves its operational and archive routes, and dials nothing but the node", async () => {
    for (const path of ["/healthz", "/api/source", "/readyz", "/api/blocks/1", `/api/block?header_hash=${txs.chain[2]!.headerHash}`]) {
      expect((await fetch(base + path)).status, path).toBe(200);
    }
    expect(existsSync(connections)).toBe(true);
    const dialed = readFileSync(connections, "utf8").split("\n").filter(Boolean);
    expect(dialed.length).toBeGreaterThan(0);
    expect(dialed.filter((c) => !c.endsWith(`:${nodePort}`))).toEqual([]);
  });
});
