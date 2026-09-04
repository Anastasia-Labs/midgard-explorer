import { describe, expect, it } from "vitest";
import {
  decodeMidgardNativeByteListPreimage,
  decodeMidgardNativeTxFullFromCanonicalCbor,
  decodeMidgardTxOutput,
} from "@al-ft/midgard-core";
import { MAX_INLINE_CBOR_BYTES } from "../bench/profiles.mjs";
import { addressFor, buildOversizeTx, buildTx, loadCorpus } from "../bench/shapeTx.mjs";

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
  const spec = { inputs: 1, outputs: 2, assetsPerOutput: 0, addressIds: [1, 2] };

  it("produces bytes the decoder reads back", () => {
    const tx = buildTx(parts, spec);
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(tx.bytes));
    const outs = decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor);
    const ins = decodeMidgardNativeByteListPreimage(full.body.spendInputsPreimageCbor);
    expect(outs.length).toBe(2);
    expect(ins.length).toBe(1);
  });

  it("carries a 32-byte transaction id", () => {
    expect(buildTx(parts, spec).txId.length).toBe(32);
  });

  it("lands on the measured live size for the common shape", () => {
    // Live `immutable` p50 is 383 bytes, and 1-in-2-out is the common shape.
    // This is the corroboration the profile claims, asserted rather than
    // assumed: if the codec or the corpus changes, this is what says so.
    const size = buildTx(parts, spec).bytes.length;
    expect(Math.abs(size - 383)).toBeLessThan(40);
  });

  it("grows with the structure, monotonically", () => {
    const sizes = [
      buildTx(parts, { inputs: 1, outputs: 1, assetsPerOutput: 0, addressIds: [1] }),
      buildTx(parts, { inputs: 2, outputs: 3, assetsPerOutput: 0, addressIds: [1, 2, 3] }),
      buildTx(parts, {
        inputs: 12,
        outputs: 16,
        assetsPerOutput: 0,
        addressIds: Array.from({ length: 16 }, (_, i) => i),
      }),
    ].map((t) => t.bytes.length);
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
  });

  it("attaches native assets that survive the round trip", () => {
    const tx = buildTx(parts, {
      inputs: 1,
      outputs: 1,
      assetsPerOutput: 3,
      addressIds: [7],
    });
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
    const tx = buildTx(parts, spec);
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(tx.bytes));
    const outs = decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor);
    const written = outs.map((o) =>
      Buffer.from(decodeMidgardTxOutput(o).address).toString("hex"),
    );
    expect(tx.outputs.map((o) => Buffer.from(o.addressBytes).toString("hex"))).toEqual(
      written,
    );
    for (const o of tx.outputs) expect(o.address).toMatch(/^addr_test1/);
  });

  it("I10: the same spec produces the same bytes", () => {
    expect(Buffer.from(buildTx(parts, spec).bytes)).toEqual(
      Buffer.from(buildTx(parts, spec).bytes),
    );
  });
});

describe("buildOversizeTx", () => {
  it("crosses MAX_INLINE_CBOR_BYTES strictly, and still decodes", () => {
    // `>` and not `>=`: a transaction of exactly the cap does not truncate.
    const tx = buildOversizeTx(parts, MAX_INLINE_CBOR_BYTES);
    expect(tx.bytes.length).toBeGreaterThan(MAX_INLINE_CBOR_BYTES);
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(Buffer.from(tx.bytes));
    expect(
      decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor).length,
    ).toBeGreaterThan(0);
  });
});
