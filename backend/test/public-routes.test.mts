import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeBlockNotArchived,
  decodeBlockResponse,
  decodeBlocksPage,
  decodeDeploymentContext,
  decodeRecentBlocks,
  decodeRecentTxs,
  decodeTransactionResponse,
  decodeTxsPage,
} from "../contracts/index.js";
import { config } from "../src/config.js";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { ArchiveWriter } from "../src/archive/publish.js";
import { readHead } from "../src/archive/reader.js";
import { loadManifest } from "../src/db/manifest.js";
import { PUBLIC_ROUTES } from "../src/public/catalogue.js";
import { PUBLIC_RESPONSE_MAX_BYTES, sendBounded } from "../src/public/routes.js";
import { ENDPOINTS } from "../src/server/catalogue.js";
import { createApp } from "../src/server/server.js";
import { fixturePayloadSource, type FixtureBlock } from "../ingest/fixtureSource.js";
import { runIngest } from "../ingest/run.js";

/**
 * The public source, served in process from an archive the real ingester
 * built, with a stand-in node whose answers each case sets. No database is
 * configured or reachable: every route here reads the archive or the node.
 */

const fixtures = new URL("./fixtures/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, fixtures), "utf8"));
type TxBlock = FixtureBlock & { txIds: string[] };
const txs = read("da-payloads-transactions.json") as {
  chain: TxBlock[];
  fork: TxBlock;
  sharedTxId: string;
  paged: TxBlock;
  empty: [FixtureBlock, FixtureBlock];
};
const [b1, b2, b3] = txs.chain as [TxBlock, TxBlock, TxBlock];
const { paged } = txs;
/** Two empty blocks: e3 is archived one block deep, so its parent e2 awaits. */
const [e2, e3] = txs.empty;
const NEVER_SERVED = "ab".repeat(28);
const GENESIS = "00".repeat(28);

/** The node stand-in: each case says how it answers. */
let mode: "up" | "down" | "429" | "503" = "up";
const node: Server = createServer((req, res) => {
  if (mode === "down") return req.socket.destroy();
  if (mode === "429") return res.writeHead(429, { "retry-after": "7" }).end("{}");
  if (mode === "503") return res.writeHead(503, { "retry-after": "5" }).end("{}");
  if (req.url === "/protocol-info") return res.end(JSON.stringify({ deploymentMarker: { manifestId: FP } }));
  if (req.url?.startsWith("/tx-status")) {
    const id = new URL(req.url, "http://x").searchParams.get("tx_hash")!;
    if (id.startsWith("00")) return res.writeHead(404).end(JSON.stringify({ error: "not found" }));
    return res.end(JSON.stringify({ txId: id, status: "queued" }));
  }
  res.writeHead(404).end();
});

let FP = "";
let root = "";
/** The record moved into a detail object, as the ingester stores a record
 * too large for a page. */
let movedKey = "";
let api: Server;
let base = "";
const saved = { ...config };
const mutable = config as unknown as Record<string, unknown>;

const get = async (path: string) => {
  const res = await fetch(base + path);
  const text = await res.text();
  expect(Buffer.byteLength(text), `${path} stays within the response limit`).toBeLessThanOrEqual(PUBLIC_RESPONSE_MAX_BYTES);
  return { status: res.status, headers: res.headers, body: JSON.parse(text) };
};

const ingest = (store: FsArchiveStore, extra: Record<string, unknown>) =>
  runIngest({
    store,
    fingerprint: FP,
    headerHashes: [],
    genesisHeaderHash: GENESIS,
    limits: { maxPayloadBytes: 64 * 1024 * 1024 },
    retries: 0,
    owner: "test",
    leaseMs: 60_000,
    sources: [fixturePayloadSource([...txs.chain, txs.fork, paged, ...txs.empty], "test")],
    ...extra,
  });

/** Publishes the current generation again with recorded outcomes, as a
 * labeled fixture: no source in this milestone records one. */
const recordOutcomes = async (store: FsArchiveStore, outcomes: Record<string, unknown>) => {
  const head = (await readHead(store, FP))!.generation;
  const writer = new ArchiveWriter({ store, fingerprint: FP, owner: "outcomes", leaseMs: 60_000 });
  await writer.acquire();
  await writer.publish({ objects: {}, carried: head.references, seeds: head.seeds, outcomes, coverage: head.coverage, index: head.index });
  await writer.release();
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "public-"));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, gunzipSync(readFileSync(new URL("manifest-v1-f4cf28ca1-preprod-testing.json.gz", fixtures))));
  FP = loadManifest(manifestPath).deploymentId;
  root = join(dir, "archive");
  const store = new FsArchiveStore(root);
  await ingest(store, {
    headerHashes: [NEVER_SERVED],
    seeds: [
      { headerHash: paged.headerHash, source: "fixture" },
      { headerHash: txs.fork.headerHash, source: "fixture" },
    ],
  });
  // A second run, one block deep: e3 archived, its parent e2 awaiting.
  await ingest(store, { seeds: [{ headerHash: e3.headerHash, source: "fixture" }], maxBlocks: 1 });
  await recordOutcomes(store, {
    [b1.headerHash]: { outcome: "merged", evidence: "ancestry", anchor: b3.headerHash, view: "fixture-view@slot-100", observation: { source: "operator:fixture-operator", chainPoint: "slot-100", at: "2026-10-20T09:00:00.000Z" } },
    [e3.headerHash]: { outcome: "removed", evidence: "queue_terminal", anchor: null, view: null, observation: { source: "fixture:outcomes", chainPoint: "slot-90", at: "2026-10-20T09:00:00.000Z" } },
  });

  // Rewrite one archived page so its first record sits in a detail object.
  const blocks = join(root, FP, "blocks");
  const blockDir = readdirSync(blocks).find((d) => d.startsWith(`${b2.headerHash}-`) && !d.endsWith(".json"))!;
  const pagePath = join(blocks, blockDir, "transactions", "0.json");
  const page = JSON.parse(readFileSync(pagePath, "utf8"));
  const [moved] = page.records;
  const detailKey = `${FP}/blocks/${blockDir}/detail/transactions-${moved.index}.json`;
  mkdirSync(join(blocks, blockDir, "detail"), { recursive: true });
  writeFileSync(join(root, detailKey), JSON.stringify({ kind: "transactions", index: moved.index, key: moved.key, value: moved.value }));
  page.records[0] = { index: moved.index, key: moved.key, valueBytes: moved.valueBytes, detailKey };
  writeFileSync(pagePath, JSON.stringify(page));
  movedKey = moved.key;

  await new Promise<void>((resolve) => node.listen(0, "127.0.0.1", () => resolve()));
  Object.assign(mutable, {
    L2_SOURCE: "public",
    ARCHIVE_DIR: root,
    MIDGARD_NODE_URL: `http://127.0.0.1:${(node.address() as AddressInfo).port}`,
    MIDGARD_MANIFEST_PATH: manifestPath,
    POSTGRES_URL: undefined,
  });
  api = await new Promise<Server>((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  Object.assign(mutable, saved);
  await new Promise<void>((resolve) => api.close(() => resolve()));
  await new Promise<void>((resolve) => node.close(() => resolve()));
});

describe("the route-by-source table", () => {
  it("decides every catalogue route, and names no route the catalogue lacks", () => {
    expect(Object.keys(PUBLIC_ROUTES).sort()).toEqual(ENDPOINTS.map((e) => e.path).sort());
  });
});

describe("block lists", () => {
  it("list archived blocks with no heights and no invented status, in the contract", async () => {
    const page = decodeBlocksPage((await get("/api/blocks/1")).body);
    expect(page.total).toBe(6);
    expect(page.rows.every((r) => r.height === null && r.finalization_status === "not_observed")).toBe(true);
    expect(page.rows.find((r) => r.header_hash === b3.headerHash)?.materialized_l2_transaction_count).toBe(3);
    expect(decodeRecentBlocks((await get("/api/blocks/recent")).body).rows.length).toBe(6);
    expect((await get("/api/blocks/total")).body).toEqual({ total: 6 });
  });
});

describe("one archived block", () => {
  it("is served from the archive: verified header, decoded transactions, nine evidence lines", async () => {
    const { status, body } = await get(`/api/block?header_hash=${b3.headerHash}`);
    expect(status).toBe(200);
    const block = decodeBlockResponse(body);
    expect(block.header.height).toBeNull();
    expect(block.rows.map((r) => r.tx_id).sort()).toEqual([...b3.txIds].sort());
    expect(block.rows.every((r) => r.transaction !== null && r.decodeError === null)).toBe(true);
    expect(block.neighbours.prev?.header_hash).toBe(b2.headerHash);
    expect(block.neighbours.next?.header_hash).toBe(paged.headerHash);
    expect(block.archive).toEqual({ state: "archived", at: null, reason: null });
    expect(block.transactionsPage).toEqual({ page: 1, pages: 1, records: 3 });
    expect(block.evidence).toMatchObject({
      payloadIntegrity: { state: "pass" },
      headerBinding: { state: "pass" },
      roots: { state: "not_run", reason: "no_authenticated_l1_header_observation" },
      l1Observation: { state: "unknown", reason: "no_queue_observation" },
      daStatus: { state: "unknown", reason: "no_queue_observation" },
      maturity: { state: "unknown", reason: "no_queue_observation" },
      localApplication: { state: "unknown", reason: "not_read_by_public_source" },
      merge: { state: "unknown", reason: "no_queue_observation" },
      withdrawalPayment: { state: "not_applicable" },
    });
    expect((await get(`/api/block?header_hash=${b3.headerHash}&page=2`)).status).toBe(404);
  });

  it("serves a block's transactions one archive page at a time, and says how many pages", async () => {
    const first = decodeBlockResponse((await get(`/api/block?header_hash=${paged.headerHash}`)).body);
    expect(first.transactionsPage).toEqual({ page: 1, pages: 2, records: 60 });
    expect(first.rows).toHaveLength(50);
    const second = decodeBlockResponse((await get(`/api/block?header_hash=${paged.headerHash}&page=2`)).body);
    expect(second.rows).toHaveLength(10);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.tx_id)).size).toBe(60);
    expect((await get(`/api/block?header_hash=${paged.headerHash}&page=3`)).status).toBe(404);
  });

  it("names no single next block at a branch point", async () => {
    const genesisChild = decodeBlockResponse((await get(`/api/block?header_hash=${b1.headerHash}`)).body);
    expect(genesisChild.neighbours.next?.header_hash).toBe(b2.headerHash);
  });
});

describe("a header the archive does not hold", () => {
  it("answers 404 with its archive state: failed with its reason, awaiting, or plain unknown", async () => {
    const failed = await get(`/api/block?header_hash=${NEVER_SERVED}`);
    expect(failed.status).toBe(404);
    expect(decodeBlockNotArchived(failed.body).archive).toMatchObject({ state: "failed", reason: "unavailable" });
    const awaiting = await get(`/api/block?header_hash=${e2.headerHash}`);
    expect(decodeBlockNotArchived(awaiting.body).archive.state).toBe("awaiting");
    const unknown = await get(`/api/block?header_hash=${"ef".repeat(28)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.archive).toBeUndefined();
  });
});

describe("transactions", () => {
  it("serve an archived transaction with the node down, naming every block that carries it", async () => {
    mode = "down";
    try {
      const { status, body } = await get(`/api/transaction?tx_hash=${txs.sharedTxId}`);
      expect(status).toBe(200);
      const tx = decodeTransactionResponse(body);
      expect(tx.status).toBe("committed");
      expect(tx.transaction).not.toBeNull();
      expect([...(tx.archive?.blocks ?? [])].sort()).toEqual([b1.headerHash, txs.fork.headerHash].sort());
      expect((await get("/api/blocks/1")).status).toBe(200);
      expect((await get("/readyz")).status).toBe(503);
    } finally {
      mode = "up";
    }
  });

  it("list in the contract, decoded from their archived records", async () => {
    const page = decodeTxsPage((await get("/api/transactions/1")).body);
    expect(page.total).toBe(
      b1.txIds.length + b2.txIds.length + b3.txIds.length + txs.fork.txIds.length + paged.txIds.length,
    );
    // Every page, in the contract; only the record moved to a detail object
    // is listed without its body.
    const rows = [...page.rows];
    for (let n = 2, more = page.hasNextPage; more; n += 1) {
      const next = decodeTxsPage((await get(`/api/transactions/${n}`)).body);
      rows.push(...next.rows);
      more = next.hasNextPage;
    }
    expect(rows).toHaveLength(page.total);
    expect(rows.filter((r) => r.transaction === null).map((r) => r.tx_id)).toEqual([movedKey]);
    expect(decodeRecentTxs((await get("/api/transactions/recent")).body).rows.length).toBeGreaterThan(0);
  });

  it("not archived come from the node, whose limits arrive as typed errors with its Retry-After", async () => {
    const queued = await get(`/api/transaction?tx_hash=${"11".repeat(32)}`);
    expect(decodeTransactionResponse(queued.body).status).toBe("queued");
    expect((await get(`/api/transaction?tx_hash=${"00".repeat(32)}`)).status).toBe(404);
    const cases: Array<[typeof mode, string, string | null]> = [
      ["429", "rate_limited", "7"],
      ["503", "busy", "5"],
      ["down", "unavailable", null],
    ];
    for (const [m, reason, retryAfter] of cases) {
      mode = m;
      const res = await get(`/api/transaction?tx_hash=${`2${m.length}`.padEnd(64, "3")}`);
      mode = "up";
      expect(res.status, m).toBe(503);
      expect(res.body.upstream, m).toBe(reason);
      expect(res.headers.get("retry-after"), m).toBe(retryAfter);
    }
  });
});

describe("the source and its limits", () => {
  it("names a fixture-fed archive as a fixture, with no measured lag", async () => {
    const source = decodeDeploymentContext((await get("/api/source")).body);
    expect(source).toMatchObject({ deploymentId: FP, sourceKind: "fixture", freshness: { state: "synthetic", lagSeconds: null } });
  });

  it("is ready with the node up for the same deployment", async () => {
    // Readiness reuses an answer for one second, so a node-down answer from
    // an earlier case can still be current: poll past it.
    let ready = await get("/readyz");
    for (let i = 0; i < 30 && ready.status !== 200; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      ready = await get("/readyz");
    }
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
  });

  it("refuses what it cannot serve, with the reason, never an empty answer", async () => {
    for (const path of ["/api/address?address=addr_test1x", "/api/blocks/by-height/1", "/api/metrics", "/api/deposits/1"]) {
      const res = await get(path);
      expect(res.status, path).toBe(501);
      expect(res.body.unavailable, path).toBe("unsupported_by_source");
    }
  });

  it("sends a response over the limit smaller, or refuses it, never cut", () => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const fake = () => {
      const res = { statusCode: 200, status(code: number) { res.statusCode = code; return res; }, set() { return res; }, json(body: unknown) { sent.push({ status: res.statusCode, body }); return res; } };
      return res as unknown as Parameters<typeof sendBounded>[0];
    };
    const big = { blob: "x".repeat(PUBLIC_RESPONSE_MAX_BYTES + 1) };
    sendBounded(fake(), big, () => ({ blob: "small" }));
    sendBounded(fake(), big);
    expect(sent[0]).toEqual({ status: 200, body: { blob: "small" } });
    expect(sent[1]).toMatchObject({ status: 503, body: { unavailable: "response_too_large" } });
  });

  it("keeps a record in its own detail object off the block page, and opens it on the transaction's", async () => {
    const block = decodeBlockResponse((await get(`/api/block?header_hash=${b2.headerHash}`)).body);
    expect(block.rows.find((r) => r.tx_id === movedKey)).toMatchObject({ transaction: null, decodeError: "in_detail_object" });
    const tx = decodeTransactionResponse((await get(`/api/transaction?tx_hash=${movedKey}`)).body);
    expect(tx.transaction).not.toBeNull();
  });
});

describe("recorded outcomes, from labeled fixtures", () => {
  it("only a recorded outcome reads removed; a branch with none stays unknown", async () => {
    const removed = decodeBlockResponse((await get(`/api/block?header_hash=${e3.headerHash}`)).body);
    expect(removed.outcome?.outcome).toBe("removed");
    expect(removed.evidence?.merge).toMatchObject({ state: "recorded", value: "removed" });
    const branch = decodeBlockResponse((await get(`/api/block?header_hash=${txs.fork.headerHash}`)).body);
    expect(branch.outcome).toBeNull();
    expect(branch.evidence?.merge).toMatchObject({ state: "unknown", reason: "no_queue_observation" });
  });

  it("merged by ancestry keeps its anchor and view, and has no merge transaction or depth", async () => {
    const merged = decodeBlockResponse((await get(`/api/block?header_hash=${b1.headerHash}`)).body);
    expect(merged.outcome).toMatchObject({ outcome: "merged", evidence: "ancestry", anchor: b3.headerHash, view: "fixture-view@slot-100" });
    expect(Object.keys(merged.outcome!)).not.toContain("mergeTxHash");
    expect(Object.keys(merged.outcome!)).not.toContain("depth");
  });

  it("labels an operator's observation as its provenance", async () => {
    const merged = decodeBlockResponse((await get(`/api/block?header_hash=${b1.headerHash}`)).body);
    expect(merged.evidence?.merge.observation?.source).toBe("operator:fixture-operator");
  });
});
