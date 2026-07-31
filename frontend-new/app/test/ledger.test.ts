import { describe, expect, it } from "vitest";
import type { TransactionView } from "@midgard-explorer/contracts";
import { addressDeltas, ledgerEquation } from "../src/lib/ledger";

const A = "addr_test_a";
const B = "addr_test_b";

const value = (lovelace: string) => ({ lovelace, assets: {} });

const tx = (over: {
  fee: string;
  inputs: Array<{ address: string; lovelace: string } | null>;
  outputs: Array<{ address: string; lovelace: string }>;
}): TransactionView =>
  ({
    txId: "aa".repeat(32),
    fee: over.fee,
    inputs: over.inputs.map((i, index) => ({
      txId: "bb".repeat(32),
      index,
      resolved: i === null ? null : { address: i.address, value: value(i.lovelace) },
    })),
    outputs: over.outputs.map((o) => ({
      address: o.address,
      value: value(o.lovelace),
      hasDatum: false,
      hasScriptRef: false,
    })),
    referenceInputs: [],
  }) as unknown as TransactionView;

describe("the ledger equation", () => {
  it("states inputs = outputs + fee when every input resolved", () => {
    const eq = ledgerEquation(
      tx({
        fee: "170000",
        inputs: [{ address: A, lovelace: "10000000" }],
        outputs: [
          { address: B, lovelace: "6000000" },
          { address: A, lovelace: "3830000" },
        ],
      }),
    );
    expect(eq.kind).toBe("balanced");
    if (eq.kind !== "balanced") return;
    expect(eq.inputs).toBe(10_000_000n);
    expect(eq.outputs + eq.fee).toBe(eq.inputs);
  });

  it("refuses to state a total when an input did not resolve", () => {
    // Summing only the inputs that survived produces a figure that looks like
    // a total and is not one. This is the common case: a transaction's inputs
    // leave the ledger the moment it is applied.
    const eq = ledgerEquation(
      tx({
        fee: "170000",
        inputs: [{ address: A, lovelace: "10000000" }, null],
        outputs: [{ address: B, lovelace: "6000000" }],
      }),
    );
    expect(eq.kind).toBe("incomplete");
    if (eq.kind !== "incomplete") return;
    expect(eq.unresolvedCount).toBe(1);
    expect(eq.resolvedCount).toBe(1);
    expect(eq).not.toHaveProperty("inputs");
  });

  it("surfaces a mismatch rather than hiding it", () => {
    const eq = ledgerEquation(
      tx({
        fee: "170000",
        inputs: [{ address: A, lovelace: "10000000" }],
        outputs: [{ address: B, lovelace: "9000000" }],
      }),
    );
    expect(eq.kind).toBe("unbalanced");
    if (eq.kind !== "unbalanced") return;
    expect(eq.difference).toBe(-830_000n);
  });

  it("handles amounts past the safe integer range exactly", () => {
    const big = "9007199254740993"; // 2^53 + 1
    const eq = ledgerEquation(
      tx({
        fee: "1",
        inputs: [{ address: A, lovelace: big }],
        outputs: [{ address: B, lovelace: "9007199254740992" }],
      }),
    );
    expect(eq.kind).toBe("balanced");
  });
});

describe("per-address movement", () => {
  it("marks deltas exact only when every input resolved", () => {
    const exact = addressDeltas(
      tx({
        fee: "170000",
        inputs: [{ address: A, lovelace: "10000000" }],
        outputs: [{ address: B, lovelace: "9830000" }],
      }),
    );
    expect(exact.every((d) => d.exact)).toBe(true);

    const partial = addressDeltas(
      tx({
        fee: "170000",
        inputs: [{ address: A, lovelace: "10000000" }, null],
        outputs: [{ address: B, lovelace: "9830000" }],
      }),
    );
    // A net figure for an address that may also have spent through the
    // unresolved input is not a smaller truth; it is a wrong one.
    expect(partial.every((d) => d.exact)).toBe(false);
  });

  it("nets an address that both spent and received", () => {
    const deltas = addressDeltas(
      tx({
        fee: "170000",
        inputs: [{ address: A, lovelace: "10000000" }],
        outputs: [
          { address: A, lovelace: "3830000" },
          { address: B, lovelace: "6000000" },
        ],
      }),
    );
    const a = deltas.find((d) => d.address === A)!;
    expect(a.spent).toBe(10_000_000n);
    expect(a.received).toBe(3_830_000n);
    expect(a.received - a.spent).toBe(-6_170_000n);
  });

  it("orders by net movement so the largest gain reads first", () => {
    const deltas = addressDeltas(
      tx({
        fee: "170000",
        inputs: [{ address: A, lovelace: "10000000" }],
        outputs: [
          { address: A, lovelace: "3830000" },
          { address: B, lovelace: "6000000" },
        ],
      }),
    );
    expect(deltas[0]!.address).toBe(B);
  });
});
