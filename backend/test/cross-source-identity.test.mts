import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "../src/db.js";
import { indexerPrisma } from "../src/indexer/db.js";
import { ingestTxInfos } from "../src/indexer/ingest.js";
import { parseTxInfo } from "../src/indexer/koios.js";
import { loadManifest } from "../src/indexer/manifest.js";
import { truncateL1 } from "./helpers/truncate.mjs";
import { canonicalHash } from "../src/utils.js";

/**
 * The node and the index must agree about which block is which.
 *
 * This is the test class the suite was missing. Every existing gate reads ONE
 * source: node queries against the node, indexer tests against the index, and
 * the end-to-end suite against a fixture serving whatever shape the frontend
 * wanted. So the indexer could store a 32-byte `utxosRoot` in the column every
 * route queries as a 28-byte header hash, and nine local gates plus hosted CI
 * stayed green while the block page's Cardano evidence resolved for no block in
 * the deployment.
 *
 * The first version of this file made the same mistake it was written to catch.
 * It guarded every assertion with `if (rows.length === 0) return`, and under
 * vitest the indexer client points at `midgard_explorer_test`, which was empty.
 * Six assertions passed having compared nothing. The guards below fail loudly
 * instead: a run that measured nothing is a failure, not a pass.
 */

const HEADER_HASH = /^[0-9a-f]{56}$/;
const TX_HASH = /^[0-9a-f]{64}$/;

/** The block this fixture's commit transaction committed, and the transaction
 * that committed it. Both are real preprod values the node also holds. */
const COMMITTED_HEADER = "003ab288f3168c80eb09f5843844dc19a506e0177947d2ca22d9ca68";

type NodeSettlement = { header_hash: string; submitted_tx_hash: string };
type IndexHeader = { header_hash: string; l1_tx_hash: string | null };

const infos = parseTxInfo(
  JSON.parse(
    readFileSync(new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url), "utf8"),
  ),
);
const { validators, deploymentId } = loadManifest(
  new URL("./fixtures/manifest-sample.json", import.meta.url).pathname,
);

let reachable = false;
let nodeSettlements: NodeSettlement[] = [];
let indexHeaders: IndexHeader[] = [];

const withTimeout = <T,>(work: Promise<T>, ms = 3000): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms),
    ),
  ]);

beforeAll(async () => {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1;`);
    await withTimeout(indexerPrisma.$queryRaw`SELECT 1;`);
    reachable = true;
  } catch (err) {
    if (process.env.REQUIRE_DB === "1") throw err;
    console.warn(`Skipping cross-source identity: a database is unreachable. ${String(err)}`);
    return;
  }

  // Seeded rather than assumed. The index this suite reads is a test database,
  // so the comparison has something real in it only because this put it there.
  await truncateL1();
  await ingestTxInfos(infos, validators, deploymentId);

  nodeSettlements = await prisma.$queryRaw<NodeSettlement[]>`
    SELECT encode(header_hash, 'hex') AS header_hash,
           encode(submitted_tx_hash, 'hex') AS submitted_tx_hash
      FROM pending_block_finalizations
     WHERE submitted_tx_hash IS NOT NULL;`;

  indexHeaders = await indexerPrisma.$queryRaw<IndexHeader[]>`
    SELECT header_hash, l1_tx_hash FROM l1_block_header;`;
});

afterAll(async () => {
  if (reachable) await truncateL1();
});

describe("the comparison actually happened", () => {
  it("reached both databases when REQUIRE_DB is set", () => {
    if (process.env.REQUIRE_DB !== "1") return;
    expect(reachable).toBe(true);
  });

  /** Without rows on both sides there is nothing to compare, and a green here
   * would mean exactly what the original defect's green meant. */
  it("has rows on both sides, so the assertions below measure something", () => {
    if (!reachable) return;
    expect(indexHeaders.length).toBeGreaterThan(0);
    expect(nodeSettlements.length).toBeGreaterThan(0);
  });
});

describe("the index keys blocks the way the routes ask for them", () => {
  /** `/api/l1/block-header` and `/block/[headerHash]` both validate 56 hex, so a
   * key of any other width cannot be requested through either. */
  it("stores every header key at the width the routes validate", () => {
    if (!reachable) return;
    const wrong = indexHeaders.map((r) => r.header_hash).filter((h) => !HEADER_HASH.test(h));
    expect(wrong).toEqual([]);
  });

  it("stores every settlement transaction hash as a 32-byte hash", () => {
    if (!reachable) return;
    const wrong = indexHeaders
      .map((r) => r.l1_tx_hash)
      .filter((h): h is string => h !== null)
      .filter((h) => !TX_HASH.test(h));
    expect(wrong).toEqual([]);
  });
});

describe("the node's claim and the index's observation describe the same block", () => {
  /** The join the product is named for, on a block both sources hold. */
  it("indexes a header the node also settled, under the same identity", () => {
    if (!reachable) return;
    const node = nodeSettlements.find((s) => s.header_hash === COMMITTED_HEADER);
    expect(node, `the node no longer holds ${COMMITTED_HEADER}`).toBeDefined();

    const indexed = indexHeaders.find((r) => r.header_hash === COMMITTED_HEADER);
    expect(indexed, `the index did not key the block by its header hash`).toBeDefined();
    expect(indexed?.l1_tx_hash).toBe(node?.submitted_tx_hash);
  });

  /** No header may claim a settlement transaction the node attributes to a
   * different block. Lag is allowed; disagreement is not. */
  it("never attributes a settlement transaction to the wrong block", () => {
    if (!reachable) return;
    const nodeByTx = new Map(nodeSettlements.map((s) => [s.submitted_tx_hash, s.header_hash]));
    const disagreements = indexHeaders
      .filter((r): r is IndexHeader & { l1_tx_hash: string } => r.l1_tx_hash !== null)
      .filter((r) => nodeByTx.has(r.l1_tx_hash))
      .filter((r) => nodeByTx.get(r.l1_tx_hash) !== r.header_hash)
      .map(
        (r) =>
          `${r.l1_tx_hash.slice(0, 12)}…: index ${r.header_hash} vs node ${nodeByTx.get(r.l1_tx_hash)}`,
      );
    expect(disagreements).toEqual([]);
  });
});

describe("an identifier means the same thing to both databases", () => {
  /**
   * The second time this defect class appeared.
   *
   * The two stores compare differently: the node holds `bytea`, so
   * `Buffer.from(hex, "hex")` reads an uppercase hash happily, while the
   * explorer's index holds text and does not. An unnormalised identifier
   * therefore found the block and reported its Cardano evidence missing, which
   * is the same false "not observed" claim the canonical key repair exists to
   * end, reached by a different route.
   *
   * Measured before the fix on a live block: lowercase gave `matched`, the same
   * hash uppercased gave `node_only`.
   */
  it("resolves the same header whichever case it is written in", async () => {
    if (!reachable) return;
    const [row] = await indexerPrisma.$queryRaw<Array<{ header_hash: string }>>`
      SELECT header_hash FROM l1_block_header LIMIT 1;`;
    if (row === undefined) return;

    const lower = canonicalHash(row.header_hash);
    const upper = canonicalHash(row.header_hash.toUpperCase());
    expect(upper).toBe(lower);

    const found = await indexerPrisma.l1BlockHeader.findUnique({
      where: { headerHash: upper },
    });
    expect(found, "an uppercase header hash must resolve to the same row").not.toBeNull();
  });
});
