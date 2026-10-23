import { readConsistently, type NodeReader } from "./consistent";
import { toHex } from "../utils";

/**
 * The node's terminal status for a block it applied (Midgard migration 0011
 * renamed `finalized` to it). It says the node applied the block; whether the
 * block is final on Cardano comes from the L1 follower, which this explorer
 * does not read.
 */
export const APPLIED_BLOCK_STATUS = "locally_applied";

/** The statuses of a block the node is still working on: the four its unique
 * index allows at most one row in. `locally_applied` and `abandoned` are
 * terminal, and an abandoned block can be revived. */
export const ACTIVE_BLOCK_STATUSES = [
  "pending_submission",
  "submitted_local_finalization_pending",
  "submitted_unconfirmed",
  "observed_waiting_stability",
] as const;

/** Operational metrics for the overview.
 *
 * Three rules govern everything in this file, because an operations panel that
 * is confidently wrong is worse than no panel:
 *
 *   1. Every number names the column it came from. The `source` field on each
 *      metric is part of the contract, not documentation, so a reader can check
 *      it against the node's schema.
 *   2. Every percentile carries the sample it was computed over. A p95 across
 *      four transactions is a number, not a measurement, and the UI has to be
 *      able to say so.
 *   3. Windows are reported, never assumed. If the node has three hours of
 *      history, a "24 hour" figure covers three hours, and the response says
 *      which so the UI does not imply a full day.
 */

const WINDOW_HOURS = 24;

export type Percentile = {
  p50Ms: number | null;
  p95Ms: number | null;
  /** How many records the percentiles were computed over. */
  sampleCount: number;
  source: string;
};

export type MetricsResponse = {
  window: {
    hours: number;
    start: string;
    end: string;
    /** Earliest block the node holds; null when there are no blocks at all. */
    observedFrom: string | null;
    /** True when history is shorter than the window, so the figures below
     * describe less time than their label suggests. */
    partial: boolean;
  };
  tip: {
    headerHash: string | null;
    height: number | null;
    at: string | null;
    ageSeconds: number | null;
    source: string;
  };
  throughput: {
    transactions: number;
    blocks: number;
    transactionsPerBlock: number | null;
    blockIntervalSeconds: {
      p50: number | null;
      p95: number | null;
      sampleCount: number;
    };
    source: string;
  };
  admission: {
    latency: Percentile;
    accepted: number;
    rejected: number;
    /** Null rather than zero when nothing reached a terminal state: a rate over
     * an empty denominator is undefined, not "nothing was rejected". */
    rejectionRate: number | null;
    queueDepth: number;
    source: string;
  };
  finality: {
    settlementLatency: Percentile;
    finalized: number;
    /** Blocks the node is still trying to settle, by status. */
    pending: number;
    abandoned: number;
    oldestUnsettled: {
      headerHash: string;
      status: string;
      blockEndTime: string;
      waitingSeconds: number;
    } | null;
    source: string;
  };
  /** Work the node has not put in a block yet, counted the way the node decides
   * whether to make one. It makes a block only when something waits, so an old
   * tip with nothing here is a quiet chain, not a stalled one. */
  waiting: {
    transactions: number;
    deposits: number;
    withdrawals: number;
    forcedTransactions: number;
    /** When the longest-waiting item entered the mempool or fell due. */
    since: string | null;
    source: string;
  };
  /** Per-status counts, so an unrecognized status is visible as itself rather
   * than being folded into a bucket the explorer invented. */
  statusBreakdown: {
    finalization: Array<{ status: string; count: number }>;
    admission: Array<{ status: string; count: number }>;
  };
  /** Hourly buckets across the window, oldest first, with empty hours present
   * as zeroes so a gap in production reads as a gap rather than as missing
   * data points the chart silently closes over. */
  series: Array<{ hour: string; blocks: number; transactions: number }>;
};

const num = (v: bigint | number | null): number | null =>
  v === null ? null : typeof v === "bigint" ? Number(v) : v;

const msOrNull = (v: number | string | null): number | null => {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Math.round(n) : null;
};

export async function getMetrics(reader?: NodeReader): Promise<MetricsResponse> {
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_HOURS * 3_600_000);

  const read = async (db: NodeReader) =>
    // One snapshot for the whole panel. These read the same tables and are
    // shown side by side, so a block finalised between two of them made the
    // tip newer than the backlog it was counted against.
    Promise.all([
    // A chain tip is the newest block the node applied, not merely the newest
    // transaction row. Height remains a nullable legacy aid.
    db.$queryRaw<
      Array<{
        header_hash: Uint8Array | null;
        height: number | null;
        at: Date | null;
      }>
    >`
      WITH legacy AS (
        SELECT header_hash, MIN(height)::int AS height FROM blocks GROUP BY header_hash
      )
      SELECT f.header_hash, l.height, f.block_end_time AS at
        FROM pending_block_finalizations AS f
        LEFT JOIN legacy AS l ON l.header_hash = f.header_hash
       WHERE f.status = 'locally_applied'
       ORDER BY f.block_end_time DESC, encode(f.header_hash, 'hex') DESC
       LIMIT 1;`,

    db.$queryRaw<Array<{ txs: bigint; blocks: bigint }>>`
      SELECT COUNT(j.member_id)::bigint AS txs,
             COUNT(DISTINCT f.header_hash)::bigint AS blocks
        FROM pending_block_finalizations AS f
        LEFT JOIN pending_block_finalization_txs AS j
          ON j.header_hash = f.header_hash
       WHERE f.status = 'locally_applied' AND f.block_end_time >= ${start};`,

    // Interval between consecutive applied header closes.
    db.$queryRaw<
      Array<{ p50: number | null; p95: number | null; n: bigint }>
    >`
      WITH gaps AS (
        SELECT EXTRACT(EPOCH FROM block_end_time - LAG(block_end_time) OVER (
                 ORDER BY block_end_time, encode(header_hash, 'hex')
               )) AS gap
          FROM pending_block_finalizations
         WHERE status = 'locally_applied' AND block_end_time >= ${start}
      )
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY gap) AS p95,
             COUNT(gap)::bigint AS n
        FROM gaps WHERE gap IS NOT NULL;`,

    // Admission latency, terminal counts and queue depth in ONE pass.
    //
    // These were three statements over `tx_admissions`, each with its own scan.
    // FILTER lets one scan answer all three, and it preserves the differing
    // predicates exactly: latency and the accepted/rejected split are windowed
    // on `terminal_at`, while queue depth is a standing figure over rows that
    // have not reached a decision at all. Merging those windows would have been
    // the bug, not the optimisation.
    db.$queryRaw<
      Array<{
        p50: number | null;
        p95: number | null;
        n: bigint;
        accepted: bigint;
        rejected: bigint;
        depth: bigint;
      }>
    >`
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM terminal_at - first_seen_at) * 1000)
               FILTER (WHERE terminal_at IS NOT NULL AND terminal_at >= ${start}) AS p50,
             percentile_cont(0.95) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM terminal_at - first_seen_at) * 1000)
               FILTER (WHERE terminal_at IS NOT NULL AND terminal_at >= ${start}) AS p95,
             COUNT(*) FILTER (
               WHERE terminal_at IS NOT NULL AND terminal_at >= ${start})::bigint AS n,
             COUNT(*) FILTER (
               WHERE status = 'accepted' AND terminal_at IS NOT NULL
                 AND terminal_at >= ${start})::bigint AS accepted,
             COUNT(*) FILTER (
               WHERE status = 'rejected' AND terminal_at IS NOT NULL
                 AND terminal_at >= ${start})::bigint AS rejected,
             COUNT(*) FILTER (WHERE status IN ('queued', 'validating'))::bigint AS depth
        FROM tx_admissions;`,

    // Every standing figure over `pending_block_finalizations` in one pass.
    //
    // Three statements became one. They differed in what they computed and not
    // in which rows they read: none of them is windowed, which is deliberate and
    // was argued over before. Backlog is a standing figure because a block stuck
    // for three days is exactly what an operator needs to see, and windowing
    // settlement latency while counting finalizations over all time once put
    // "No data" beside "8 settled" in one panel, which reads as a broken
    // explorer rather than a quiet day.
    //
    // Non-positive settlement durations stay excluded. Every finalized row on
    // this node currently records `updated_at` five to eight minutes BEFORE
    // `block_end_time`, which is a data problem in the node rather than a fast
    // settlement, and a panel printing "-7.8m" would be the confidently wrong
    // figure this file exists to prevent.
    db.$queryRaw<
      Array<{
        at: Date | null;
        p50: number | null;
        p95: number | null;
        n: bigint;
        finalized: bigint;
        pending: bigint;
        abandoned: bigint;
      }>
    >`
      SELECT MIN(block_end_time) FILTER (WHERE status = 'locally_applied') AS at,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM updated_at - block_end_time) * 1000)
               FILTER (WHERE status = 'locally_applied' AND updated_at > block_end_time) AS p50,
             percentile_cont(0.95) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM updated_at - block_end_time) * 1000)
               FILTER (WHERE status = 'locally_applied' AND updated_at > block_end_time) AS p95,
             COUNT(*) FILTER (
               WHERE status = 'locally_applied' AND updated_at > block_end_time)::bigint AS n,
             COUNT(*) FILTER (WHERE status = 'locally_applied')::bigint AS finalized,
             COUNT(*) FILTER (
               WHERE status = ANY(${[...ACTIVE_BLOCK_STATUSES]}::text[]))::bigint AS pending,
             COUNT(*) FILTER (WHERE status = 'abandoned')::bigint AS abandoned
        FROM pending_block_finalizations;`,

    db.$queryRaw<
      Array<{ header_hash: Uint8Array; status: string; block_end_time: Date }>
    >`
      SELECT header_hash, status, block_end_time
        FROM pending_block_finalizations
       WHERE status = ANY(${[...ACTIVE_BLOCK_STATUSES]}::text[])
       ORDER BY block_end_time ASC
       LIMIT 1;`,

    db.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status, COUNT(*)::bigint AS count
        FROM pending_block_finalizations
       GROUP BY status ORDER BY count DESC;`,

    db.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count
        FROM tx_admissions
       WHERE first_seen_at >= ${start}
       GROUP BY status ORDER BY count DESC;`,

    // generate_series keeps empty hours in the result. Without it a quiet hour
    // would vanish and the chart would draw a straight line across an outage.
    db.$queryRaw<Array<{ hour: Date; blocks: bigint; txs: bigint }>>`
      WITH hours AS (
        SELECT generate_series(
          date_trunc('hour', ${start}::timestamptz),
          date_trunc('hour', ${end}::timestamptz),
          interval '1 hour') AS hour
      )
      SELECT h.hour,
             COALESCE(COUNT(DISTINCT f.header_hash), 0)::bigint AS blocks,
             COALESCE(COUNT(j.member_id), 0)::bigint AS txs
        FROM hours AS h
        LEFT JOIN pending_block_finalizations AS f
          ON f.status = 'locally_applied'
         AND date_trunc('hour', f.block_end_time) = h.hour
        LEFT JOIN pending_block_finalization_txs AS j
          ON j.header_hash = f.header_hash
       GROUP BY h.hour
       ORDER BY h.hour ASC;`,

    // The node's own test for whether to make a block: pending transactions,
    // plus bridge events that are due and carried by no header yet. Deposits
    // count in any status and withdrawals and forced transactions only while
    // awaiting or projected, as in the node's pending-header queries.
    db.$queryRaw<
      Array<{
        transactions: bigint;
        deposits: bigint;
        withdrawals: bigint;
        forced: bigint;
        since: Date | null;
      }>
    >`
      WITH waiting AS (
        -- A skipped submission moves transactions from mempool into
        -- processed_mempool, and the node draws candidates from both; a
        -- transaction in both counts once, from its earlier time. A row a
        -- block includes carries that block's hash in included_by until the
        -- block's fold is final, and the node skips it: pending means unmarked.
        SELECT 'transaction' AS kind, MIN(since) AS since
          FROM (
            SELECT tx_id, time_stamp_tz AS since FROM mempool
             WHERE included_by IS NULL
            UNION ALL
            SELECT tx_id, time_stamp_tz FROM processed_mempool
             WHERE included_by IS NULL
          ) AS pending
         GROUP BY tx_id
        UNION ALL
        SELECT 'deposit', inclusion_time FROM deposits_utxos
         WHERE projected_header_hash IS NULL AND inclusion_time <= ${end}
        UNION ALL
        SELECT 'withdrawal', inclusion_time FROM withdrawal_utxos
         WHERE status IN ('awaiting', 'projected')
           AND projected_header_hash IS NULL AND inclusion_time <= ${end}
        UNION ALL
        SELECT 'forced', inclusion_time FROM forced_transaction_utxos
         WHERE status IN ('awaiting', 'projected')
           AND projected_header_hash IS NULL AND inclusion_time <= ${end}
      )
      SELECT COUNT(*) FILTER (WHERE kind = 'transaction')::bigint AS transactions,
             COUNT(*) FILTER (WHERE kind = 'deposit')::bigint AS deposits,
             COUNT(*) FILTER (WHERE kind = 'withdrawal')::bigint AS withdrawals,
             COUNT(*) FILTER (WHERE kind = 'forced')::bigint AS forced,
             MIN(since) AS since
        FROM waiting;`,
  ]);

  const [
    tipRows,
    throughputRows,
    intervalRows,
    admissionRows,
    finalizationScalars,
    oldestRows,
    finalizationBreakdown,
    admissionBreakdown,
    seriesRows,
    waitingRows,
  ] = reader ? await read(reader) : await readConsistently(read);

  const tip = tipRows[0] ?? { header_hash: null, height: null, at: null };
  const observedFrom = finalizationScalars[0]?.at ?? null;
  const throughput = throughputRows[0] ?? { txs: 0n, blocks: 0n };
  const interval = intervalRows[0] ?? { p50: null, p95: null, n: 0n };
  const admissionLatency = admissionRows[0] ?? {
    p50: null,
    p95: null,
    n: 0n,
  };
  const admissionCounts = admissionRows[0] ?? {
    accepted: 0n,
    rejected: 0n,
  };
  const settlement = finalizationScalars[0] ?? { p50: null, p95: null, n: 0n };
  const finalityCounts = finalizationScalars[0] ?? {
    finalized: 0n,
    pending: 0n,
    abandoned: 0n,
  };
  const oldest = oldestRows[0] ?? null;
  const waiting = waitingRows[0] ?? null;

  const txCount = Number(throughput.txs);
  const blockCount = Number(throughput.blocks);
  const accepted = Number(admissionCounts.accepted);
  const rejected = Number(admissionCounts.rejected);
  const terminalTotal = accepted + rejected;

  return {
    window: {
      hours: WINDOW_HOURS,
      start: start.toISOString(),
      end: end.toISOString(),
      observedFrom: observedFrom === null ? null : observedFrom.toISOString(),
      partial: observedFrom !== null && observedFrom > start,
    },
    tip: {
      headerHash: tip.header_hash === null ? null : toHex(tip.header_hash),
      height: num(tip.height),
      at: tip.at === null ? null : tip.at.toISOString(),
      ageSeconds:
        tip.at === null
          ? null
          : Math.max(0, Math.round((end.getTime() - tip.at.getTime()) / 1000)),
      source:
        "pending_block_finalizations.status, pending_block_finalizations.block_end_time, blocks.height",
    },
    throughput: {
      transactions: txCount,
      blocks: blockCount,
      transactionsPerBlock: blockCount === 0 ? null : txCount / blockCount,
      blockIntervalSeconds: {
        p50: interval.p50 === null ? null : Number(interval.p50),
        p95: interval.p95 === null ? null : Number(interval.p95),
        sampleCount: Number(interval.n),
      },
      source:
        "pending_block_finalizations.block_end_time, pending_block_finalization_txs.member_id",
    },
    admission: {
      latency: {
        p50Ms: msOrNull(admissionLatency.p50),
        p95Ms: msOrNull(admissionLatency.p95),
        sampleCount: Number(admissionLatency.n),
        source: "tx_admissions.terminal_at - tx_admissions.first_seen_at",
      },
      accepted,
      rejected,
      rejectionRate: terminalTotal === 0 ? null : rejected / terminalTotal,
      queueDepth: Number(admissionRows[0]?.depth ?? 0n),
      source: "tx_admissions.status, tx_admissions.terminal_at",
    },
    finality: {
      settlementLatency: {
        p50Ms: msOrNull(settlement.p50),
        p95Ms: msOrNull(settlement.p95),
        sampleCount: Number(settlement.n),
        // Names its scope. This figure is all time while most of the panel is
        // windowed, and a reader comparing it against the window would draw the
        // wrong conclusion without being told.
        source:
          "all time · pending_block_finalizations.updated_at - pending_block_finalizations.block_end_time",
      },
      finalized: Number(finalityCounts.finalized),
      pending: Number(finalityCounts.pending),
      abandoned: Number(finalityCounts.abandoned),
      oldestUnsettled:
        oldest === null
          ? null
          : {
              headerHash: toHex(oldest.header_hash),
              status: oldest.status,
              blockEndTime: oldest.block_end_time.toISOString(),
              waitingSeconds: Math.max(
                0,
                Math.round(
                  (end.getTime() - oldest.block_end_time.getTime()) / 1000,
                ),
              ),
            },
      source:
        "pending_block_finalizations.status, pending_block_finalizations.block_end_time",
    },
    waiting: {
      transactions: Number(waiting?.transactions ?? 0n),
      deposits: Number(waiting?.deposits ?? 0n),
      withdrawals: Number(waiting?.withdrawals ?? 0n),
      forcedTransactions: Number(waiting?.forced ?? 0n),
      since: waiting?.since?.toISOString() ?? null,
      source:
        "mempool.time_stamp_tz; deposits_utxos, withdrawal_utxos, forced_transaction_utxos: inclusion_time, projected_header_hash, status",
    },
    statusBreakdown: {
      finalization: finalizationBreakdown.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      admission: admissionBreakdown.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
    },
    series: seriesRows.map((r) => ({
      hour: r.hour.toISOString(),
      blocks: Number(r.blocks),
      transactions: Number(r.txs),
    })),
  };
}
