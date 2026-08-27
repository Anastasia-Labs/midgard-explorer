import { prisma } from "../db";

const HISTORY_LIMIT = 25;

export async function getAllAddressHistory() {
  return prisma.addressHistory.findMany();
}

/**
 * Current spendable UTxOs owned by an address. The node's live ledger is
 * `mempool_ledger`; deposit-sourced rows only become spendable once their
 * deposit is projected (mirrors the node's spendable predicate).
 */
export async function getAddressUtxos(address: string) {
  return prisma.$queryRaw<Array<{ output: Uint8Array; outref: Uint8Array }>>`
    SELECT ml.output, ml.outref
      FROM mempool_ledger AS ml
      LEFT JOIN deposits_utxos AS d ON d.event_id = ml.source_event_id
     WHERE ml.address = ${address}
       AND (ml.source_event_id IS NULL OR d.projected_header_hash IS NOT NULL)
     ORDER BY encode(ml.outref, 'hex') ASC;`;
}

export type AddressHistoryRecord = {
  tx_id: Uint8Array;
  address: string;
  tx: Uint8Array | null;
  tx_source: string | null;
  height: number | null;
  header_hash: Uint8Array | null;
  time_stamp_tz: Date | null;
  finalization_status: string | null;
};

/**
 * Address activity is rooted in `address_history`, not in whichever
 * transaction tier happens to hold a body today. Durable block membership
 * comes from the finalization journal; `blocks` is retained only as a
 * compatibility fallback and a nullable legacy row identifier.
 *
 * The page is bounded before decoding. The total and activity range describe
 * the complete address history, not just the returned page.
 */
export async function getAddressHistory(address: string, page: number = 1) {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * HISTORY_LIMIT;

  const [rows, summaryRows] = await Promise.all([
    prisma.$queryRaw<AddressHistoryRecord[]>`
      WITH tx_candidates AS (
        SELECT tx_id, tx, time_stamp_tz, 'immutable'::text AS source, 1 AS priority
          FROM immutable
        UNION ALL
        SELECT member_id AS tx_id, payload_cbor AS tx,
               source_time_stamp_tz AS time_stamp_tz,
               'journal'::text AS source, 2 AS priority
          FROM pending_block_finalization_txs
        UNION ALL
        SELECT tx_id, tx, time_stamp_tz, 'processed_mempool'::text AS source, 3 AS priority
          FROM processed_mempool
        UNION ALL
        SELECT tx_id, tx, time_stamp_tz, 'mempool'::text AS source, 4 AS priority
          FROM mempool
      ), tx_body AS (
        SELECT DISTINCT ON (tx_id) tx_id, tx, time_stamp_tz, source
          FROM tx_candidates
         ORDER BY tx_id, priority ASC, time_stamp_tz DESC
      ), journal_membership AS (
        SELECT DISTINCT ON (j.member_id)
               j.member_id AS tx_id, j.header_hash,
               j.source_time_stamp_tz AS time_stamp_tz,
               f.block_end_time, f.status AS finalization_status
          FROM pending_block_finalization_txs AS j
          JOIN pending_block_finalizations AS f ON f.header_hash = j.header_hash
         ORDER BY j.member_id, f.block_end_time DESC,
                  encode(j.header_hash, 'hex') DESC
      ), legacy_membership AS (
        SELECT b.tx_id, b.header_hash, b.time_stamp_tz
          FROM blocks AS b
      ), legacy_height AS (
        SELECT header_hash, MIN(height)::int AS height
          FROM blocks GROUP BY header_hash
      ), activity AS (
        SELECT ah.tx_id, ah.address, tb.tx, tb.source AS tx_source,
               lh.height,
               COALESCE(jm.header_hash, lm.header_hash) AS header_hash,
               COALESCE(jm.time_stamp_tz, lm.time_stamp_tz, tb.time_stamp_tz)
                 AS time_stamp_tz,
               jm.finalization_status
          FROM address_history AS ah
          LEFT JOIN tx_body AS tb ON tb.tx_id = ah.tx_id
          LEFT JOIN journal_membership AS jm ON jm.tx_id = ah.tx_id
          LEFT JOIN legacy_membership AS lm
            ON lm.tx_id = ah.tx_id AND jm.tx_id IS NULL
          LEFT JOIN legacy_height AS lh
            ON lh.header_hash = COALESCE(jm.header_hash, lm.header_hash)
         WHERE ah.address = ${address}
      )
      SELECT tx_id, address, tx, tx_source, height, header_hash,
             time_stamp_tz, finalization_status
        FROM activity
       ORDER BY time_stamp_tz DESC NULLS LAST, encode(tx_id, 'hex') DESC
       OFFSET ${offset} LIMIT ${HISTORY_LIMIT};`,
    prisma.$queryRaw<
      Array<{
        total: bigint;
        first_activity: Date | null;
        latest_activity: Date | null;
      }>
    >`
      WITH body_times AS (
        SELECT tx_id, MAX(time_stamp_tz) AS time_stamp_tz FROM (
          SELECT tx_id, time_stamp_tz FROM immutable
          UNION ALL SELECT tx_id, time_stamp_tz FROM processed_mempool
          UNION ALL SELECT tx_id, time_stamp_tz FROM mempool
        ) AS bodies GROUP BY tx_id
      ), journal_times AS (
        SELECT member_id AS tx_id, MAX(source_time_stamp_tz) AS time_stamp_tz
          FROM pending_block_finalization_txs GROUP BY member_id
      ), legacy_times AS (
        SELECT tx_id, MAX(time_stamp_tz) AS time_stamp_tz
          FROM blocks GROUP BY tx_id
      )
      SELECT COUNT(*)::bigint AS total,
             MIN(COALESCE(j.time_stamp_tz, l.time_stamp_tz, b.time_stamp_tz))
               AS first_activity,
             MAX(COALESCE(j.time_stamp_tz, l.time_stamp_tz, b.time_stamp_tz))
               AS latest_activity
        FROM address_history AS ah
        LEFT JOIN journal_times AS j ON j.tx_id = ah.tx_id
        LEFT JOIN legacy_times AS l ON l.tx_id = ah.tx_id AND j.tx_id IS NULL
        LEFT JOIN body_times AS b ON b.tx_id = ah.tx_id
       WHERE ah.address = ${address};`,
  ]);

  const summary = summaryRows[0] ?? {
    total: 0n,
    first_activity: null,
    latest_activity: null,
  };
  const total = Number(summary.total);
  return {
    rows,
    total,
    limit: HISTORY_LIMIT,
    hasNextPage: safePage * HISTORY_LIMIT < total,
    firstActivity: summary.first_activity,
    latestActivity: summary.latest_activity,
  };
}
