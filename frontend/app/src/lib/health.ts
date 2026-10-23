import type { MetricsResponse } from "@midgard-explorer/contracts";
import { formatDuration } from "./format";

/** One stated judgement about the network, so the overview answers rather than
 * displays.
 *
 * Every record page in this explorer leads with a plain-English outcome. The
 * overview was the exception: it showed five figures of equal weight under a
 * heading reading "Network health" and never said whether health was good. A
 * reader had to know that 43s of settlement latency is fine and that a 33%
 * abandonment rate is not, which is exactly the knowledge someone arriving at
 * an explorer does not have.
 *
 * Two rules keep this from becoming a decorative traffic light:
 *
 *   1. Every threshold is relative to what this node actually does, not to a
 *      constant. A chain with a 2 second cadence and a chain with a 20 second
 *      cadence are both healthy at their own pace, and a fixed "late after 60s"
 *      would be wrong on both.
 *   2. Every reason carries the figure it was drawn from. The verdict is a
 *      claim, and a claim a reader cannot check is worth less than the number
 *      it replaced. Disagreeing with the judgement should be easy.
 */

export type HealthState = "healthy" | "idle" | "degraded" | "stalled" | "unknown";

export type NetworkHealth = {
  state: HealthState;
  /** Summary of the observed activity. */
  headline: string;
  /** Supporting facts, each naming the figure behind it, worst first. */
  reasons: string[];
};

/** A block is late once it is this many times the observed median interval. */
const SLOW_RATIO = 2;
const STALLED_RATIO = 5;
/** Share of settlement attempts that gave up before a reader should worry. */
const ABANDONED_SHARE = 0.1;
/** Share of admission decisions that were rejections. */
const REJECTION_SHARE = 0.2;

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const seconds = (n: number) =>
  n < 60 ? `${Math.round(n)}s` : n < 3600 ? `${Math.round(n / 60)}m` : `${(n / 3600).toFixed(1)}h`;

const WAITING_NOUNS = [
  ["transactions", "transaction", "transactions"],
  ["deposits", "deposit", "deposits"],
  ["withdrawals", "withdrawal", "withdrawals"],
  ["forcedTransactions", "forced transaction", "forced transactions"],
] as const;

/** What is waiting for a block. `parts` is the breakdown by kind ("4
 * transactions", "1 withdrawal"); `noun` names the whole: the kind when there
 * is one, "items" when kinds are mixed. */
export function waitingPhrase(waiting: MetricsResponse["waiting"]): {
  count: number;
  noun: string;
  parts: string[];
} {
  const present = WAITING_NOUNS.filter(([key]) => waiting[key] > 0);
  const parts = present.map(
    ([key, one, many]) => `${waiting[key]} ${waiting[key] === 1 ? one : many}`,
  );
  const count = WAITING_NOUNS.reduce((sum, [key]) => sum + waiting[key], 0);
  const noun = present.length === 1 ? (count === 1 ? present[0]![1] : present[0]![2]) : "items";
  return { count, noun, parts };
}

/**
 * Whether blocks are coming when they should.
 *
 * The node makes a block only when something waits for one: a transaction in
 * its mempool, or a bridge event that has fallen due. An old tip therefore says
 * nothing on its own. With nothing waiting the chain is idle; with work waiting
 * longer than the node's usual gap between blocks, it is late. The overview's
 * verdict and its chain tip figure both read this, so they cannot disagree.
 */
export type Production =
  | { state: "none" }
  | ({ state: "current"; p50: number; tipAge: number; waited: number } & Waiting)
  | { state: "idle"; tipAge: number }
  | ({ state: "unmeasured"; waited: number } & Waiting)
  /** Work has waited longer than the whole window and no block came in it.
   * Late with no cadence to compare against, because none is needed. */
  | ({ state: "overdue"; waited: number } & Waiting)
  | ({
      state: "slow" | "stalled";
      p50: number;
      tipAge: number;
      waited: number;
      ratio: number;
    } & Waiting);

type Waiting = { count: number; noun: string; parts: string[] };

export function production(metrics: MetricsResponse): Production {
  const { tip, throughput, waiting, window: w } = metrics;
  if (tip.ageSeconds === null || tip.headerHash === null) return { state: "none" };
  const p50 = throughput.blockIntervalSeconds.p50;
  const measured = p50 !== null && p50 > 0;
  const work = waitingPhrase(waiting);
  const { count } = work;
  const waited =
    waiting.since === null
      ? 0
      : Math.max(0, Math.round((Date.parse(w.end) - Date.parse(waiting.since)) / 1000));

  if (count === 0) {
    return measured && tip.ageSeconds / p50 <= SLOW_RATIO
      ? { state: "current", p50, tipAge: tip.ageSeconds, waited, ...work }
      : { state: "idle", tipAge: tip.ageSeconds };
  }
  if (!measured) {
    return throughput.blocks === 0 && waited > w.hours * 3600
      ? { state: "overdue", waited, ...work }
      : { state: "unmeasured", waited, ...work };
  }

  const ratio = waited / p50;
  if (ratio > STALLED_RATIO) {
    return { state: "stalled", p50, tipAge: tip.ageSeconds, waited, ratio, ...work };
  }
  if (ratio > SLOW_RATIO) {
    return { state: "slow", p50, tipAge: tip.ageSeconds, waited, ratio, ...work };
  }
  return { state: "current", p50, tipAge: tip.ageSeconds, waited, ...work };
}

/** "4 withdrawals awaiting a block · oldest 1d 2h". The duration is the
 * oldest wait, so it says "oldest" whenever more than one item waits. */
const awaiting = (made: { waited: number } & Waiting) =>
  `${made.count} ${made.noun} awaiting a block · ${made.count > 1 ? "oldest " : ""}${formatDuration(made.waited * 1000)}`;

/** The breakdown by kind, shown only when kinds are mixed. */
const breakdown = (made: Waiting) => (made.parts.length > 1 ? [made.parts.join(" · ")] : []);

const NOTHING_WAITING = "Nothing awaiting a block";

export function networkHealth(metrics: MetricsResponse | null): NetworkHealth {
  if (metrics === null) {
    return { state: "unknown", headline: "Figures unavailable", reasons: [] };
  }

  const { admission, finality } = metrics;
  const made = production(metrics);
  const trouble = [...settlementReasons(finality), ...admissionReasons(admission)];

  // One shape for every state: what awaits a block and for how long. A state
  // word leads whenever something is wrong, so a problem never rests on the
  // dot's colour or on the second line alone, and "late" is claimed rather than
  // "stopped", which the figures cannot show.
  switch (made.state) {
    case "none":
      return { state: "unknown", headline: "No blocks yet", reasons: [] };
    case "unmeasured":
      return {
        state: "unknown",
        headline: awaiting(made),
        reasons: [
          ...breakdown(made),
          `Too early to judge: ${metrics.throughput.blocks} ${
            metrics.throughput.blocks === 1 ? "block" : "blocks"
          } in ${metrics.window.hours}h, so there is no gap between blocks to compare.`,
        ],
      };
    case "stalled":
    case "overdue":
      return {
        state: "stalled",
        headline: `Overdue · ${awaiting(made)}`,
        reasons: [...breakdown(made), ...trouble],
      };
    case "slow":
      return {
        state: "degraded",
        headline: `Slow · ${awaiting(made)}`,
        reasons: [...breakdown(made), ...trouble],
      };
    case "idle":
      return trouble.length === 0
        ? { state: "idle", headline: NOTHING_WAITING, reasons: [] }
        : { state: "degraded", headline: `Degraded · ${NOTHING_WAITING}`, reasons: trouble };
    case "current": {
      const line = made.count === 0 ? NOTHING_WAITING : awaiting(made);
      return {
        state: trouble.length === 0 ? "healthy" : "degraded",
        headline: trouble.length === 0 ? line : `Degraded · ${line}`,
        reasons: [...breakdown(made), ...trouble],
      };
    }
  }
}

/** Settlement problems, worst first. Abandonment is the serious one. Since
 * Midgard f4cf28ca1 the node revives an abandoned block whose commit later
 * lands on its state queue, but never one a correction removed. */
function settlementReasons(finality: MetricsResponse["finality"]): string[] {
  const out: string[] = [];
  const attempts = finality.finalized + finality.abandoned;

  if (attempts > 0) {
    const share = finality.abandoned / attempts;
    if (share > ABANDONED_SHARE) {
      out.push(
        `${finality.abandoned} of ${attempts} settlement attempts abandoned (${pct(share)})`,
      );
    }
  }

  const oldest = finality.oldestUnsettled;
  const p95 = finality.settlementLatency.p95Ms;
  if (oldest !== null && p95 !== null && p95 > 0) {
    const waitedMs = oldest.waitingSeconds * 1000;
    if (waitedMs > p95 * 3) {
      out.push(
        `Oldest unsettled block waiting ${seconds(oldest.waitingSeconds)} (95% settle within ${seconds(p95 / 1000)})`,
      );
    }
  }

  return out;
}

function admissionReasons(admission: MetricsResponse["admission"]): string[] {
  const out: string[] = [];
  if (admission.rejectionRate !== null && admission.rejectionRate > REJECTION_SHARE) {
    out.push(
      `${pct(admission.rejectionRate)} of transactions that reached a decision were rejected (${admission.rejected} of ${admission.accepted + admission.rejected}).`,
    );
  }
  return out;
}
