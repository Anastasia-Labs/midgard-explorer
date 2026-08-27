import { Schema } from "effect";
import { HexString, IsoTimestamp } from "./primitives";

/** Operational metrics for the overview.
 *
 * Two fields appear on almost everything here and both are load-bearing:
 *
 *   `source` names the node column a figure was derived from. It is in the
 *   contract rather than in a comment so the UI can show it, which is what
 *   makes a dashboard checkable instead of merely confident.
 *
 *   `sampleCount` accompanies every percentile. A p95 over six records is not
 *   a percentile in any useful sense, and the renderer needs the sample to
 *   decide whether to present the figure or to say the sample is too thin.
 */

export const Percentile = Schema.Struct({
  p50Ms: Schema.NullOr(Schema.Number),
  p95Ms: Schema.NullOr(Schema.Number),
  sampleCount: Schema.Number,
  source: Schema.String,
});
export type Percentile = Schema.Schema.Type<typeof Percentile>;

export const MetricsWindow = Schema.Struct({
  hours: Schema.Number,
  start: IsoTimestamp,
  end: IsoTimestamp,
  observedFrom: Schema.NullOr(IsoTimestamp),
  /** History is shorter than the window, so every windowed figure below
   * describes less time than its label. */
  partial: Schema.Boolean,
});
export type MetricsWindow = Schema.Schema.Type<typeof MetricsWindow>;

export const StatusCount = Schema.Struct({
  status: Schema.String,
  count: Schema.Number,
});
export type StatusCount = Schema.Schema.Type<typeof StatusCount>;

export const MetricsResponse = Schema.Struct({
  window: MetricsWindow,
  tip: Schema.Struct({
    headerHash: Schema.NullOr(HexString),
    height: Schema.NullOr(Schema.Number),
    at: Schema.NullOr(IsoTimestamp),
    ageSeconds: Schema.NullOr(Schema.Number),
    source: Schema.String,
  }),
  throughput: Schema.Struct({
    transactions: Schema.Number,
    blocks: Schema.Number,
    transactionsPerBlock: Schema.NullOr(Schema.Number),
    blockIntervalSeconds: Schema.Struct({
      p50: Schema.NullOr(Schema.Number),
      p95: Schema.NullOr(Schema.Number),
      sampleCount: Schema.Number,
    }),
    source: Schema.String,
  }),
  admission: Schema.Struct({
    latency: Percentile,
    accepted: Schema.Number,
    rejected: Schema.Number,
    /** Null when nothing reached a terminal decision: a rate over an empty
     * denominator is undefined, not zero. */
    rejectionRate: Schema.NullOr(Schema.Number),
    queueDepth: Schema.Number,
    source: Schema.String,
  }),
  finality: Schema.Struct({
    settlementLatency: Percentile,
    finalized: Schema.Number,
    pending: Schema.Number,
    abandoned: Schema.Number,
    oldestUnsettled: Schema.NullOr(
      Schema.Struct({
        headerHash: Schema.String,
        status: Schema.String,
        blockEndTime: IsoTimestamp,
        waitingSeconds: Schema.Number,
      }),
    ),
    source: Schema.String,
  }),
  statusBreakdown: Schema.Struct({
    finalization: Schema.Array(StatusCount),
    admission: Schema.Array(StatusCount),
  }),
  series: Schema.Array(
    Schema.Struct({
      hour: IsoTimestamp,
      blocks: Schema.Number,
      transactions: Schema.Number,
    }),
  ),
});
export type MetricsResponse = Schema.Schema.Type<typeof MetricsResponse>;

export const decodeMetrics = Schema.decodeUnknownSync(MetricsResponse);
