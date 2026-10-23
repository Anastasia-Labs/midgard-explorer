import { Client } from "pg";

/**
 * Real Midgard header hashes, read from the node's own settlement journal.
 *
 * `generateDataset` needs a header hash for every block it settles. A generated
 * hash would be 28 bytes that resolve to nothing, so the first `settledBlocks`
 * of them carry hashes a Midgard node actually committed to Cardano. That keeps
 * a benchmark dataset's settled blocks identifiable: a hash in a benchmark
 * artifact is one a reader can look up, not a number this file invented.
 *
 * These used to come from the explorer's own Cardano index, through a full
 * clone of nine index tables into a second database. The index is
 * decommissioned, and the hashes were never its to own: the node writes them
 * into `pending_block_finalizations` when it submits the commitment, which is
 * the same column `/l1` and the block pages now read. So the benchmark reads
 * them from the node's actual schema, one column, no second database.
 *
 * The source connection is used for `SELECT` only. Nothing here writes to it,
 * and nothing benchmarks against it: the rows are copied into the generated
 * dataset on the dedicated benchmark server.
 */

/** Where a set of settled hashes came from, for the run's artifact. */
export type SettledHashes = {
  /** The database the hashes were read from, without its credentials. */
  source: string;
  /** Real header hashes, ordered so a run is reproducible. */
  hashes: Buffer[];
};

/** A URL with its password removed, safe to record in an artifact. */
const describe = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.username}@${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
};

/**
 * Every header hash the node has a submitted commitment transaction for.
 *
 * Ordered by the hash itself rather than by time, so the same source always
 * hands out the same hashes in the same order. An unordered read would shuffle
 * which generated blocks are settled between runs, and the invariant that
 * checks them would fail for a reason nothing else would explain.
 *
 * `submitted_tx_hash IS NOT NULL` is the same condition `db/cardanoActivity.ts`
 * uses to call a row a settlement. A finalization row without one is a block
 * the node has not submitted, and its header hash is not a settled hash.
 */
export async function readSettledHashes(source: Client, url: string): Promise<SettledHashes> {
  const { rows } = await source.query<{ header_hash: Buffer }>(
    `SELECT header_hash FROM pending_block_finalizations
      WHERE submitted_tx_hash IS NOT NULL
      ORDER BY header_hash ASC`,
  );
  return {
    source: describe(url),
    hashes: rows.map((row) => Buffer.from(row.header_hash)),
  };
}

/**
 * Refuses a source that cannot settle the blocks the profile declares.
 *
 * Silence here would be the worst outcome: `generateDataset` falls back to a
 * synthetic hash for any settled block it has no real hash for, so a source
 * holding fewer rows than the profile needs produces a dataset that looks
 * identical and means something different. Naming both numbers is what keeps a
 * short source from being mistaken for a smaller one.
 */
export function assertEnoughHashes(settled: SettledHashes, required: number): void {
  if (settled.hashes.length >= required) return;
  throw new Error(
    `the node at ${settled.source} has ${settled.hashes.length} settled header ` +
      `hash(es); this profile settles ${required} blocks. Point ` +
      `BENCH_SOURCE_NODE_URL at a node that has committed at least that many ` +
      `blocks, or run a profile that settles fewer.`,
  );
}
