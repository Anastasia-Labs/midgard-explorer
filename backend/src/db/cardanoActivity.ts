import { Prisma } from "../../prisma/explorer-client";
import { readConsistently, type NodeReader } from "./consistent";

/**
 * Midgard's Cardano footprint, as the NODE recorded it.
 *
 * This replaces the explorer-owned chain index for every list and lookup the
 * interface offers. The difference is not cosmetic and the wording of every
 * surface built on it has to carry it: the index observed Cardano and could
 * therefore find a transaction the node never mentioned, while this can only
 * report hashes the node itself wrote down. A commitment from another operator,
 * or one lost with a node database, is invisible here by construction.
 *
 * What it costs to run is nothing. These are four columns of the node's own
 * tables, read on request, with no poller, no second database and no external
 * service.
 */

export const ACTIVITY_KINDS = [
  "settlement",
  "deposit",
  "withdrawal",
  "forced_transaction",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type CardanoActivityRow = {
  kind: ActivityKind;
  l1TxHash: string;
  /** Set where the node records which output of the transaction it read. */
  outputIndex: number | null;
  /** When the NODE recorded this, not when Cardano accepted it. The two differ
   * and only one of them is knowable from here. */
  recordedAt: string;
  /** The node's own word for the record's state, unmapped. */
  status: string | null;
  /** The Midgard block this belongs to: the block a settlement commits, or the
   * header a bridge event was projected into. Null until the node sets one. */
  headerHash: string | null;
  /** The event or order identifier, so a row can link to the record it names. */
  recordId: string | null;
};

const PAGE_SIZE = 25;

/**
 * One SELECT per kind, unioned.
 *
 * Written out rather than generated, because each table names its hash, its
 * time and its identifier differently, and a generator hiding that would make
 * the next column rename fail at runtime instead of here.
 */
const ACTIVITY = Prisma.sql`
  SELECT 'settlement' AS kind,
         encode(submitted_tx_hash, 'hex') AS l1_tx_hash,
         NULL::integer AS output_index,
         updated_at AS recorded_at,
         status,
         encode(header_hash, 'hex') AS header_hash,
         NULL::text AS record_id
    FROM pending_block_finalizations
   WHERE submitted_tx_hash IS NOT NULL
   UNION ALL
  SELECT 'deposit',
         encode(deposit_l1_tx_hash, 'hex'),
         NULL::integer,
         inclusion_time,
         status,
         CASE WHEN projected_header_hash IS NULL THEN NULL
              ELSE encode(projected_header_hash, 'hex') END,
         encode(event_id, 'hex')
    FROM deposits_utxos
   UNION ALL
  SELECT 'withdrawal',
         encode(withdrawal_l1_tx_hash, 'hex'),
         withdrawal_l1_output_index,
         inclusion_time,
         status,
         CASE WHEN projected_header_hash IS NULL THEN NULL
              ELSE encode(projected_header_hash, 'hex') END,
         encode(event_id, 'hex')
    FROM withdrawal_utxos
   UNION ALL
  SELECT 'forced_transaction',
         encode(tx_order_l1_tx_hash, 'hex'),
         tx_order_l1_output_index,
         inclusion_time,
         status,
         CASE WHEN projected_header_hash IS NULL THEN NULL
              ELSE encode(projected_header_hash, 'hex') END,
         encode(tx_order_id, 'hex')
    FROM forced_transaction_utxos`;

type Raw = {
  kind: string;
  l1_tx_hash: string;
  output_index: number | null;
  recorded_at: Date;
  status: string | null;
  header_hash: string | null;
  record_id: string | null;
};

const toRow = (raw: Raw): CardanoActivityRow => ({
  kind: raw.kind as ActivityKind,
  l1TxHash: raw.l1_tx_hash,
  outputIndex: raw.output_index,
  recordedAt: raw.recorded_at.toISOString(),
  status: raw.status,
  headerHash: raw.header_hash,
  recordId: raw.record_id,
});

/**
 * Newest first, by the time the node recorded the row.
 *
 * `(recorded_at, l1_tx_hash, kind)` and not `recorded_at` alone: several rows
 * commonly share a timestamp, and a page boundary inside such a group either
 * repeats a row on the next page or skips one.
 */
export async function getCardanoActivityPage(page: number, db?: NodeReader) {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const offset = (safePage - 1) * PAGE_SIZE;
  const read = async (tx: NodeReader) =>
    Promise.all([
      tx.$queryRaw<Raw[]>`
        WITH activity AS (${ACTIVITY})
        SELECT * FROM activity
         ORDER BY recorded_at DESC, l1_tx_hash DESC, kind DESC
         LIMIT ${PAGE_SIZE + 1} OFFSET ${offset};`,
      tx.$queryRaw<Array<{ count: bigint }>>`
        WITH activity AS (${ACTIVITY})
        SELECT COUNT(*) AS count FROM activity;`,
    ]);
  const [rows, totals] = db ? await read(db) : await readConsistently(read);
  return {
    rows: rows.slice(0, PAGE_SIZE).map(toRow),
    hasNextPage: rows.length > PAGE_SIZE,
    total: Number(totals[0]?.count ?? 0),
    limit: PAGE_SIZE,
  };
}

export type CardanoActivitySummary = {
  total: number;
  newestRecordedAt: string | null;
  byKind: Array<{ kind: ActivityKind; count: number; newestRecordedAt: string | null }>;
};

/** Counts per kind, and how recent the newest record of each is. The age is
 * part of the answer: a count with no date reads as current. */
export async function getCardanoActivitySummary(
  db?: NodeReader,
): Promise<CardanoActivitySummary> {
  const read = async (tx: NodeReader) =>
    tx.$queryRaw<Array<{ kind: string; count: bigint; newest: Date | null }>>`
      WITH activity AS (${ACTIVITY})
      SELECT kind, COUNT(*) AS count, MAX(recorded_at) AS newest
        FROM activity GROUP BY kind;`;
  const grouped = db ? await read(db) : await readConsistently(read);
  const found = new Map(grouped.map((row) => [row.kind, row]));
  const byKind = ACTIVITY_KINDS.map((kind) => {
    const row = found.get(kind);
    return {
      kind,
      // Every kind, always, including the ones with nothing in them. A kind
      // that disappears from the list when it is empty reads as a kind this
      // deployment does not have.
      count: Number(row?.count ?? 0),
      newestRecordedAt: row?.newest?.toISOString() ?? null,
    };
  });
  const newest = byKind
    .map((k) => k.newestRecordedAt)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1);
  return {
    total: byKind.reduce((sum, k) => sum + k.count, 0),
    newestRecordedAt: newest ?? null,
    byKind,
  };
}

/**
 * Every node record that names one Cardano transaction.
 *
 * The transaction page is built from this and nothing else, so it can say what
 * Midgard did with the transaction and must not imply the explorer looked it up
 * on Cardano. A hash can legitimately appear more than once: one transaction
 * can carry several bridge events.
 */
export async function getCardanoReferences(
  txHash: string,
  db?: NodeReader,
): Promise<CardanoActivityRow[]> {
  const read = async (tx: NodeReader) =>
    tx.$queryRaw<Raw[]>`
      WITH activity AS (${ACTIVITY})
      SELECT * FROM activity
       WHERE l1_tx_hash = ${txHash.toLowerCase()}
       ORDER BY recorded_at DESC, kind DESC;`;
  const rows = db ? await read(db) : await readConsistently(read);
  return rows.map(toRow);
}
