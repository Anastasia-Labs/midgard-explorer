import type { MetricsResponse } from "@midgard-explorer/contracts";

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

export type HealthState = "healthy" | "degraded" | "stalled" | "unknown";

export type NetworkHealth = {
  state: HealthState;
  /** The sentence. This is the largest thing on the panel. */
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

export function networkHealth(metrics: MetricsResponse | null): NetworkHealth {
  if (metrics === null) {
    return {
      state: "unknown",
      headline: "The network's health cannot be judged right now.",
      reasons: ["Metrics are unavailable, so nothing below describes the chain."],
    };
  }

  const { tip, throughput, admission, finality } = metrics;
  const tipLabel =
    tip.height === null
      ? tip.headerHash === null
        ? "the latest header"
        : `${tip.headerHash.slice(0, 8)}…`
      : `#${tip.height}`;
  const p50 = throughput.blockIntervalSeconds.p50;
  const reasons: string[] = [];

  // Production. Judged first because nothing else matters if the chain has
  // stopped: settling a backlog perfectly while producing no blocks is not a
  // healthy network, and a verdict that said "healthy" there would be useless.
  if (tip.ageSeconds === null) {
    return {
      state: "unknown",
      headline: "The network's health cannot be judged right now.",
      reasons: ["No block has been recorded, so there is no tip to measure against."],
    };
  }

  if (p50 === null || p50 <= 0) {
    // No interval could be measured, which has three quite different causes.
    // Reporting them all as "not enough history" told a reader the chain was
    // too young to judge while the panel beside it read "All time: 6 blocks",
    // which is a contradiction and hid the real answer: the node had stopped.
    if (tip.headerHash === null) {
      return {
        state: "unknown",
        headline: "There is not enough history to judge the network yet.",
        reasons: ["No block has been produced, so there is nothing to measure."],
      };
    }

    if (throughput.blocks === 0) {
      // No reasons: the headline already says what happened, the chain tip
      // figure right below already gives the block and its age, and the
      // Cardano section further down the page speaks for itself instead of
      // being pre-announced here.
      return {
        state: "stalled",
        headline: "This Midgard node has stopped producing blocks.",
        reasons: [],
      };
    }

    return {
      state: "unknown",
      headline: "There is not enough history to judge the network's pace yet.",
      reasons: [
        `Only ${throughput.blocks} ${throughput.blocks === 1 ? "block has" : "blocks have"} arrived in the last ${metrics.window.hours} hours, so no interval between blocks has been measured yet.`,
        `The last one, ${tipLabel}, arrived ${seconds(tip.ageSeconds)} ago.`,
      ],
    };
  }

  const ratio = tip.ageSeconds / p50;

  if (ratio > STALLED_RATIO) {
    return {
      state: "stalled",
      headline: "Block production has stopped.",
      reasons: [
        `The last block arrived ${seconds(tip.ageSeconds)} ago, ${ratio.toFixed(1)} times this node's usual ${Math.round(p50)}s interval.`,
        ...settlementReasons(finality),
        ...admissionReasons(admission),
      ],
    };
  }

  if (ratio > SLOW_RATIO) {
    reasons.push(
      `The last block arrived ${seconds(tip.ageSeconds)} ago, ${ratio.toFixed(1)} times this node's usual ${Math.round(p50)}s interval.`,
    );
  }

  reasons.push(...settlementReasons(finality), ...admissionReasons(admission));

  if (reasons.length === 0) {
    return {
      state: "healthy",
      headline: "The network is producing blocks and settling them to Cardano.",
      reasons: [
        `Blocks arrive every ${Math.round(p50)}s and the last one was ${seconds(tip.ageSeconds)} ago.`,
        finality.pending > 0
          ? `${finality.pending} ${finality.pending === 1 ? "block is" : "blocks are"} waiting on Cardano, which is the normal state while settlement proceeds.`
          : "No block is waiting on Cardano.",
      ],
    };
  }

  return {
    state: "degraded",
    headline:
      ratio > SLOW_RATIO
        ? "The network is falling behind its usual pace."
        : "The network is producing blocks, but not everything is settling.",
    reasons,
  };
}

/** Settlement problems, worst first. Abandonment is the serious one: a block
 * that gave up on L1 is not going to settle later on its own. */
function settlementReasons(finality: MetricsResponse["finality"]): string[] {
  const out: string[] = [];
  const attempts = finality.finalized + finality.abandoned;

  if (attempts > 0) {
    const share = finality.abandoned / attempts;
    if (share > ABANDONED_SHARE) {
      out.push(
        `${finality.abandoned} of ${attempts} settlement attempts were abandoned (${pct(share)}). An abandoned block does not settle later by itself.`,
      );
    }
  }

  const oldest = finality.oldestUnsettled;
  const p95 = finality.settlementLatency.p95Ms;
  if (oldest !== null && p95 !== null && p95 > 0) {
    const waitedMs = oldest.waitingSeconds * 1000;
    if (waitedMs > p95 * 3) {
      out.push(
        `The oldest unsettled block has been waiting ${seconds(oldest.waitingSeconds)}, well past the ${seconds(p95 / 1000)} that 95% of blocks take.`,
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
