import type { L1Sync } from "@midgard-explorer/contracts";
import { describe, expect, it } from "vitest";
import { l1EmptyState } from "../src/lib/l1sync";

/** An empty L1 page is the one place the explorer can mislead without being
 * wrong: the same empty list means "the chain was quiet" and "nobody built the
 * index", and the page used to assert the second. These tests pin that each
 * state says what it actually knows, and that the unknown case asserts
 * neither. */

const sync = (state: L1Sync["state"], heights: readonly number[]): L1Sync => ({
  state,
  cursors: [
    { source: "l1", height: heights[0] ?? null },
    { source: "l1:mints", height: heights[1] ?? null },
    { source: "l1:rewards", height: heights[2] ?? null },
  ],
});

describe("l1EmptyState", () => {
  it("says the index was never built rather than blaming the chain", () => {
    const { title, hint } = l1EmptyState(sync("unbuilt", [0, 0, 0]));
    expect(title).toContain("has not been built");
    expect(hint).toContain("Nothing has been indexed yet");
  });

  it("names the cursor heights when a pass is incomplete", () => {
    const { title, hint } = l1EmptyState(sync("indexing", [5_120_000, 4_000_000, 0]));
    expect(title).toContain("still being built");
    expect(hint).toContain("l1 at 5120000");
    expect(hint).toContain("l1:mints at 4000000");
    expect(hint).toContain("l1:rewards at 0");
  });

  it("attributes an empty page to a quiet chain only when the index is current", () => {
    const { title, hint } = l1EmptyState(sync("reconciled", [5_120_000, 5_120_000, 5_120_000]));
    expect(title).toContain("No Cardano activity");
    expect(hint).toContain("chain being quiet");
  });

  it("asserts neither cause when the summary could not be read", () => {
    const { hint } = l1EmptyState(null);
    expect(hint).toContain("either");
    // The reassuring reading is the dangerous one, so it must not appear alone.
    expect(hint).not.toContain("chain being quiet.");
  });

  it("never tells a reader the index is current when it is not", () => {
    for (const state of ["unbuilt", "indexing"] as const) {
      expect(l1EmptyState(sync(state, [0, 0, 0])).hint).not.toContain("index is current");
    }
  });
});
