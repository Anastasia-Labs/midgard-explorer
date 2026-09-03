/**
 * What the operations panel knows before it draws anything.
 *
 * The rule that shapes the whole panel lives here: a figure is only worth
 * showing if a reader can tell how much to trust it. These are the thresholds
 * and tones that decide how a number is presented, kept apart from the drawing
 * so they can be read, changed and tested without opening a chart.
 */

/** Below this, a percentile is a description of a handful of records rather
 * than a distribution, and the UI says so instead of implying otherwise. */
export const THIN_SAMPLE = 20;

export const VERDICT_TONE = {
  healthy: { text: "text-success", dot: "bg-success" },
  degraded: { text: "text-warning", dot: "bg-warning" },
  stalled: { text: "text-danger", dot: "bg-danger" },
  unknown: { text: "text-text-2", dot: "bg-text-3" },
} as const;

/** Tip age against the observed block interval. A fixed threshold would be
 * wrong on any chain whose cadence differs from the one it was written for, so
 * lateness is judged against what this node actually does. */
export function tipTone(
  ageSeconds: number | null,
  p50: number | null,
): { tone: "success" | "warning" | "danger" | "neutral"; note: string } {
  if (ageSeconds === null) return { tone: "neutral", note: "No blocks recorded" };
  if (p50 === null || p50 <= 0) {
    return { tone: "neutral", note: "No interval measured yet, so lateness cannot be judged" };
  }
  const ratio = ageSeconds / p50;
  if (ratio <= 2) return { tone: "success", note: `Within the usual ${Math.round(p50)}s cadence` };
  if (ratio <= 5) {
    return { tone: "warning", note: `${ratio.toFixed(1)}× the usual ${Math.round(p50)}s cadence` };
  }
  return { tone: "danger", note: `${ratio.toFixed(1)}× the usual ${Math.round(p50)}s cadence` };
}
