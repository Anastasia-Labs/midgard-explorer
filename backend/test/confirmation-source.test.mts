import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A deployment with no independent source does not READ one.
 *
 * The resolver tests prove the verdicts are honest given their inputs. They
 * cannot prove where the inputs came from, and "the index is no longer
 * consulted" is a claim about a database query, not about a branch: a skipped
 * verdict that still issued the query keeps every operational cost the
 * decision was taken to remove, and keeps a stale row one refactor away from
 * reaching a page again.
 *
 * So the index module is replaced by a counter. No database is needed, which
 * is the point: this file must fail when the query returns, not when Postgres
 * is down.
 */

const index = { reads: 0, unreadable: false, observedAt: new Date() };

const HEADER = "c".repeat(56);
const INDEX_HASH = "b".repeat(64);
const NODE_HASH = "a".repeat(64);

vi.mock("../src/indexer/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/indexer/db.js")>();
  return {
    ...actual,
    // The trailing comma is required: `<T>` alone is reserved syntax in an
    // .mts file, and vitest transpiles it happily while `tsc` refuses.
    readIndexConsistently: async <T,>(work: (tx: never) => Promise<T>): Promise<T> => {
      index.reads += 1;
      if (index.unreadable) throw new Error("index database unreachable");
      return work({
        l1BlockHeader: {
          findUnique: async () => ({ headerHash: HEADER, l1TxHash: INDEX_HASH, blockHeight: 5_000_001 }),
        },
      } as never);
    },
    getSyncCursors: async () => new Map(actual.SYNC_SOURCES.map((s) => [s, 5_000_001])),
    getSyncCursorTimes: async () => new Map(actual.SYNC_SOURCES.map((s) => [s, index.observedAt])),
  };
});

const { config } = await import("../src/config.js");
const { getIndexSettlement, unconsultedIndexSettlement } = await import("../src/db/deployment.js");
const { blockSettlement } = await import("../src/db/association.js");

const identity = { deploymentId: "dep", network: "preprod", l2ObservedAsOf: null };

const settlement = (
  over: Awaited<ReturnType<typeof getIndexSettlement>>,
  nodeHash: string | null = NODE_HASH,
) =>
  blockSettlement(identity, HEADER, {
    ...over,
    nodeHash,
    nodeStatus: nodeHash === null ? null : "finalized",
    nodeObservedAt: "2026-09-02T00:00:00Z",
    identityVerified: true,
    nodeFreshness: "live",
  });

beforeEach(() => {
  index.reads = 0;
  index.unreadable = false;
  // Current by default, so index-mode cases compare rather than report lag.
  index.observedAt = new Date();
});

describe("reading the confirmation index", () => {
  it("issues no query when the deployment declares no independent source", async () => {
    const observed = await getIndexSettlement(HEADER, "none");
    expect(index.reads, "the index was queried anyway").toBe(0);
    expect(observed.confirmationSource).toBe("none");
    expect(observed.indexHash).toBeNull();
    expect(observed.indexAvailable).toBe(false);
    expect(observed.indexLagSeconds).toBeNull();
  });

  /**
   * The half that makes the assertion above mean something.
   *
   * A counter that never increments cannot tell a skipped query from a broken
   * spy, so index mode must be seen to reach the database through the same
   * seam, in the same file, in the same run.
   */
  it("does query in index mode, so the count above is a measurement", async () => {
    const observed = await getIndexSettlement(HEADER, "index");
    expect(index.reads).toBe(1);
    expect(observed.indexHash).toBe(INDEX_HASH);
    expect(observed.confirmationSource).toBe("index");
    expect(observed.indexAvailable).toBe(true);
  });

  it("takes its default from configuration rather than assuming one", async () => {
    const observed = await getIndexSettlement(HEADER);
    expect(observed.confirmationSource).toBe(config.L1_CONFIRMATION_SOURCE);
    expect(index.reads).toBe(config.L1_CONFIRMATION_SOURCE === "index" ? 1 : 0);
  });
});

describe("settlement when the index is unreachable", () => {
  /** An outage in a source this deployment does not read is not an event. */
  it("still reports the node's record, and still reads nothing", async () => {
    index.unreadable = true;
    const observed = await getIndexSettlement(HEADER, "none");
    const association = settlement(observed);
    expect(index.reads).toBe(0);
    expect(association.reconciliation).toBe("node_reported");
    expect(association.comparability).toBe("no_independent_source");
    expect(association.kind === "block_settlement" && association.l1TxHash).toBe(NODE_HASH);
    expect(association.kind === "block_settlement" && association.state).toBe("finalized");
  });

  /** Index mode is unchanged: an unreadable index is still reported as one,
   * and is still not allowed to look like a settled absence. */
  it("keeps reporting an unreadable index as unavailable in index mode", async () => {
    index.unreadable = true;
    const observed = await getIndexSettlement(HEADER, "index");
    expect(index.reads).toBe(1);
    expect(observed.indexAvailable).toBe(false);
    expect(settlement(observed).reconciliation).toBe("unavailable");
  });

  /** And a readable index still compares, which is what `index` is for. */
  it("keeps comparing in index mode", async () => {
    const observed = await getIndexSettlement(HEADER, "index");
    expect(settlement(observed, INDEX_HASH).reconciliation).toBe("matched");
    expect(settlement(observed, NODE_HASH).reconciliation).toBe("mismatch");
  });

  /** Including the rule that keeps a false integrity alarm off the page: an
   * index behind the chain has not disagreed with anything. */
  it("keeps reporting a lagging index as lag rather than disagreement", async () => {
    index.observedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const observed = await getIndexSettlement(HEADER, "index");
    expect(observed.indexLagSeconds).toBeGreaterThan(900);
    expect(settlement(observed, NODE_HASH).reconciliation).toBe("stale");
  });
});

describe("the unconsulted shape", () => {
  /** A transaction in no block reaches this too, and the two callers differ:
   * in index mode nothing was ASKED, which is not the same as unreadable. */
  it("separates not asked from not readable", () => {
    expect(unconsultedIndexSettlement("index").indexAvailable).toBe(true);
    expect(unconsultedIndexSettlement("none").indexAvailable).toBe(false);
    expect(unconsultedIndexSettlement("none").confirmationSource).toBe("none");
  });
});
