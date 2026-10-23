import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeMidgardNativeTxFullFromCanonicalCbor,
  encodeCbor,
  encodeMidgardFieldPreimage,
  encodeMidgardNativeTxCanonical,
  encodeMidgardRedeemerWitnessItem,
} from "@al-ft/midgard-core";
import { decodeTransaction } from "../src/decode/transaction.js";

/**
 * A redeemer witness item is `84 <purpose> <index> <redeemer as bytes> 82 <mem> <steps>`.
 *
 * The redeemer data travels as a byte string holding its own CBOR. The
 * explorer read the item as Cardano's `[tag, index, data, [mem, steps]]`, so
 * the data came out as raw bytes. No corpus transaction carries a redeemer,
 * which is why nothing caught it: this one is built with core's own encoder.
 */

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/shape-corpus.json", import.meta.url), "utf8"),
) as { entries: Array<{ label: string; canonicalTxHex: string }> };
const base = decodeMidgardNativeTxFullFromCanonicalCbor(
  Buffer.from(corpus.entries.find((e) => e.label === "multi-input")!.canonicalTxHex, "hex"),
);

const withRedeemer = Buffer.from(
  encodeMidgardNativeTxCanonical({
    version: base.version,
    validity: base.validity,
    body: base.body,
    witnessSet: {
      ...base.witnessSet,
      redeemerTxWitsPreimageCbor: encodeMidgardFieldPreimage([
        encodeMidgardRedeemerWitnessItem({
          purpose: "Mint",
          index: 0n,
          redeemerCbor: Buffer.from(encodeCbor(42n)),
          executionUnits: { memory: 1_000_000n, steps: 500_000_000n },
        }),
      ]),
    },
  }),
);

describe("redeemer witness items", () => {
  it("decode into purpose, index, data and execution units", async () => {
    const view = await decodeTransaction(withRedeemer);
    expect(view.witnesses.redeemerCount).toBe(1);
    const [redeemer] = view.witnesses.redeemers;
    expect(redeemer).toMatchObject({ tag: 1, purpose: "mint", index: 0 });
    expect(String(redeemer!.data)).toBe("42");
    expect(redeemer!.exUnits).toEqual({ mem: 1_000_000n, steps: 500_000_000n });
  });
});
