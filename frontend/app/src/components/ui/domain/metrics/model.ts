/**
 * What the operations panel knows before it draws anything.
 *
 * The rule that shapes the whole panel lives here: a figure is only worth
 * showing if a reader can tell how much to trust it. These are the thresholds
 * and tones that decide how a number is presented, kept apart from the drawing
 * so they can be read, changed and tested without opening a chart.
 */

import type { MetricsResponse } from "@midgard-explorer/contracts";
import { production } from "../../../../lib/health";

export const VERDICT_TONE = {
  healthy: { text: "text-success", dot: "bg-success" },
  idle: { text: "text-text-2", dot: "bg-text-3" },
  degraded: { text: "text-warning", dot: "bg-warning" },
  stalled: { text: "text-danger", dot: "bg-danger" },
  unknown: { text: "text-text-2", dot: "bg-text-3" },
} as const;

/** The tip's colour, from the same production judgement as the verdict. An old
 * tip is only late when work is waiting for a block, and lateness is measured
 * against this node's own gap between blocks rather than a fixed threshold. The
 * verdict beside the tip says why, so the colour carries no note of its own. */
export function tipTone(metrics: MetricsResponse): "success" | "warning" | "danger" | "neutral" {
  const made = production(metrics);
  switch (made.state) {
    case "none":
    case "idle":
    case "unmeasured":
      return "neutral";
    case "current":
      return made.tipAge / made.p50 <= 2 ? "success" : "neutral";
    case "overdue":
    case "stalled":
      return "danger";
    case "slow":
      return "warning";
  }
}
