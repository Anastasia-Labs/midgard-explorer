import { describe, expect, it } from "vitest";
import {
  decodeMidgardNativeByteListPreimage,
  decodeMidgardNativeTxFullFromCanonicalCbor,
  decodeMidgardTxOutput,
} from "@al-ft/midgard-core";
import { MAX_INLINE_CBOR_BYTES } from "../bench/profiles.mjs";
import {
  addressFor,
  buildOversizeTx,
  buildTx,
  loadCorpus,
  makeOutput,
  outrefOf,
} from "../bench/shapeTx.mjs";

/**
 * I8: transaction bytes are codec-produced and codec-readable.
 *
 * The seed must not be able to describe a transaction the decoder would reject,
 * so every assertion here decodes what the builder encoded rather than trusting
 * the builder's own account of it.
 */

const parts = loadCorpus();

describe("addressFor", () => {
  it("produces distinct, well-formed addresses per id", () => {
    const seen = new Set<string>();
    for (let id = 0; id < 500; id += 1) {
      const a = addressFor(parts, id);
      expect(a.length).toBe(parts.addressLength);
      seen.add(Buffer.from(a).toString("hex"));
    }
    expect(seen.size).toBe(500);
  });

  it("is deterministic", () => {
    expect(Buffer.from(addressFor(parts, 42))).toEqual(
      Buffer.from(addressFor(parts, 42)),
    );
  });
});

describe("buildTx", () => {
  const FEE = 200_000n;
  const inputs = [outrefOf(Buffer.alloc(32, 1), 0)];
  const outputs = [
    makeOutput(parts, { addressId: 1, lovelace: 4_000_000n }),
    makeOutput(parts, { addressId: 2, lovelace: 3_800_000n }),
  ];

  it("produces bytes the decoder reads back", () => {
    const tx = buildTx(parts, inputs, outputs, FEE);
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(tx.bytes));
    expect(
      decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor).length,
    ).toBe(2);
    expect(
      decodeMidgardNativeByteListPreimage(full.body.spendInputsPreimageCbor).length,
    ).toBe(1);
  });

  it("carries a 32-byte transaction id", () => {
    expect(buildTx(parts, inputs, outputs, FEE).txId.length).toBe(32);
  });

  it("refuses a duplicate input inside one transaction", () => {
    // The defect this replaces: cycling two templates put the same outref in a
    // transaction twice, and `outref` is the ledger tables' primary key.
    const same = outrefOf(Buffer.alloc(32, 2), 0);
    expect(() => buildTx(parts, [same, same], outputs, FEE)).toThrow(
      /duplicate input/,
    );
  });

  it("writes the fee it was given, so value can balance", () => {
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(
      Buffer.from(buildTx(parts, inputs, outputs, FEE).bytes),
    );
    expect(full.body.fee).toBe(FEE);
  });

  it("lands on the measured live size for the common shape", () => {
    // Live `immutable` p50 is 383 bytes, and 1-in-2-out is the common shape.
    // This is the corroboration the profile claims, asserted rather than
    // assumed: if the codec or the corpus changes, this is what says so.
    const size = buildTx(parts, inputs, outputs, FEE).bytes.length;
    expect(Math.abs(size - 383)).toBeLessThan(40);
  });

  it("grows with the structure, monotonically", () => {
    const at = (ins: number, outs: number) =>
      buildTx(
        parts,
        Array.from({ length: ins }, (_, i) => outrefOf(Buffer.alloc(32, 3), i)),
        Array.from({ length: outs }, (_, i) =>
          makeOutput(parts, { addressId: i, lovelace: 2_000_000n }),
        ),
        FEE,
      ).bytes.length;
    expect(at(1, 1)).toBeLessThan(at(2, 3));
    expect(at(2, 3)).toBeLessThan(at(12, 16));
  });

  it("attaches native assets that survive the round trip", () => {
    const tx = buildTx(
      parts,
      inputs,
      [makeOutput(parts, { addressId: 7, lovelace: 5_000_000n, assetIds: [1, 2, 3] })],
      FEE,
    );
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(tx.bytes));
    const [out] = decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor);
    const decoded = decodeMidgardTxOutput(out);
    // Assets nest: policy id, then asset name. Count the leaves, since a
    // policy holding several names is one outer entry and three assets.
    let leaves = 0;
    for (const names of decoded.value.assets.values()) leaves += names.size;
    expect(leaves).toBe(3);
  });

  it("reports the addresses it actually wrote", () => {
    const tx = buildTx(parts, inputs, outputs, FEE);
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(tx.bytes));
    const written = decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor)
      .map((o) => Buffer.from(decodeMidgardTxOutput(o).address).toString("hex"));
    expect(tx.outputs.map((o) => Buffer.from(o.addressBytes).toString("hex"))).toEqual(
      written,
    );
    for (const o of tx.outputs) expect(o.address).toMatch(/^addr_test1/);
  });

  it("I10: the same inputs produce the same bytes", () => {
    expect(Buffer.from(buildTx(parts, inputs, outputs, FEE).bytes)).toEqual(
      Buffer.from(buildTx(parts, inputs, outputs, FEE).bytes),
    );
  });
});

describe("buildOversizeTx", () => {
  it("crosses MAX_INLINE_CBOR_BYTES strictly, and still decodes", () => {
    // `>` and not `>=`: a transaction of exactly the cap does not truncate.
    const tx = buildOversizeTx(
      parts,
      MAX_INLINE_CBOR_BYTES,
      [outrefOf(Buffer.alloc(32, 9), 0)],
      900_000_000_000n,
      200_000n,
    );
    expect(tx.bytes.length).toBeGreaterThan(MAX_INLINE_CBOR_BYTES);
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(tx.bytes));
    expect(
      decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor).length,
    ).toBeGreaterThan(0);
  });
});
