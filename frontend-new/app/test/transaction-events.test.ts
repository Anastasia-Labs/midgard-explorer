import { describe, expect, it } from "vitest";
import type { TransactionView } from "@midgard-explorer/contracts";
import { TXS } from "../e2e/fixtures/data.mjs";
import { invocationEmitter, scriptInvocations } from "../src/lib/transactionEvents";

const fixture = TXS.map((row) => row.transaction).find(
  (tx) => tx !== null && tx.witnesses.redeemers.length > 0,
) as unknown as TransactionView | undefined;

describe("transaction event evidence", () => {
  it("resolves a spend pointer through canonical input order", () => {
    expect(fixture).toBeDefined();
    const invocation = scriptInvocations(fixture!)[0];
    expect(invocation?.operation).toBe("Spend");
    expect(invocation?.emitter.kind).toBe("script");
    expect(invocation?.emitter.hash).toBe(
      [...fixture!.inputs].sort((a, b) => a.txId.localeCompare(b.txId) || a.index - b.index)[0]
        ?.resolved?.identity.payment.hash,
    );
  });

  it("does not guess an emitter for an undecoded pointer", () => {
    const emitter = invocationEmitter(fixture!, {
      cborHex: "80",
      tag: null,
      purpose: null,
      index: null,
      data: null,
      exUnits: null,
    });
    expect(emitter).toEqual({
      kind: "unresolved",
      hash: null,
      address: null,
      source: "Redeemer pointer did not decode.",
    });
  });
});
