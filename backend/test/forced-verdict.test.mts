import { describe, expect, it } from "vitest";
import { Data } from "@lucid-evolution/lucid";
import * as SDK from "@al-ft/midgard-sdk";
import { aikenSerialisedPlutusDataCbor } from "@al-ft/midgard-core/plutus-data-cbor";
import { decodeForcedVerdict } from "../src/decode/forcedVerdict.js";

/**
 * The operator's verdict on a forced transaction.
 *
 * The node stored it in `operator_validity` until Midgard dropped the column.
 * It now lives only inside `forced_inclusion_value`, the `ForcedInclusionTxV1`
 * the node writes, and is read back with the SDK's own schema. The values here
 * are encoded the way the node encodes them.
 */
const encode = (verdict: SDK.ForcedInclusionTxV1["verdict"]): Buffer =>
  Buffer.from(
    aikenSerialisedPlutusDataCbor(
      Data.to(
        {
          tx_id: "ab".repeat(32),
          submitted_source: {
            compact_cbor: "80",
            witness_set_compact_cbor: "80",
            field_preimage_lengths_cbor: "80",
          },
          verdict,
        },
        SDK.ForcedInclusionTxV1,
      ),
    ),
    "hex",
  );

describe("the forced-transaction verdict", () => {
  it("reads a valid verdict", async () => {
    expect(await decodeForcedVerdict(encode("ForcedTxValid"))).toEqual({
      verdict: "ForcedTxValid",
      reason: null,
    });
  });

  it("reads an invalid verdict with the reason the operator gave", async () => {
    expect(
      await decodeForcedVerdict(encode({ ForcedTxInvalid: { reason: "EmptyInputs" } })),
    ).toEqual({ verdict: "ForcedTxInvalid", reason: "EmptyInputs" });
  });

  /** Unknown, not a guessed verdict: a value this build cannot read says so. */
  it("returns null for a value it cannot read", async () => {
    expect(await decodeForcedVerdict(Buffer.from("deadbeef", "hex"))).toBeNull();
  });
});
