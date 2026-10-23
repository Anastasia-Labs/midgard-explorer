import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeTransaction } from "../src/decode/transaction.js";
import type { LedgerOutput } from "../src/db/ledger.js";

/**
 * One round trip for a transaction's inputs, not one per input.
 *
 * The decoder resolved each spend input and each reference input with its own
 * query. A transaction with twenty inputs cost twenty round trips to answer one
 * question, and a list page repeated that for every row. The count is asserted
 * rather than the timing, because a timing on a fixture with four inputs
 * measures the machine and not the change.
 *
 * `bulkLookup` changes cost and never meaning: the same resolution has to come
 * out either way, which is what the last case here checks.
 */

const txBytes = (() => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/live-node-2026-07-16.json", import.meta.url), "utf8"),
  ) as { transaction?: { cborHex?: string } };
  const hex = fixture.transaction?.cborHex;
  return hex ? Buffer.from(hex, "hex") : null;
})();

/** Counts how the decoder asked, without answering anything: an unresolved
 * input is a legitimate outcome and the shape of the call is what matters. */
function spy() {
  const calls = { single: 0, bulk: 0, outrefsRequested: 0 };
  return {
    calls,
    single: async (): Promise<LedgerOutput | null> => {
      calls.single += 1;
      return null;
    },
    bulk: async (outrefs: Uint8Array[]): Promise<Map<string, LedgerOutput>> => {
      calls.bulk += 1;
      calls.outrefsRequested += outrefs.length;
      return new Map();
    },
  };
}

describe("outref resolution", () => {
  it("has a transaction to decode, so this gate is not measuring nothing", () => {
    expect(txBytes, "the live-node fixture carries no transaction CBOR").not.toBeNull();
  });

  it("asks once per input when no bulk lookup is supplied", async () => {
    if (!txBytes) return;
    const s = spy();
    const view = await decodeTransaction(txBytes, s.single);
    // Inputs, reference inputs, AND every output, which is consulted to say
    // whether it has since been spent.
    const referenced = view.inputs.length + view.referenceInputs.length + view.outputs.length;
    expect(referenced).toBeGreaterThan(0);
    expect(s.calls.single).toBe(referenced);
    expect(s.calls.bulk).toBe(0);
  });

  /** The change. One call, carrying every outref the transaction names. */
  it("asks once in total when a bulk lookup is supplied", async () => {
    if (!txBytes) return;
    const s = spy();
    const view = await decodeTransaction(txBytes, s.single, {
      bulkLookup: s.bulk,
    });
    const referenced = view.inputs.length + view.referenceInputs.length + view.outputs.length;

    expect(s.calls.bulk).toBe(1);
    expect(s.calls.outrefsRequested).toBe(referenced);
    // And nothing fell through to a one-at-a-time query. A batch that was asked
    // about an outref and did not return it has answered "absent"; re-querying
    // would make a historical transaction, whose inputs are nearly all spent,
    // cost more than it did before batching.
    expect(s.calls.single).toBe(0);
  });

  /** Cost, not meaning. An unresolved input reads the same either way, so a
   * page cannot start showing different content because of a batch. */
  it("produces the same view with and without batching", async () => {
    if (!txBytes) return;
    const plain = await decodeTransaction(txBytes, spy().single);
    const batched = await decodeTransaction(txBytes, spy().single, {
      bulkLookup: spy().bulk,
    });
    expect(JSON.stringify(batched.inputs)).toBe(JSON.stringify(plain.inputs));
    expect(JSON.stringify(batched.referenceInputs)).toBe(JSON.stringify(plain.referenceInputs));
  });
});
