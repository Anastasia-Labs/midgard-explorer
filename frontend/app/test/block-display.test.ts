import { describe, expect, it } from "vitest";
import type { BlockResponse } from "@midgard-explorer/contracts";
import { blockForDisplay } from "../src/lib/blockDisplay";
import {
  blockCommitments,
  blockDa,
  blockEvents,
  blockFinalization,
  blockHeader,
  blockRows,
} from "../e2e/fixtures/data.mjs";

const block = {
  midgard: { deploymentId: "fixture" },
  header: blockHeader(10),
  rows: blockRows(10),
  da: blockDa(10),
  finalization: blockFinalization(10),
  commitments: blockCommitments(10),
  neighbours: { prev: null, next: null },
  events: blockEvents(10),
} as unknown as BlockResponse;

describe("the block JSON on the Raw tab", () => {
  const shown = blockForDisplay(block);

  it("keeps the block's own facts", () => {
    expect(shown.headerHash).toBe(block.header.header_hash);
    expect(shown.transactions).toHaveLength(block.rows.length);
    expect(shown.merkleRoots).toEqual(block.commitments);
  });

  it("lists transactions by id, not their full bodies", () => {
    for (const tx of shown.transactions) {
      expect(Object.keys(tx).sort()).toEqual(["fee", "txId"]);
    }
  });

  it("leaves out the explorer's plumbing", () => {
    for (const key of ["midgard", "cardano", "rows", "neighbours"]) {
      expect(Object.keys(shown), key).not.toContain(key);
    }
  });
});
