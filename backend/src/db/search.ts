import { prisma } from "../db";
import { indexerPrisma } from "../indexer/db";
import { getManifestValidators } from "./l1";

/** Prefix search over identifiers.
 *
 * Every explorer's search asks for a full hash, and nobody has one to hand:
 * they have the first eight characters from a log line or a screenshot. This
 * turns that into a usable query.
 *
 * The comparison is done on the hex text rather than on bytes so an odd-length
 * prefix works, which is the common case when a prefix is copied out of a
 * truncated display. That means no index can serve it, so the prefix has a
 * minimum length and the result set has a hard cap: a two-character prefix
 * would match most of the chain and cost a full scan to say so.
 */

export const MIN_PREFIX = 6;
export const MAX_RESULTS = 10;

export type SearchHit =
  | {
      kind: "transaction";
      txId: string;
      height: number | null;
      headerHash: string | null;
    }
  | { kind: "block"; headerHash: string; height: number | null }
  | { kind: "l1Transaction"; txHash: string; blockHeight: number }
  | { kind: "validator"; scriptHash: string; family: string }
  | { kind: "address"; address: string }
  | { kind: "deposit"; eventId: string; txHash: string }
  | { kind: "withdrawal"; eventId: string; txHash: string }
  | { kind: "forcedTransaction"; orderId: string; txHash: string };

export async function searchAddress(address: string): Promise<SearchHit[]> {
  if (!/^(?:addr|stake)(?:_test)?1[0-9a-z]+$/.test(address)) return [];
  const rows = await prisma.$queryRaw<Array<{ found: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM mempool_ledger WHERE address = ${address}
      UNION ALL
      SELECT 1 FROM confirmed_ledger WHERE address = ${address}
    ) AS found;`;
  return rows[0]?.found ? [{ kind: "address", address }] : [];
}

export async function searchByPrefix(prefix: string): Promise<SearchHit[]> {
  const lower = prefix.toLowerCase();
  if (lower.length < MIN_PREFIX || !/^[0-9a-f]+$/.test(lower)) return [];
  const pattern = `${lower}%`;

  const [txs, blocks, l1Txs, deposits, withdrawals, forced] = await Promise.all([
    prisma.$queryRaw<
      Array<{ tx_id: string; height: number | null; header_hash: string }>
    >`
      WITH legacy AS (
        SELECT header_hash, MIN(height)::int AS height FROM blocks GROUP BY header_hash
      ), committed AS (
        SELECT j.member_id AS tx_id, j.header_hash, l.height,
               f.block_end_time, j.ordinal
          FROM pending_block_finalization_txs AS j
          JOIN pending_block_finalizations AS f ON f.header_hash = j.header_hash
          LEFT JOIN legacy AS l ON l.header_hash = j.header_hash
        UNION ALL
        SELECT b.tx_id, b.header_hash, MIN(peer.height)::int AS height,
               b.time_stamp_tz AS block_end_time, b.height AS ordinal
          FROM blocks AS b
          JOIN blocks AS peer ON peer.header_hash = b.header_hash
         WHERE NOT EXISTS (
           SELECT 1 FROM pending_block_finalization_txs AS j
            WHERE j.header_hash = b.header_hash AND j.member_id = b.tx_id
         )
         GROUP BY b.tx_id, b.header_hash, b.time_stamp_tz, b.height
      )
      SELECT encode(tx_id, 'hex') AS tx_id, height,
             encode(header_hash, 'hex') AS header_hash
        FROM committed
       WHERE encode(tx_id, 'hex') LIKE ${pattern}
       ORDER BY block_end_time DESC, encode(header_hash, 'hex') DESC, ordinal ASC
       LIMIT ${MAX_RESULTS};`,
    prisma.$queryRaw<Array<{ header_hash: string; height: number | null }>>`
      WITH legacy AS (
        SELECT header_hash, MIN(height)::int AS height FROM blocks GROUP BY header_hash
      )
      SELECT encode(f.header_hash, 'hex') AS header_hash, l.height
        FROM pending_block_finalizations AS f
        LEFT JOIN legacy AS l ON l.header_hash = f.header_hash
       WHERE encode(f.header_hash, 'hex') LIKE ${pattern}
       ORDER BY f.block_end_time DESC, encode(f.header_hash, 'hex') DESC
       LIMIT ${MAX_RESULTS};`,
    indexerPrisma.l1Tx.findMany({
      where: { txHash: { startsWith: lower } },
      orderBy: [{ txTime: "desc" }, { txHash: "desc" }],
      take: MAX_RESULTS,
      select: { txHash: true, blockHeight: true },
    }),
    prisma.$queryRaw<Array<{ event_id: string; tx_hash: string }>>`
      SELECT encode(event_id, 'hex') AS event_id,
             encode(deposit_l1_tx_hash, 'hex') AS tx_hash
        FROM deposits_utxos
       WHERE encode(event_id, 'hex') LIKE ${pattern}
          OR encode(deposit_l1_tx_hash, 'hex') LIKE ${pattern}
       ORDER BY inclusion_time DESC, encode(event_id, 'hex') DESC
       LIMIT ${MAX_RESULTS};`,
    prisma.$queryRaw<Array<{ event_id: string; tx_hash: string }>>`
      SELECT encode(event_id, 'hex') AS event_id,
             encode(withdrawal_l1_tx_hash, 'hex') AS tx_hash
        FROM withdrawal_utxos
       WHERE encode(event_id, 'hex') LIKE ${pattern}
          OR encode(withdrawal_l1_tx_hash, 'hex') LIKE ${pattern}
       ORDER BY inclusion_time DESC, encode(event_id, 'hex') DESC
       LIMIT ${MAX_RESULTS};`,
    prisma.$queryRaw<Array<{ order_id: string; tx_hash: string }>>`
      SELECT encode(tx_order_id, 'hex') AS order_id,
             encode(tx_order_l1_tx_hash, 'hex') AS tx_hash
        FROM forced_transaction_utxos
       WHERE encode(tx_order_id, 'hex') LIKE ${pattern}
          OR encode(tx_order_l1_tx_hash, 'hex') LIKE ${pattern}
       ORDER BY inclusion_time DESC, encode(tx_order_id, 'hex') DESC
       LIMIT ${MAX_RESULTS};`,
  ]);

  return [
    ...blocks.map((b): SearchHit => ({
      kind: "block",
      headerHash: b.header_hash,
      height: b.height,
    })),
    ...txs.map((t): SearchHit => ({
      kind: "transaction",
      txId: t.tx_id,
      height: t.height,
      headerHash: t.header_hash,
    })),
    ...l1Txs.map((row): SearchHit => ({
      kind: "l1Transaction",
      txHash: row.txHash,
      blockHeight: row.blockHeight,
    })),
    ...getManifestValidators()
      .filter((row) => row.scriptHash.startsWith(lower))
      .map((row): SearchHit => ({ kind: "validator", scriptHash: row.scriptHash, family: row.family })),
    ...deposits.map((row): SearchHit => ({ kind: "deposit", eventId: row.event_id, txHash: row.tx_hash })),
    ...withdrawals.map((row): SearchHit => ({ kind: "withdrawal", eventId: row.event_id, txHash: row.tx_hash })),
    ...forced.map((row): SearchHit => ({ kind: "forcedTransaction", orderId: row.order_id, txHash: row.tx_hash })),
  ].slice(0, MAX_RESULTS);
}
