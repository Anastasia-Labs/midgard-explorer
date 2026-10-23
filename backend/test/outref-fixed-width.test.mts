import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeMidgardNativeByteListPreimage,
  decodeMidgardNativeTxFullFromCanonicalCbor,
  encodeMidgardSpendInputItem,
} from "@al-ft/midgard-core";
import { decodeTransaction, decodeUtxos } from "../src/decode/transaction.js";

/**
 * Out-refs are a fixed 38 bytes: `82 58 20 <tx id> 19 <index, big-endian u16>`.
 *
 * Midgard writes the index in the two-byte form even when it is small, which a
 * strict generic CBOR decoder rejects as non-minimal. The explorer read every
 * out-ref that way, so on the live node each UTxO lost its transaction and
 * index, and every transaction body failed to decode.
 */

const corpus = JSON.parse(
  readFileSync(new URL("./fixtures/shape-corpus.json", import.meta.url), "utf8"),
) as { entries: Array<{ label: string; canonicalTxHex: string }> };
const multiInput = corpus.entries.find((e) => e.label === "multi-input")!;
const txBytes = Buffer.from(multiInput.canonicalTxHex, "hex");

const TX_ID = Buffer.alloc(32, 0xab);
const outref = (index: number) =>
  encodeMidgardSpendInputItem({ txId: TX_ID, outputIndex: index });

describe("fixed-width out-refs", () => {
  it("are 38 bytes with a two-byte index, as Midgard writes them", () => {
    const item = outref(1);
    expect(item.length).toBe(38);
    expect(item.subarray(35).toString("hex")).toBe("190001");
  });

  it("give each UTxO its transaction and index", async () => {
    const full = decodeMidgardNativeTxFullFromCanonicalCbor(txBytes);
    const [output] = decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor);
    const [utxo] = await decodeUtxos([{ outref: outref(1), output: output! }]);
    expect(utxo!.txId).toBe(TX_ID.toString("hex"));
    expect(utxo!.index).toBe(1);
  });

  it("decode a transaction's inputs", async () => {
    const view = await decodeTransaction(txBytes);
    expect(view.inputs.length).toBeGreaterThanOrEqual(2);
    for (const input of view.inputs) {
      expect(input.txId).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(input.index)).toBe(true);
    }
  });

  it("key the lookup of a transaction's own outputs in the ledger's form", async () => {
    const asked: Uint8Array[] = [];
    // The batch is consulted only alongside a single lookup.
    const view = await decodeTransaction(txBytes, async () => null, {
      bulkLookup: async (outrefs) => {
        asked.push(...outrefs);
        return new Map();
      },
    });
    const own = view.outputs.map((o) =>
      encodeMidgardSpendInputItem({
        txId: Buffer.from(view.txId, "hex"),
        outputIndex: o.index,
      }).toString("hex"),
    );
    const keys = asked.map((k) => Buffer.from(k).toString("hex"));
    for (const key of own) expect(keys).toContain(key);
  });
});
