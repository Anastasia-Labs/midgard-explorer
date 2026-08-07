import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { indexerPrisma } from "../src/indexer/db.js";
import { parseTxInfo } from "../src/indexer/koios.js";
import { loadManifest } from "../src/indexer/manifest.js";
import { ingestTxInfos } from "../src/indexer/ingest.js";
import {
  getL1TransactionsPage,
  getL1Transaction,
  getL1BlockHeaders,
  getL1Summary,
} from "../src/db/l1.js";

const infos = parseTxInfo(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url),
      "utf8",
    ),
  ),
);
const { validators } = loadManifest(
  new URL("./fixtures/manifest-sample.json", import.meta.url).pathname,
);

let reachable = false;

/** Bounded probe. A stopped container on WSL2 black-holes TCP rather than
 * refusing it, so an unguarded query hangs past Vitest's hook timeout and the
 * suite reports FAIL instead of skipping. The race turns that into a clean
 * negative. */
async function probe(): Promise<void> {
  await Promise.race([
    indexerPrisma.$queryRaw`SELECT 1;`,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("probe timed out after 3000ms")), 3000),
    ),
  ]);
}

/** Test cleanup must be total. `deleteFromBlockHeight` is a production
 * reconciliation primitive: by design it never touches rows whose blockHeight
 * is null, which is exactly what carried-forward headers are. Reusing it as
 * test teardown leaves residue that has already produced one false pass. */
async function truncateL1(): Promise<void> {
  await indexerPrisma.l1BlockHeader.deleteMany({});
  await indexerPrisma.l1Event.deleteMany({});
  await indexerPrisma.l1Tx.deleteMany({});
}

beforeAll(async () => {
  try {
    await probe();
    reachable = true;
    await truncateL1();
    await ingestTxInfos(infos, validators);
  } catch (err) {
    console.warn(`Skipping: indexer Postgres unreachable. ${String(err)}`);
  }
});

afterAll(async () => {
  if (reachable) {
    await truncateL1();
    await indexerPrisma.$disconnect();
  }
});

describe("L1 read queries", () => {
  it("pages transactions newest first", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const p = await getL1TransactionsPage(1);
    expect(p.total).toBeGreaterThanOrEqual(1);
    expect(p.rows.length).toBeGreaterThanOrEqual(1);
    expect(p.limit).toBeGreaterThan(0);
  });

  it("returns a single transaction with its events", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const tx = (await getL1Transaction(
      "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92",
    )) as { events: unknown[] } | null;
    expect(tx).not.toBeNull();
    expect(Array.isArray(tx!.events)).toBe(true);
  });

  it("returns null for an unknown transaction", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    expect(await getL1Transaction("f".repeat(64))).toBeNull();
  });

  it("returns block headers", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    expect((await getL1BlockHeaders(10)).length).toBeGreaterThanOrEqual(1);
  });

  it("summarises counts by validator", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const s = await getL1Summary();
    expect(s.transactions).toBeGreaterThanOrEqual(1);
    expect(s.byValidator.length).toBeGreaterThanOrEqual(1);
  });
});

describe("L1 transaction paging across a same-block tie", () => {
  // txTime is populated from the Cardano block, not a per-transaction clock,
  // so every transaction in the same block gets a byte-identical txTime.
  // These five rows share one txTime on purpose: it is the exact condition
  // that requires a deterministic tiebreaker in the orderBy, and it is the
  // only way a page-boundary bug (dropped/duplicated rows, wrong hasNextPage)
  // would actually surface instead of hiding behind incidental row order.
  const tiedTxTime = new Date("2026-01-01T00:00:00.000Z");
  const syntheticHashes = Array.from(
    { length: 5 },
    (_, i) => `${"a".repeat(63)}${i}`,
  );

  beforeAll(async () => {
    if (!reachable) return;
    await truncateL1();
    await indexerPrisma.l1Tx.createMany({
      data: syntheticHashes.map((txHash, i) => ({
        txHash,
        blockHeight: 9000 + i,
        blockHash: `synthetic-block-${i}`,
        slot: 9000 + i,
        epoch: 1,
        txTime: tiedTxTime,
      })),
    });
  });

  afterAll(async () => {
    if (!reachable) return;
    await truncateL1();
  });

  it("keeps pages disjoint and complete when every row ties on txTime", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    const page1 = await getL1TransactionsPage(1, 2);
    const page2 = await getL1TransactionsPage(2, 2);
    const page3 = await getL1TransactionsPage(3, 2);

    expect(page1.total).toBe(5);
    expect(page1.rows.length).toBe(2);
    expect(page1.hasNextPage).toBe(true);
    expect(page2.rows.length).toBe(2);
    expect(page2.hasNextPage).toBe(true);
    expect(page3.rows.length).toBe(1);
    expect(page3.hasNextPage).toBe(false);

    const hashesPerPage = [page1, page2, page3].map((p) =>
      p.rows.map((r) => (r as { txHash: string }).txHash),
    );
    const allHashes = hashesPerPage.flat();

    // Pairwise disjoint and together covering all 5: this is what actually
    // proves the tiebreaker works, not just that each page has the right
    // length. A missing tiebreaker can repeat a tied row across pages or
    // drop one entirely while every length assertion above still passes.
    expect(new Set(allHashes).size).toBe(5);
    expect([...allHashes].sort()).toEqual([...syntheticHashes].sort());
  });
});
