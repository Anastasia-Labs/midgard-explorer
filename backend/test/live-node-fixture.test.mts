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

describe("decodeTransaction (live-node fixture)", () => {
  it("decodes the committed transfer byte-for-byte into the expected view", async () => {
    const view = await decodeTransaction(
      hexToBytes(fixture.transaction.cborHex),
    );
    // bigintStringify matches the API's on-the-wire serialization (bigint -> string).
    // The captured subset remains byte-for-byte stable while newer,
    // evidence-bearing fields may extend the response.
    expect(bigintStringify(view)).toMatchObject(fixture.transaction.expectedView);
    expect(view.outputs.every((output) => output.state.status === "unknown")).toBe(true);
    expect(view.outputs.every((output) => output.identity.payment.hash.length === 56)).toBe(true);
    expect(view.requiredObservers).toEqual([]);
    expect(view.requiredSigners).toEqual([]);
    expect(view.auxiliaryDataHash).toBeNull();
    expect(view.capabilities.collateral.state).toBe("not_supported");
  });

  it("fails predictably on malformed CBOR instead of silently mis-decoding", async () => {
    const result = await decodeTransactionSafe(hexToBytes("deadbeef"));
    expect(result.transaction).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("marks produced outputs unspent only when the current ledger resolves them", async () => {
    const row = fixture.mempoolLedger.find(
      (candidate: { outputHex: string }) => !candidate.outputHex.startsWith("82"),
    );
    expect(row).toBeDefined();
    const view = await decodeTransaction(
      hexToBytes(fixture.transaction.cborHex),
      async () => ({
        address: row.address,
        output: hexToBytes(row.outputHex),
      }),
    );
    expect(view.outputs.every((output) => output.state.status === "unspent")).toBe(true);
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
