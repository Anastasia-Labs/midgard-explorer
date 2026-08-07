import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { indexerPrisma } from "../src/indexer/db.js";
import { parseTxInfo } from "../src/indexer/koios.js";
import { loadManifest } from "../src/indexer/manifest.js";
import { ingestTxInfos, deleteFromBlockHeight } from "../src/indexer/ingest.js";

/**
 * Ingest must be idempotent. The sync loop re-scans recent blocks on every
 * poll to catch reorgs, so the same transaction is written many times over its
 * life. If that duplicated rows, every count the explorer reports would drift
 * upward on a timer.
 */

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

beforeAll(async () => {
  try {
    await probe();
    reachable = true;
    await deleteFromBlockHeight(0);
  } catch (err) {
    console.warn(`Skipping: indexer Postgres unreachable. ${String(err)}`);
  }
});

afterAll(async () => {
  if (reachable) {
    await deleteFromBlockHeight(0);
    await indexerPrisma.$disconnect();
  }
});

describe("ingestTxInfos", () => {
  it("writes a transaction with its events", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const r = await ingestTxInfos(infos, validators);
    expect(r.txs).toBe(1);
    expect(r.events).toBeGreaterThanOrEqual(1);
  });

  it("writes a block header from the state queue datum", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await ingestTxInfos(infos, validators);
    expect(await indexerPrisma.l1BlockHeader.count()).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent across repeated ingests", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await deleteFromBlockHeight(0);
    await ingestTxInfos(infos, validators);
    const afterFirst = {
      txs: await indexerPrisma.l1Tx.count(),
      events: await indexerPrisma.l1Event.count(),
      headers: await indexerPrisma.l1BlockHeader.count(),
    };
    // Without these, the test passes when ingest writes NOTHING on both runs,
    // since 0 === 0. It would then prove idempotence and silence are the same
    // thing, which is the failure it exists to catch.
    expect(afterFirst.txs).toBeGreaterThan(0);
    expect(afterFirst.events).toBeGreaterThan(0);
    expect(afterFirst.headers).toBeGreaterThan(0);
    await ingestTxInfos(infos, validators);
    await ingestTxInfos(infos, validators);
    expect({
      txs: await indexerPrisma.l1Tx.count(),
      events: await indexerPrisma.l1Event.count(),
      headers: await indexerPrisma.l1BlockHeader.count(),
    }).toEqual(afterFirst);
  });

  it("never records an event for a stub validator address", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await ingestTxInfos(infos, validators);
    const families = validators.map((v) => v.family);
    const rows = await indexerPrisma.l1Event.findMany();
    for (const row of rows) expect(families).toContain(row.validator);
  });

  /**
    * A commit transaction re-outputs the previous queue node beside the new
    * one, so both decode to headers. Only the head may claim the transaction:
    * the carried-forward one was committed earlier, by a transaction this
    * ingest is not looking at.
    */
  it("attributes the transaction to the head header only", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await deleteFromBlockHeight(0);
    await ingestTxInfos(infos, validators);

    const headers = await indexerPrisma.l1BlockHeader.findMany();
    expect(headers.length).toBe(2);

    const head = headers.find((h) => h.l1TxHash !== null);
    const carried = headers.find((h) => h.l1TxHash === null);
    expect(head).toBeDefined();
    expect(carried).toBeDefined();

    // The carried-forward header is the older block, and the head links to it.
    expect(head!.prevUtxosRoot).toBe(carried!.utxosRoot);
    expect(head!.endTime).toBeGreaterThan(carried!.endTime);
    expect(head!.blockHeight).not.toBeNull();
    expect(carried!.blockHeight).toBeNull();
  });

  it("does not overwrite attribution when a header is seen again", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await deleteFromBlockHeight(0);
    await ingestTxInfos(infos, validators);
    const before = await indexerPrisma.l1BlockHeader.findMany({
      orderBy: { headerHash: "asc" },
    });
    await ingestTxInfos(infos, validators);
    const after = await indexerPrisma.l1BlockHeader.findMany({
      orderBy: { headerHash: "asc" },
    });
    expect(after.map((h) => h.l1TxHash)).toEqual(before.map((h) => h.l1TxHash));
  });

  it("removes headers as well as transactions on rollback", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await deleteFromBlockHeight(0);
    await ingestTxInfos(infos, validators);
    expect(await indexerPrisma.l1BlockHeader.count()).toBeGreaterThan(0);
    await deleteFromBlockHeight(infos[0].block_height);
    // The head header sat at this height, so it goes. A carried-forward header
    // has a null blockHeight and is deliberately retained.
    const left = await indexerPrisma.l1BlockHeader.findMany();
    expect(left.every((h) => h.blockHeight === null)).toBe(true);
  });

  it("deletes from a block height for reorg reconciliation", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await ingestTxInfos(infos, validators);
    await deleteFromBlockHeight(infos[0].block_height);
    expect(await indexerPrisma.l1Tx.count()).toBe(0);
    expect(await indexerPrisma.l1Event.count()).toBe(0);
  });
});
