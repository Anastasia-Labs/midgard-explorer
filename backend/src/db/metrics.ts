import { prisma } from "../db";
import { toHex } from "../utils";

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
    height: number | null;
    at: string | null;
    ageSeconds: number | null;
    source: string;
  };
  throughput: {
    transactions: number;
    blocks: number;
    transactionsPerBlock: number | null;
    blockIntervalSeconds: { p50: number | null; p95: number | null; sampleCount: number };
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

export async function getMetrics(): Promise<MetricsResponse> {
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_HOURS * 3_600_000);

  const [
    tipRows,
    firstRows,
    throughputRows,
    intervalRows,
    admissionLatencyRows,
    admissionCountRows,
    queueRows,
    settlementRows,
    finalityCountRows,
    oldestRows,
    finalizationBreakdown,
    admissionBreakdown,
    seriesRows,
  ] = await Promise.all([
    // Tip: `blocks` holds one row per block-tx pair and `height` is an
    // autoincrement row id, so `MAX(height)` is the newest *transaction*, not
    // the newest block's height. The tip is the block holding that row, and its
    // height is the lowest row id in it, which is what every listing reports.
    // Reading the maximum made the panel say "chain tip #21" for a block the
    // list beneath it called #20.
    prisma.$queryRaw<Array<{ height: number | null; at: Date | null }>>`
      SELECT MIN(height)::int AS height, MAX(time_stamp_tz) AS at
        FROM blocks
       WHERE header_hash = (
         SELECT header_hash FROM blocks ORDER BY height DESC LIMIT 1
       );`,

    prisma.$queryRaw<Array<{ at: Date | null }>>`
      SELECT MIN(time_stamp_tz) AS at FROM blocks;`,

    prisma.$queryRaw<Array<{ txs: bigint; blocks: bigint }>>`
      SELECT COUNT(*)::bigint AS txs,
             COUNT(DISTINCT header_hash)::bigint AS blocks
        FROM blocks
       WHERE time_stamp_tz >= ${start};`,

    // Interval between consecutive block closes. One row per block, so the
    // per-tx duplication in `blocks` cannot inflate the sample.
    prisma.$queryRaw<Array<{ p50: number | null; p95: number | null; n: bigint }>>`
      WITH per_block AS (
        SELECT header_hash, MAX(time_stamp_tz) AS closed_at
          FROM blocks
         WHERE time_stamp_tz >= ${start}
         GROUP BY header_hash
      ), gaps AS (
        SELECT EXTRACT(EPOCH FROM closed_at - LAG(closed_at) OVER (ORDER BY closed_at)) AS gap
          FROM per_block
      )
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY gap) AS p95,
             COUNT(gap)::bigint AS n
        FROM gaps WHERE gap IS NOT NULL;`,

    // Admission latency: first seen to terminal decision, for rows that reached
    // one. Rows still queued or validating have no latency yet and must not be
    // counted as fast ones.
    prisma.$queryRaw<Array<{ p50: number | null; p95: number | null; n: bigint }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM terminal_at - first_seen_at) * 1000) AS p50,
             percentile_cont(0.95) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM terminal_at - first_seen_at) * 1000) AS p95,
             COUNT(*)::bigint AS n
        FROM tx_admissions
       WHERE terminal_at IS NOT NULL AND terminal_at >= ${start};`,

    prisma.$queryRaw<Array<{ accepted: bigint; rejected: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE status = 'accepted')::bigint AS accepted,
             COUNT(*) FILTER (WHERE status = 'rejected')::bigint AS rejected
        FROM tx_admissions
       WHERE terminal_at IS NOT NULL AND terminal_at >= ${start};`,

    prisma.$queryRaw<Array<{ depth: bigint }>>`
      SELECT COUNT(*)::bigint AS depth
        FROM tx_admissions
       WHERE status IN ('queued', 'validating');`,

    // Settlement latency: block close to the node recording finalization. Only
    // finalized rows have a completed settlement to measure.
    //
    // Not windowed, matching the backlog counts directly below. Windowing this
    // one while counting finalizations over all time put "No data" beside
    // "8 settled" in the same panel, which reads as a broken explorer rather
    // than a quiet day. The same reasoning applies as for the backlog: how long
    // settlement takes on this node is a standing fact, and it does not stop
    // being true because nothing settled today.
    //
    // Non-positive durations are excluded. Every finalized row currently on
    // this node records `updated_at` five to eight minutes BEFORE
    // `block_end_time`, which yields a negative elapsed time. That is a data
    // problem in the node, not a fast settlement, and a panel that printed
    // "-7.8m" would be the confidently wrong figure this file exists to
    // prevent. Excluding them means the tile reads "No data" until the node
    // records timestamps that can be subtracted, which is the honest answer.
    prisma.$queryRaw<Array<{ p50: number | null; p95: number | null; n: bigint }>>`
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM updated_at - block_end_time) * 1000) AS p50,
             percentile_cont(0.95) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM updated_at - block_end_time) * 1000) AS p95,
             COUNT(*)::bigint AS n
        FROM pending_block_finalizations
       WHERE status = 'finalized'
         AND updated_at > block_end_time;`,

    // Backlog is a standing figure, not a windowed one: a block stuck for three
    // days is exactly what an operator needs to see, and a 24 hour filter would
    // hide it.
    prisma.$queryRaw<Array<{ finalized: bigint; pending: bigint; abandoned: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE status = 'finalized')::bigint AS finalized,
             COUNT(*) FILTER (WHERE status NOT IN ('finalized', 'abandoned'))::bigint AS pending,
             COUNT(*) FILTER (WHERE status = 'abandoned')::bigint AS abandoned
        FROM pending_block_finalizations;`,

    prisma.$queryRaw<
      Array<{ header_hash: Uint8Array; status: string; block_end_time: Date }>
    >`
      SELECT header_hash, status, block_end_time
        FROM pending_block_finalizations
       WHERE status NOT IN ('finalized', 'abandoned')
       ORDER BY block_end_time ASC
       LIMIT 1;`,

    prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status, COUNT(*)::bigint AS count
        FROM pending_block_finalizations
       GROUP BY status ORDER BY count DESC;`,

    prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count
        FROM tx_admissions
       WHERE first_seen_at >= ${start}
       GROUP BY status ORDER BY count DESC;`,

    // generate_series keeps empty hours in the result. Without it a quiet hour
    // would vanish and the chart would draw a straight line across an outage.
    prisma.$queryRaw<Array<{ hour: Date; blocks: bigint; txs: bigint }>>`
      WITH hours AS (
        SELECT generate_series(
          date_trunc('hour', ${start}::timestamptz),
          date_trunc('hour', ${end}::timestamptz),
          interval '1 hour') AS hour
      )
      SELECT h.hour,
             COALESCE(COUNT(DISTINCT b.header_hash), 0)::bigint AS blocks,
             COALESCE(COUNT(b.tx_id), 0)::bigint AS txs
        FROM hours AS h
        LEFT JOIN blocks AS b
          ON date_trunc('hour', b.time_stamp_tz) = h.hour
       GROUP BY h.hour
       ORDER BY h.hour ASC;`,
  ]);

  const tip = tipRows[0] ?? { height: null, at: null };
  const observedFrom = firstRows[0]?.at ?? null;
  const throughput = throughputRows[0] ?? { txs: 0n, blocks: 0n };
  const interval = intervalRows[0] ?? { p50: null, p95: null, n: 0n };
  const admissionLatency = admissionLatencyRows[0] ?? { p50: null, p95: null, n: 0n };
  const admissionCounts = admissionCountRows[0] ?? { accepted: 0n, rejected: 0n };
  const settlement = settlementRows[0] ?? { p50: null, p95: null, n: 0n };
  const finalityCounts = finalityCountRows[0] ?? {
    finalized: 0n,
    pending: 0n,
    abandoned: 0n,
  };
  const oldest = oldestRows[0] ?? null;

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
      height: num(tip.height),
      at: tip.at === null ? null : tip.at.toISOString(),
      ageSeconds:
        tip.at === null ? null : Math.max(0, Math.round((end.getTime() - tip.at.getTime()) / 1000)),
      source: "blocks.height, blocks.time_stamp_tz",
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
      source: "blocks.time_stamp_tz, blocks.header_hash",
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
      queueDepth: Number(queueRows[0]?.depth ?? 0n),
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
                Math.round((end.getTime() - oldest.block_end_time.getTime()) / 1000),
              ),
            },
      source: "pending_block_finalizations.status, pending_block_finalizations.block_end_time",
    },
    statusBreakdown: {
      finalization: finalizationBreakdown.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
      admission: admissionBreakdown.map((r) => ({ status: r.status, count: Number(r.count) })),
    },
    series: seriesRows.map((r) => ({
      hour: r.hour.toISOString(),
      blocks: Number(r.blocks),
      transactions: Number(r.txs),
    })),
  };
}
