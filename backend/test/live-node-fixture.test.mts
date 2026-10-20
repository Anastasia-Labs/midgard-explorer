import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  computeBalance,
  decodeTransaction,
  decodeTransactionSafe,
} from "../src/decode/transaction.js";
import { bigintStringify } from "../src/server/helpers.js";

// Offline regression tests over the captured live-node snapshot. They run the
// real decoder against real Midgard-native CBOR without a running node, and pin
// both the happy path and the documented genesis/CML-array-form limitation.
// findOutRef and the SQL spendability predicate need a database and belong to a
// later integration suite; here we feed computeBalance the fixture's outputs
// directly (every ledger row in this snapshot is spendable).

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures/live-node-2026-07-16.json"), "utf8"),
);

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, "hex"));

/**
 * The current encoding, captured from the live Preprod node on 2026-10-19.
 *
 * The 2026-07-16 transaction above predates fixed-width out-refs and the
 * current field preimages, and the pinned codec rejects it, so the
 * transaction cases read this capture. Its id is the one the node stored, so
 * the first case checks the decoder against the node rather than against
 * itself.
 */
const current = JSON.parse(
  readFileSync(join(here, "fixtures/live-node-2026-10-19.json"), "utf8"),
) as {
  transaction: { txId: string; cborHex: string };
  confirmedLedger: Array<{ outrefHex: string; outputHex: string; address: string }>;
};

describe("decodeTransaction (live-node fixture)", () => {
  it("recomputes the id the node stored for its committed transaction", async () => {
    const view = await decodeTransaction(hexToBytes(current.transaction.cborHex));
    expect(view.txId).toBe(current.transaction.txId);
    expect(view.inputs.length).toBeGreaterThan(0);
    expect(view.outputs.every((output) => output.state.status === "unknown")).toBe(true);
    expect(view.outputs.every((output) => output.identity.payment.hash.length === 56)).toBe(true);
    expect(view.requiredObservers).toEqual([]);
    // The one required signer is the payment key hash in the address the node
    // recorded for the output it left unspent: `a2 00 58 39`, a header byte, then the hash.
    const recorded = Buffer.from(current.confirmedLedger[0]!.outputHex, "hex");
    expect(view.requiredSigners).toEqual([recorded.subarray(5, 33).toString("hex")]);
    expect(view.auxiliaryDataHash).toBeNull();
    expect(view.capabilities.collateral.state).toBe("not_supported");
  });

  it("decodes each output to the address and bytes the node's ledger holds", async () => {
    const view = await decodeTransaction(hexToBytes(current.transaction.cborHex));
    for (const row of current.confirmedLedger) {
      const index = Buffer.from(row.outrefHex, "hex").readUInt16BE(36);
      expect(view.outputs[index]?.address).toBe(row.address);
    }
  });

  it("fails predictably on malformed CBOR instead of silently mis-decoding", async () => {
    const result = await decodeTransactionSafe(hexToBytes("deadbeef"));
    expect(result.transaction).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("marks produced outputs unspent only when the current ledger resolves them", async () => {
    const ledger = new Map(current.confirmedLedger.map((row) => [row.outrefHex, row]));
    const view = await decodeTransaction(
      hexToBytes(current.transaction.cborHex),
      async (outref) => {
        const row = ledger.get(Buffer.from(outref).toString("hex"));
        return row ? { address: row.address, output: hexToBytes(row.outputHex) } : null;
      },
    );
    const unspent = view.outputs.filter((output) => output.state.status === "unspent");
    expect(unspent.map((output) => output.index)).toEqual(
      current.confirmedLedger.map((row) => Buffer.from(row.outrefHex, "hex").readUInt16BE(36)),
    );
    expect(
      view.outputs.filter((output) => output.state.status !== "unspent")
        .every((output) => output.state.status === "not_in_current_ledger"),
    ).toBe(true);
  });
});

describe("computeBalance (native map-form + genesis CML array-form)", () => {
  const outputsByAddress = new Map<string, Uint8Array[]>();
  for (const row of fixture.mempoolLedger) {
    const list = outputsByAddress.get(row.address) ?? [];
    list.push(hexToBytes(row.outputHex));
    outputsByAddress.set(row.address, list);
  }

  for (const expected of fixture.expectedBalances) {
    it(`balances ${expected.address.slice(0, 20)}… (spendable=${expected.spendableUtxos}, undecoded=${expected.undecodedOutputs})`, async () => {
      const outputs = outputsByAddress.get(expected.address) ?? [];
      expect(outputs.length).toBe(expected.spendableUtxos);
      const { balance, undecodedOutputs } = await computeBalance(outputs);
      expect(undecodedOutputs).toBe(expected.undecodedOutputs);
      expect(bigintStringify(balance)).toEqual(expected.balance);
    });
  }

  it("skips a lone CML array-form output and reports it as undecoded", async () => {
    // outputHex beginning `82` is CML array form, which the native codec cannot decode.
    const arrayForm = fixture.mempoolLedger.find((r: { outputHex: string }) =>
      r.outputHex.startsWith("82"),
    );
    expect(arrayForm).toBeDefined();
    const { balance, undecodedOutputs } = await computeBalance([
      hexToBytes(arrayForm.outputHex),
    ]);
    expect(undecodedOutputs).toBe(1);
    expect(balance.lovelace).toBe(0n);
  });
});
