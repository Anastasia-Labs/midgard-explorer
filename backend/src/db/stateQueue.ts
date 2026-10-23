import { readConsistently, type NodeReader } from "./consistent";
import { toHex } from "../utils";

/** The oldest headers listed in full, from the confirmed one forwards. */
export const QUEUE_HEAD = 4;
/** The newest headers listed in full. */
export const QUEUE_TAIL = 8;
/** The walk stops here, so a malformed graph cannot run away. A queue this
 * long reports the rest as not linked rather than walking it per request. */
export const QUEUE_WALK_LIMIT = 10_000;

/** The journal statuses of a commit that has not landed yet. `locally_applied`
 * is past landing and `abandoned` is not on its way. */
const COMMITTING = [
  "pending_submission",
  "submitted_local_finalization_pending",
  "submitted_unconfirmed",
  "observed_waiting_stability",
];

type WalkRow = {
  header_hash: Uint8Array;
  parent_header_hash: Uint8Array;
  block_time: Date | null;
  commit_tx_hash: Uint8Array | null;
  pos: number;
  walked: number;
  kind: "own" | "foreign";
  transactions: number;
  deposits: number;
  withdrawals: number;
  forced: number;
  processed_at: Date;
};

const toBlock = (r: Omit<WalkRow, "pos" | "walked">) => ({
  headerHash: toHex(r.header_hash),
  parentHeaderHash: toHex(r.parent_header_hash),
  origin: r.kind,
  transactions: r.transactions,
  deposits: r.deposits,
  withdrawals: r.withdrawals,
  forcedTransactions: r.forced,
  processedAt: r.processed_at.toISOString(),
  blockTime: r.block_time ? r.block_time.toISOString() : null,
  commitTxHash: r.commit_tx_hash ? toHex(r.commit_tx_hash) : null,
});

/**
 * The queue as the node's follower holds it.
 *
 * `node_landed_blocks` keeps a `processed` row per landed header until its
 * merge is folded into the confirmed ledger, and a unique index allows one
 * processed child per parent, so the rows form one list. The walk starts at
 * the child of the confirmed header, or before the first merge at the one row
 * whose parent is not itself queued. Two starting rows is a broken graph: the
 * walk refuses to pick one and reports nothing as linked.
 *
 * Each step reads the table itself, so that unique index finds the next row.
 * A shared CTE of the processed rows was materialized without an index and
 * scanned once per step: about 570 ms for a 5,000-deep queue against 11 ms.
 */
/** The removed headers listed, newest first. */
export const QUEUE_REMOVED = 8;

export async function getStateQueue(
  reader?: NodeReader,
  maturityMs: number | null = null,
) {
  const read = (db: NodeReader) =>
    Promise.all([
      db.$queryRaw<Array<{ header_hash: Uint8Array; updated_at: Date }>>`
        SELECT header_hash, updated_at FROM node_confirmed_ledger_frontier LIMIT 1;`,
      db.$queryRaw<WalkRow[]>`
        WITH RECURSIVE
        frontier AS (SELECT header_hash FROM node_confirmed_ledger_frontier LIMIT 1),
        start AS (
          SELECT l.header_hash FROM node_landed_blocks AS l
           WHERE l.state = 'processed'
             AND CASE WHEN EXISTS (SELECT 1 FROM frontier)
                      THEN l.parent_header_hash = (SELECT header_hash FROM frontier)
                      ELSE NOT EXISTS (
                        SELECT 1 FROM node_landed_blocks AS p
                         WHERE p.state = 'processed' AND p.header_hash = l.parent_header_hash)
                 END
        ),
        walk AS (
          SELECT s.header_hash, 1 AS pos FROM start AS s
           WHERE (SELECT COUNT(*) FROM start) = 1
          UNION ALL
          SELECT l.header_hash, w.pos + 1
            FROM walk AS w
            JOIN node_landed_blocks AS l
              ON l.parent_header_hash = w.header_hash AND l.state = 'processed'
           WHERE w.pos < ${QUEUE_WALK_LIMIT}::int
        ),
        total AS (SELECT MAX(pos) AS walked FROM walk)
        SELECT l.header_hash,
               l.parent_header_hash,
               j.block_time,
               j.submitted_tx_hash AS commit_tx_hash,
               w.pos,
               t.walked,
               l.kind,
               cardinality(l.tx_ids) AS transactions,
               cardinality(l.deposit_ids) AS deposits,
               jsonb_array_length(l.withdrawals) AS withdrawals,
               cardinality(l.forced_ids) AS forced,
               l.processed_at
          FROM walk AS w
          JOIN node_landed_blocks AS l ON l.header_hash = w.header_hash AND l.state = 'processed'
          LEFT JOIN pending_block_finalizations AS j ON j.header_hash = l.header_hash
         CROSS JOIN total AS t
         WHERE w.pos <= ${QUEUE_HEAD}::int OR w.pos > t.walked - ${QUEUE_TAIL}::int
         ORDER BY w.pos ASC;`,
      db.$queryRaw<Array<{ processed: number; removed: number }>>`
        SELECT COUNT(*) FILTER (WHERE state = 'processed')::int AS processed,
               COUNT(*) FILTER (WHERE state = 'removed')::int AS removed
          FROM node_landed_blocks;`,
      db.$queryRaw<
        Array<{ header_hash: Uint8Array; status: string; block_time: Date }>
      >`
        SELECT f.header_hash, f.status, f.block_time
          FROM pending_block_finalizations AS f
         WHERE f.status = ANY(${COMMITTING}::text[])
           AND NOT EXISTS (
             SELECT 1 FROM node_landed_blocks AS l WHERE l.header_hash = f.header_hash)
         LIMIT 1;`,
      db.$queryRaw<Array<Omit<WalkRow, "pos" | "walked">>>`
        SELECT l.header_hash, l.parent_header_hash, l.kind,
               j.block_time, j.submitted_tx_hash AS commit_tx_hash,
               cardinality(l.tx_ids) AS transactions,
               cardinality(l.deposit_ids) AS deposits,
               jsonb_array_length(l.withdrawals) AS withdrawals,
               cardinality(l.forced_ids) AS forced,
               l.processed_at
          FROM node_landed_blocks AS l
          LEFT JOIN pending_block_finalizations AS j ON j.header_hash = l.header_hash
         WHERE l.state = 'removed'
         ORDER BY l.processed_at DESC, l.header_hash ASC
         LIMIT ${QUEUE_REMOVED}::int;`,
    ]);

  const [frontierRows, walkRows, countRows, commitRows, removedRows] = reader
    ? await read(reader)
    : await readConsistently(read);

  const frontier = frontierRows[0];
  const commit = commitRows[0];
  const counts = countRows[0] ?? { processed: 0, removed: 0 };
  const linked = walkRows[0]?.walked ?? 0;
  const blocks = walkRows.map(toBlock);
  const headCount = Math.min(QUEUE_HEAD, blocks.length);
  const oldest = blocks.slice(0, headCount);
  const newest = blocks.slice(headCount);

  // The shape is `StateQueueResponse` in contracts/state-queue.ts, which the
  // server does not import; the frontend's backend-contract test holds the
  // real response to it.
  return {
    observedAt: new Date().toISOString(),
    confirmed: frontier
      ? {
          headerHash: toHex(frontier.header_hash),
          updatedAt: frontier.updated_at.toISOString(),
        }
      : null,
    depth: counts.processed,
    linked,
    oldest,
    newest,
    hidden: Math.max(0, linked - oldest.length - newest.length),
    committing: commit
      ? {
          headerHash: toHex(commit.header_hash),
          status: commit.status,
          blockTime: commit.block_time.toISOString(),
        }
      : null,
    removed: counts.removed,
    removedBlocks: removedRows.map(toBlock),
    maturityMs,
  };
}
