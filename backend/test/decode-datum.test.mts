import { Constr, Data } from "@lucid-evolution/lucid";
import { describe, expect, it } from "vitest";
import { decodeDatum, decodeDatumResult } from "../src/decode/datum.js";

/**
 * The indexer ingests arbitrary chain data on a timer. A decoder that throws
 * takes down the sync tick; one that returns null marks a single event
 * undecoded. Never guess, never throw.
 */

// A real CBOR datum: constructor 0 with one 28 byte hash, the shape every
// Credential in these datums has.
const CRED = "33".repeat(28);
const VALID_CBOR = Data.to(new Constr(0, [CRED]));

describe("decodeDatumResult", () => {
  it("decodes valid CBOR", () => {
    const r = decodeDatumResult<Data>(VALID_CBOR, Data.Any);
    expect(r.ok).toBe(true);
  });

  it("reports a missing datum rather than throwing", () => {
    for (const missing of [null, undefined, ""]) {
      const r = decodeDatumResult(missing, Data.Any);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("missing datum");
    }
  });

  it("reports why bytes that are not CBOR failed", () => {
    const r = decodeDatumResult("zzzz", Data.Any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe("decodeDatum", () => {
  it("returns the value on success", () => {
    expect(decodeDatum(VALID_CBOR, Data.Any)).not.toBeNull();
  });

  // The whole point of the adapter. Data.from throws on every one of these.
  it("returns null instead of throwing on anything malformed", () => {
    // "00" is deliberately absent: it is valid CBOR for the integer 0, and a
    // test that called it malformed would be asserting the wrong thing.
    for (const bad of [null, undefined, "", "zzzz", "d879", "9f", "ff".repeat(10)]) {
      expect(() => decodeDatum(bad, Data.Any)).not.toThrow();
      expect(decodeDatum(bad, Data.Any)).toBeNull();
    }
  });

  it("throws when called bare, which is why this adapter exists", () => {
    expect(() => Data.from("zzzz", Data.Any)).toThrow();
  });
});
