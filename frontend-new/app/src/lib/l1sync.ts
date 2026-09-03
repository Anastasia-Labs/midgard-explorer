import type { L1Sync } from "@midgard-explorer/contracts";

/**
 * What an empty list of Cardano activity means.
 *
 * The L1 list routes answer 200 with an empty page whether the index holds no
 * activity or was never built, so the page used to guess: "if this is empty,
 * the indexer has not completed its first pass". That is right about half the
 * time, and wrong in the half where the index is current and the chain is
 * quiet. The summary reports which it is, and this turns that into what the
 * reader sees.
 *
 * A summary that could not be fetched gives `null`, and the wording falls back
 * to describing both possibilities rather than asserting either.
 */
export type EmptyState = { title: string; hint: string };

const behind = (sync: L1Sync): string => {
  const named = sync.cursors
    .map((cursor) => `${cursor.source} at ${cursor.height ?? 0}`)
    .join(", ");
  return named === "" ? "" : ` Cursors: ${named}.`;
};

export function l1EmptyState(sync: L1Sync | null | undefined): EmptyState {
  if (!sync) {
    return {
      title: "No Cardano activity to show",
      hint: "The index could not report its state, so this is either an index that has not been built or a chain with no activity at Midgard's validator addresses.",
    };
  }
  switch (sync.state) {
    case "unbuilt":
      return {
        title: "The Cardano index has not been built",
        hint: "Nothing has been indexed yet, so this page cannot show activity even if the chain has some. The indexer scans Cardano preprod for transactions at Midgard's validator addresses and records how far it has reached.",
      };
    case "indexing":
      return {
        title: "The Cardano index is still being built",
        hint: `The indexer has not finished a pass in which every source completed, so this page shows only part of the chain.${behind(sync)}`,
      };
    case "reconciled":
      return {
        title: "No Cardano activity in this range",
        hint: "The index is current and holds no transactions at Midgard's validator addresses here. This is the chain being quiet, not a gap in the index.",
      };
  }
}
