import { describe, expect, it } from "vitest";
import { transactionStatus } from "../src/db/transactionStatus.js";

/**
 * The one derivation the three routes share.
 *
 * Written as a table because the value of sharing it is that the table is the
 * whole answer: a fourth caller reads these cases rather than the ternary it
 * would otherwise copy.
 */
describe("transactionStatus", () => {
  it.each([
    ["immutable", false, "committed"],
    ["journal", false, "committed"],
    ["processed_mempool", false, "pending_commit"],
    ["mempool", false, "accepted"],
  ] as const)("reads tier %s as %s", (source, hasHeaderHash, expected) => {
    expect(transactionStatus({ source, hasHeaderHash })).toBe(expected);
  });

  /* The address route's extra condition: a history row in a block is
   * committed whatever tier its payload was found in. */
  it("treats a header hash as committed, whatever the tier says", () => {
    expect(transactionStatus({ source: "mempool", hasHeaderHash: true })).toBe("committed");
    expect(transactionStatus({ source: "", hasHeaderHash: true })).toBe("committed");
  });

  /* The branch that replaced a dead one. The transactions list used to key on
   * a `committed` column the query wrote as the literal `true`, so its
   * `pending_commit` branch could not be reached; a tier nobody has heard of
   * now reads as unknown rather than as the friendliest neighbour. */
  it.each(["", "some_future_tier", "IMMUTABLE"])("reads %o as unknown", (source) => {
    expect(transactionStatus({ source })).toBe("unknown");
  });
});
