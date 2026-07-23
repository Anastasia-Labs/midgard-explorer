import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decodeTransaction } from "../src/decode/transaction.js";

// Codec-compatibility corpus: emulator-built Conway transactions of the shapes
// the live node has never produced, converted to Midgard-native canonical CBOR
// by the vendored codec (see scripts/generate-shape-fixtures.mjs). These prove
// the decoder handles the encodings — they are not live-ingestion evidence.

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(
  readFileSync(join(here, "fixtures/shape-corpus.json"), "utf8"),
);

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, "hex"));

describe("encoding-shape corpus (codec compatibility)", () => {
  for (const entry of corpus.entries) {
    it(`decodes ${entry.label}: ${entry.description}`, async () => {
      const view = await decodeTransaction(hexToBytes(entry.canonicalTxHex));
      const e = entry.expectations;

      expect(view.txId).toMatch(/^[0-9a-f]{64}$/);
      expect(view.formatVersion).toBe(1);
      expect(view.validity).toBe("TxIsValid");

      if (e.mintPolicyIds) {
        expect(view.mint).not.toBeNull();
        for (const pid of e.mintPolicyIds) {
          expect(view.mint?.policyIds).toContain(pid);
        }
      }
      if (e.mintIsNull) {
        expect(view.mint).toBeNull();
      }
      if (e.assetOutputs) {
        for (const a of e.assetOutputs) {
          const carrying = view.outputs.find(
            (o) => o.value.assets[a.policyId]?.[a.assetName] === BigInt(a.quantity),
          );
          expect(
            carrying,
            `an output carrying ${a.quantity} of ${a.policyId}.${a.assetName}`,
          ).toBeDefined();
        }
      }
      if (e.hasDatumCount !== undefined) {
        expect(view.outputs.filter((o) => o.hasDatum).length).toBe(
          e.hasDatumCount,
        );
      }
      if (e.hasScriptRefCount !== undefined) {
        expect(view.outputs.filter((o) => o.hasScriptRef).length).toBe(
          e.hasScriptRefCount,
        );
      }
      if (e.minInputs) {
        expect(view.inputs.length).toBeGreaterThanOrEqual(e.minInputs);
      }
      if (e.minOutputs) {
        expect(view.outputs.length).toBeGreaterThanOrEqual(e.minOutputs);
      }
    });
  }
});
