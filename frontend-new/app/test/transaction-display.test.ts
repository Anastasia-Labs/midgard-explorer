import { describe, expect, it } from "vitest";
import type { Association, TransactionWithMeta } from "@midgard-explorer/contracts";
import { transactionForDisplay } from "../src/lib/transactionDisplay";
import { TXS } from "../e2e/fixtures/data.mjs";

const row = TXS.find((item: { transaction: unknown }) => item.transaction !== null)!;
const tx = {
  ...row.transaction,
  cborHex: "84a4".repeat(400),
  cborTruncated: false,
} as unknown as TransactionWithMeta;

describe("the transaction JSON on the Raw tab", () => {
  const shown = transactionForDisplay({ tx, status: "committed", inclusion: null, cardano: null });

  it("keeps the transaction's own facts, the CBOR whole", () => {
    expect(shown.txId).toBe(tx.txId);
    expect(shown.fee).toBe(tx.fee);
    expect(shown.outputs).toHaveLength(tx.outputs.length);
    expect(shown.cborHex).toBe("84a4".repeat(400));
  });

  it("leaves out the explorer's plumbing", () => {
    for (const key of [
      "midgard",
      "admission",
      "finalization",
      "cardano",
      "capabilities",
      "formatVersion",
    ]) {
      expect(Object.keys(shown), key).not.toContain(key);
    }
    expect(JSON.stringify(shown)).not.toContain("addressKind");
  });

  it("names cborTruncated only when the hex is cut", () => {
    expect("cborTruncated" in shown).toBe(false);
    const cut = transactionForDisplay({
      tx: { ...tx, cborTruncated: true },
      status: "committed",
      inclusion: null,
      cardano: null,
    });
    expect(cut.cborTruncated).toBe(true);
  });

  it("states settlement as the L1 hash and the node's state", () => {
    const cardano = {
      l1TxHash: "ab".repeat(32),
      evidence: [
        {
          source: "midgard_finalization_journal",
          transactionHash: "ab".repeat(32),
          rawState: "finalized",
        },
      ],
    } as unknown as Association;
    const settled = transactionForDisplay({ tx, status: "committed", inclusion: null, cardano });
    expect(settled.settlement).toEqual({ l1TxHash: "ab".repeat(32), state: "finalized" });
  });
});
