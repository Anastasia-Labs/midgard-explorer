import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  decodeTransaction,
  redeemerPurpose,
} from "../src/decode/transaction.js";

/**
 * Phase 1: the fields a developer needs that the contract used to reduce to
 * booleans and counts.
 *
 * The decoder already parsed `output.datum` and `output.script_ref` and threw
 * both away, keeping only `hasDatum` / `hasScriptRef`. These tests pin the
 * widened shape against the same corpus the boolean assertions use, so a
 * regression shows up as a decode failure rather than as an empty panel in the
 * UI.
 */

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(
  readFileSync(join(here, "fixtures/shape-corpus.json"), "utf8"),
);

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, "hex"));

const entry = (label: string) => {
  const found = corpus.entries.find(
    (e: { label: string }) => e.label === label,
  );
  if (!found) throw new Error(`corpus entry ${label} is missing`);
  return found;
};

const decode = (label: string) =>
  decodeTransaction(hexToBytes(entry(label).canonicalTxHex));

describe("datum content", () => {
  it("carries the datum bytes, not only that one exists", async () => {
    const view = await decode("inline-datum");
    const withDatum = view.outputs.filter((o) => o.hasDatum);
    expect(withDatum.length).toBeGreaterThan(0);
    for (const output of withDatum) {
      expect(output.datum).not.toBeNull();
      expect(output.datum?.cborHex).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("leaves datum null on an output that has none", async () => {
    const view = await decode("multi-output");
    for (const output of view.outputs.filter((o) => !o.hasDatum)) {
      expect(output.datum).toBeNull();
    }
  });

  it("keeps hasDatum agreeing with datum, so neither can drift", async () => {
    for (const label of ["inline-datum", "script-ref", "multi-output"]) {
      const view = await decode(label);
      for (const output of view.outputs) {
        expect(
          output.hasDatum,
          `${label}: hasDatum must match datum presence`,
        ).toBe(output.datum !== null);
      }
    }
  });

  it("degrades to hex rather than failing when a datum will not decode to JSON", async () => {
    const view = await decode("inline-datum");
    for (const output of view.outputs.filter((o) => o.datum !== null)) {
      // `json` is nullable by contract: a shape the codec cannot render must
      // not take the whole response down with it.
      expect(output.datum).toHaveProperty("json");
      expect(output.datum?.cborHex.length).toBeGreaterThan(0);
    }
  });
});

describe("script references", () => {
  it("carries the script hash, language and bytes", async () => {
    const view = await decode("script-ref");
    const withRef = view.outputs.filter((o) => o.hasScriptRef);
    expect(withRef.length).toBe(1);
    for (const output of withRef) {
      expect(output.scriptRef).not.toBeNull();
      expect(output.scriptRef?.hash).toMatch(/^[0-9a-f]+$/);
      expect(["NativeCardano", "PlutusV3", "MidgardV1"]).toContain(
        output.scriptRef?.language,
      );
      expect(output.scriptRef?.cborHex).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("keeps hasScriptRef agreeing with scriptRef", async () => {
    for (const label of ["script-ref", "multi-output", "inline-datum"]) {
      const view = await decode(label);
      for (const output of view.outputs) {
        expect(output.hasScriptRef).toBe(output.scriptRef !== null);
      }
    }
  });
});

describe("address kind", () => {
  it("says whether each output pays a script or a public key", async () => {
    const view = await decode("multi-output");
    expect(view.outputs.length).toBeGreaterThan(0);
    for (const output of view.outputs) {
      expect(["Script", "PubKey"]).toContain(output.addressKind);
    }
  });

  it("carries payment and optional stake credential hashes", async () => {
    const view = await decode("multi-output");
    for (const output of view.outputs) {
      expect(output.identity.payment.hash).toMatch(/^[0-9a-f]{56}$/);
      expect(["Script", "PubKey"]).toContain(output.identity.payment.kind);
      if (output.identity.stake) {
        expect(output.identity.stake.hash).toMatch(/^[0-9a-f]{56}$/);
      }
    }
  });
});

describe("mint detail", () => {
  it("reports minted assets per asset, not only their policy ids", async () => {
    const view = await decode("mint-multiasset");
    expect(view.mint).not.toBeNull();
    expect(view.mint!.assets.length).toBeGreaterThan(0);
    for (const asset of view.mint!.assets) {
      expect(asset.policyId).toMatch(/^[0-9a-f]{56}$/);
      expect(typeof asset.assetName).toBe("string");
      expect(typeof asset.quantity).toBe("bigint");
    }
    // The policy ids stay, so nothing reading the old field breaks.
    expect(view.mint!.policyIds.length).toBeGreaterThan(0);
  });

  it("distinguishes a burn by a negative quantity", async () => {
    const view = await decode("burn");
    expect(view.mint).not.toBeNull();
    const burned = view.mint!.assets.filter((a) => a.quantity < 0n);
    expect(burned.length).toBeGreaterThan(0);
  });
});

describe("witnesses", () => {
  it("names Midgard's protected-output receiving redeemer", () => {
    expect(redeemerPurpose(6)).toBe("receive");
  });

  it("lists scripts with their hash and language, keeping the count", async () => {
    const view = await decode("script-ref");
    expect(view.witnesses.scripts.length).toBe(view.witnesses.scriptCount);
    for (const script of view.witnesses.scripts) {
      expect(script.hash).toMatch(/^[0-9a-f]+$/);
      expect(["NativeCardano", "PlutusV3", "MidgardV1"]).toContain(
        script.language,
      );
      expect(script.cborHex).toMatch(/^[0-9a-f]+$/);
      expect(script.hashVerified).toBe(true);
      expect(script.source).toBe("witness_set");
    }
  });

  it("lists redeemers as raw bytes, keeping the count", async () => {
    for (const label of ["script-ref", "mint-multiasset"]) {
      const view = await decode(label);
      expect(view.witnesses.redeemers.length).toBe(
        view.witnesses.redeemerCount,
      );
      for (const redeemer of view.witnesses.redeemers) {
        expect(redeemer.cborHex).toMatch(/^[0-9a-f]+$/);
        expect(redeemer).toHaveProperty("purpose");
        expect(redeemer).toHaveProperty("data");
      }
    }
  });

  it("keeps the three original counts so existing readers still work", async () => {
    const view = await decode("multi-input");
    expect(typeof view.witnesses.vkeyCount).toBe("number");
    expect(typeof view.witnesses.scriptCount).toBe("number");
    expect(typeof view.witnesses.redeemerCount).toBe("number");
  });
});

describe("native-format evidence and exclusions", () => {
  it("exposes required signers, observers, and integrity commitments", async () => {
    const view = await decode("script-ref");
    expect(Array.isArray(view.requiredSigners)).toBe(true);
    expect(Array.isArray(view.requiredObservers)).toBe(true);
    expect(view).toHaveProperty("scriptIntegrityHash");
    expect(view).toHaveProperty("auxiliaryDataHash");
  });

  it("states unsupported sections instead of fabricating Cardano fields", async () => {
    const view = await decode("multi-output");
    expect(view.capabilities.collateral.state).toBe("not_supported");
    expect(view.capabilities.certificates.state).toBe("not_supported");
    expect(view.capabilities.governance.state).toBe("not_supported");
    expect(view.capabilities.protocolEvents.state).toBe("not_emitted");
    expect(view.capabilities.executionTrace.state).toBe("commitment_only");
    expect(view.capabilities.consumedBy.state).toBe("not_indexed");

    // The API states a capability, it does not narrate one. Eight English
    // sentences used to ride along here and nothing rendered them, which made
    // the backend the author of copy it could not see.
    for (const capability of Object.values(view.capabilities)) {
      expect(capability).not.toHaveProperty("reason");
    }
  });
});
