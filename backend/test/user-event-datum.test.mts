import { describe, expect, it } from "vitest";
import { classifyEvent, decodeDepositDatum } from "../src/indexer/userEventDatum.js";

/** Read from preprod on 2026-08-07, from the deposit validator's output in the
 * live deployment. This is ground truth, not a hand-written fixture: the last
 * datum decoder in this codebase passed every hand-written test it had while
 * mislabelling all eight of its fields. */
/** Plutus JSON is recursive, and without this annotation TypeScript infers a
 * narrow union from the literal below, so the mutation helpers in the
 * rejection tests stop type-checking. */
type PlutusJson =
  | { constructor: number; fields: PlutusJson[] }
  | { bytes: string }
  | { int: number };

const realDeposit: { constructor: number; fields: PlutusJson[] } = {
  constructor: 0,
  fields: [
    {
      constructor: 0,
      fields: [
        {
          constructor: 0,
          fields: [
            { bytes: "f24d1e8e55f85a17d9a2a04138a88fc7a9f95e400e2a268388144446ba102683" },
            { int: 8 },
          ],
        },
        {
          constructor: 0,
          fields: [
            {
              constructor: 0,
              fields: [
                {
                  constructor: 0,
                  fields: [{ bytes: "d7cb158e1709257c95485597a5b88e8c2b7a4a9c6b2c911f2ce27263" }],
                },
                {
                  constructor: 0,
                  fields: [
                    {
                      constructor: 0,
                      fields: [
                        {
                          constructor: 0,
                          fields: [
                            { bytes: "3e0003b970707694bdc7b877f42559d13e0dde4694e5b05c1804bd9f" },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            { int: 0 },
            { constructor: 1, fields: [] },
          ],
        },
      ],
    },
    { int: 1784138246999 },
    { bytes: "23fe8b451b65e1706fb0fc536d599de8b7547501a554655b9c6e9291" },
  ],
};

describe("decodeDepositDatum", () => {
  it("reads the L1 output reference the depositor spent", () => {
    const d = decodeDepositDatum(realDeposit)!;
    expect(d.l1OutRef.txHash).toBe(
      "f24d1e8e55f85a17d9a2a04138a88fc7a9f95e400e2a268388144446ba102683",
    );
    expect(d.l1OutRef.index).toBe(8);
  });

  it("reads the L2 address the funds are credited to", () => {
    const d = decodeDepositDatum(realDeposit)!;
    expect(d.l2PaymentCredential).toBe("d7cb158e1709257c95485597a5b88e8c2b7a4a9c6b2c911f2ce27263");
    expect(d.l2StakeCredential).toBe("3e0003b970707694bdc7b877f42559d13e0dde4694e5b05c1804bd9f");
  });

  it("reads the network id and the absent optional datum", () => {
    const d = decodeDepositDatum(realDeposit)!;
    expect(d.l2NetworkId).toBe(0);
    expect(d.hasL2Datum).toBe(false);
  });

  it("reads inclusion time as milliseconds, which is July 2026 not 1970", () => {
    const d = decodeDepositDatum(realDeposit)!;
    expect(d.inclusionTime).toBe(1784138246999n);
    expect(new Date(Number(d.inclusionTime)).getUTCFullYear()).toBe(2026);
  });

  it("reads the witness script hash", () => {
    const d = decodeDepositDatum(realDeposit)!;
    expect(d.witness).toBe("23fe8b451b65e1706fb0fc536d599de8b7547501a554655b9c6e9291");
  });

  // Each of these breaks exactly ONE thing and leaves everything else valid, so
  // the failure isolates the guard under test. An input broken in several ways
  // proves nothing: whichever check runs first rejects it.
  it("rejects a datum with the wrong number of top-level fields", () => {
    const d = structuredClone(realDeposit);
    d.fields.pop();
    expect(decodeDepositDatum(d)).toBeNull();
  });

  it("rejects a witness that is not a 28 byte script hash", () => {
    const d = structuredClone(realDeposit);
    (d.fields[2] as { bytes: string }).bytes = "abcd";
    expect(decodeDepositDatum(d)).toBeNull();
  });

  it("rejects an inclusion time that is not an integer", () => {
    const d = structuredClone(realDeposit) as unknown as { fields: unknown[] };
    d.fields[1] = { bytes: "00" };
    expect(decodeDepositDatum(d)).toBeNull();
  });

  it("returns null rather than throwing on unrelated data", () => {
    expect(decodeDepositDatum({ int: 1 })).toBeNull();
    expect(decodeDepositDatum(null)).toBeNull();
    expect(decodeDepositDatum({ bytes: "00" })).toBeNull();
  });
});

describe("classifyEvent", () => {
  it("names a deposit and carries its decoded fields", () => {
    const r = classifyEvent("deposit", realDeposit);
    expect(r.eventType).toBe("deposit");
    expect(r.decoded).toMatchObject({
      l2PaymentCredential: "d7cb158e1709257c95485597a5b88e8c2b7a4a9c6b2c911f2ce27263",
    });
  });

  it("serialises inclusionTime as a string, since JSON has no bigint", () => {
    const r = classifyEvent("deposit", realDeposit);
    expect(r.decoded!.inclusionTime).toBe("1784138246999");
    expect(() => JSON.stringify(r.decoded)).not.toThrow();
  });

  it("falls back to unknown rather than guessing when a datum does not decode", () => {
    const r = classifyEvent("deposit", { int: 1 });
    expect(r.eventType).toBe("unknown");
    expect(r.decoded).toBeNull();
  });

  it("leaves families with no decoder as unknown", () => {
    expect(classifyEvent("stateQueue", realDeposit).eventType).toBe("unknown");
  });
});
