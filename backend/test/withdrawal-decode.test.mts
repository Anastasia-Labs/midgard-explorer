import { describe, expect, it } from "vitest";
import {
  decodeWithdrawalAddress,
  decodeWithdrawalValue,
} from "../src/decode/withdrawal.js";
import { networkFor } from "../src/server/routes/withdrawals.js";

// Golden vectors from the current node's withdrawal_utxos row. These are
// Plutus Data CBOR written by Data.to(..., SDK.Value/SDK.AddressData), not the
// Midgard-native transaction value encoding.
const VALUE_CBOR = "bf40bf401a00b6fd00ffff";
const ADDRESS_CBOR =
  "d8799fd8799f581ce3cba5b9818a4571d8f7a7a9a219ba415a2eeb01123528a8f7fe0ebaff" +
  "d8799fd8799fd8799f581c01ee715c210ad1f17ed6bcea68d1aceb1b605d4dd933832598b1bc78ffffffff";

describe("canonical withdrawal field decoding", () => {
  it("decodes the real indefinite-length SDK Value as lovelace", () => {
    const result = decodeWithdrawalValue(Buffer.from(VALUE_CBOR, "hex"));
    expect(result.error).toBeNull();
    expect(result.value).toEqual({ lovelace: 11_992_320n, assets: {} });
  });

  it("decodes the real SDK AddressData using the deployment network", () => {
    const result = decodeWithdrawalAddress(
      Buffer.from(ADDRESS_CBOR, "hex"),
      "preprod",
    );
    expect(result.error).toBeNull();
    expect(result.value).toBe(
      "addr_test1qr3uhfdesx9y2uwc77n6ngsehfq45thtqyfr229g7llqawspaec4cgg268cha44uaf5drt8trds96nwexwpjtx93h3uqlc52rh",
    );
  });

  it("isolates malformed fields and returns a stable error", () => {
    expect(decodeWithdrawalValue(Buffer.from("deadbeef", "hex"))).toEqual({
      value: null,
      error: "Failed to decode l2_value as Midgard SDK Plutus data.",
    });
    expect(
      decodeWithdrawalAddress(Buffer.from("deadbeef", "hex"), "preprod"),
    ).toEqual({
      value: null,
      error: "Failed to decode l1_address as Midgard SDK Plutus data.",
    });
  });
});

describe("the network the address is encoded for", () => {
  /** `db/l1.ts` degrades deliberately when the manifest cannot be read: the
   * events it holds are still true and only validator attribution is lost.
   * The withdrawals route took the opposite path for the same failure and let
   * the error reach the handler, so a bad manifest path answered 500 for the
   * whole listing while the L1 pages kept serving. Only the address needs the
   * manifest here, and an address that cannot be encoded already has a
   * representation in this response. */
  it("is null when the manifest cannot be read, rather than throwing", () => {
    expect(networkFor("/does/not/exist/contract-deployment-info.json")).toBeNull();
  });

  it("is the manifest's network when it can", () => {
    const path = new URL("./fixtures/manifest-sample.json", import.meta.url).pathname;
    expect(networkFor(path)).toBe("preprod");
  });
});
