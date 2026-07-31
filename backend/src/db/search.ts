import { prisma } from "../db";

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
  | { kind: "transaction"; txId: string; height: number | null; headerHash: string | null }
  | { kind: "block"; headerHash: string; height: number };

export async function searchByPrefix(prefix: string): Promise<SearchHit[]> {
  const lower = prefix.toLowerCase();
  if (lower.length < MIN_PREFIX || !/^[0-9a-f]+$/.test(lower)) return [];
  const pattern = `${lower}%`;

  const [txs, blocks] = await Promise.all([
    prisma.$queryRaw<Array<{ tx_id: string; height: number; header_hash: string }>>`
      SELECT encode(tx_id, 'hex') AS tx_id,
             height,
             encode(header_hash, 'hex') AS header_hash
        FROM blocks
       WHERE encode(tx_id, 'hex') LIKE ${pattern}
       ORDER BY height DESC
       LIMIT ${MAX_RESULTS};`,
    prisma.$queryRaw<Array<{ header_hash: string; height: number }>>`
      SELECT DISTINCT encode(header_hash, 'hex') AS header_hash, height
        FROM blocks
       WHERE encode(header_hash, 'hex') LIKE ${pattern}
       ORDER BY height DESC
       LIMIT ${MAX_RESULTS};`,
  ]);

  return [
    ...blocks.map(
      (b): SearchHit => ({ kind: "block", headerHash: b.header_hash, height: b.height }),
    ),
    ...txs.map(
      (t): SearchHit => ({
        kind: "transaction",
        txId: t.tx_id,
        height: t.height,
        headerHash: t.header_hash,
      }),
    ),
  ].slice(0, MAX_RESULTS);
}
