import { describe, expect, it } from "vitest";
import { scriptHashToAddress } from "../src/indexer/bech32.js";

/**
 * Script hash to bech32 address. The expected value below was taken from a
 * live preprod query on 2026-08-07: the hub oracle NFT (policy 5fdec6ae...,
 * asset MIDGARD_HUB_ORACLE) was found sitting at exactly this address, so it
 * is a real anchor rather than a value this code produced for itself.
 */

describe("scriptHashToAddress", () => {
  it("derives the known hub oracle address on preprod", () => {
    expect(
      scriptHashToAddress(
        "5fdec6ae62250ad27a21ad01d646238b6e95991b738f513f58a91b81",
        "preprod",
      ),
    ).toBe("addr_test1wp0aa34wvgjs45n6yxksr4jxyw9ka9verdec75fltz53hqgvplf4g");
  });

  it("uses the addr prefix on mainnet", () => {
    const a = scriptHashToAddress(
      "5fdec6ae62250ad27a21ad01d646238b6e95991b738f513f58a91b81",
      "mainnet",
    );
    expect(a.startsWith("addr1w")).toBe(true);
  });

  it("rejects a hash that is not 28 bytes", () => {
    expect(() => scriptHashToAddress("abcd", "preprod")).toThrow(
      /28 bytes/,
    );
  });
});
