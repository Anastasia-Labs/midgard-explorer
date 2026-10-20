import { Prisma } from "../../prisma/explorer-client";

/**
 * Where a block the node applied stands in settlement.
 *
 * Midgard migration 0011 renamed the journal's terminal `finalized` to
 * `locally_applied`: the node applied the block, and "whether it is final on
 * L1 is derived from the follower's facts, never stored". These are those
 * facts, read from the follower's own tables:
 *
 *   waiting_to_merge  the header is in the state queue (`node_landed_blocks`)
 *   merged            the node folded its merge into the confirmed ledger and
 *                     still keeps what a rollback would need to undo it
 *                     (`node_confirmed_merges`)
 *   finalized         an ancestor of the confirmed header past that window
 *   locally_applied   none of these is recorded yet, so it is unknown
 *
 * The block-confirmation fiber sets `locally_applied` apart from the follower,
 * so a header can briefly be applied and not yet landed. That reads as
 * unknown, never as merged: finality is only ever claimed from ancestry.
 */

/** The confirmed header and every ancestor of it, by parent link: the journal's
 * `base_tail_header_hash` for this node's blocks and the merge record's
 * `parent_header_hash` for any merged block. `UNION` ends the walk at the
 * first header already seen, so a malformed graph cannot make it loop.
 *
 * Only this node's blocks have a journal row, so a foreign block is crossed
 * only while its merge record is retained. Once the node prunes it, this
 * node's blocks behind it read as unknown rather than finalized.
 *
 * A merge record is pruned only once its merge is at or below the follower's
 * prune boundary, where "no rollback reaches them" (confirmed-merges.ts), so a
 * reachable ancestor without one is final by the follower's own rule. The
 * node's `/tx-status` reads different evidence and reports pruned evidence as
 * not finalized, so the two can disagree about an old block.
 *
 * Joined into a query's `WITH RECURSIVE` list, as `settled_chain`. */
export const SETTLED_CHAIN = Prisma.sql`settled_chain(header_hash) AS (
    SELECT header_hash FROM node_confirmed_ledger_frontier
    UNION
    SELECT parent.header_hash
      FROM settled_chain AS c
      CROSS JOIN LATERAL (
        SELECT base_tail_header_hash AS header_hash
          FROM pending_block_finalizations WHERE header_hash = c.header_hash
        UNION ALL
        SELECT parent_header_hash
          FROM node_confirmed_merges WHERE header_hash = c.header_hash
      ) AS parent
  )`;

/** The settlement status of the journal row aliased `alias`, which must be in
 * a query that also declares `SETTLED_CHAIN`. Every status but
 * `locally_applied` is the node's own and passes through. */
export const settlementStatus = (alias: string) => {
  const f = Prisma.raw(alias);
  return Prisma.sql`CASE
      WHEN ${f}.status <> 'locally_applied' THEN ${f}.status
      WHEN EXISTS (SELECT 1 FROM node_landed_blocks AS sq
                    WHERE sq.header_hash = ${f}.header_hash AND sq.state = 'processed')
        THEN 'waiting_to_merge'
      WHEN EXISTS (SELECT 1 FROM node_confirmed_merges AS sm
                    WHERE sm.header_hash = ${f}.header_hash)
        THEN 'merged'
      WHEN EXISTS (SELECT 1 FROM settled_chain AS sc
                    WHERE sc.header_hash = ${f}.header_hash)
        THEN 'finalized'
      ELSE 'locally_applied'
    END`;
};
