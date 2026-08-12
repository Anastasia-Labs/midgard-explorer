import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  decodeDepositDatum,
  decodeWithdrawalDatum,
} from "../src/indexer/userEventDatum.js";

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

/**
 * Built field for field from the on-chain type, not from the decoder:
 *
 *   withdrawal.Datum = user_events.OptimisticDatum<WithdrawalEvent>
 *     event            WithdrawalEvent { id, info }
 *       id             WithdrawalId = OutputReference { transaction_id, output_index }
 *       info           WithdrawalInfo { body, signature, validity }
 *         body         WithdrawalBody { l2_outref, l2_owner, l2_value, l1_address, l1_datum }
 *     inclusion_time   PosixTime
 *     witness          ScriptHash
 *     refund_address   Address
 *     refund_datum     CardanoDatum
 *
 * Preprod has no withdrawal events, so this is the closest thing to ground
 * truth that exists. Every hash below is distinct, so a decoder that reads the
 * right shape but the wrong slot fails rather than passing on a coincidence.
 */
const L1_TX = "11".repeat(32);
const L2_TX = "22".repeat(32);
const L2_OWNER = "33".repeat(28);
const WITNESS = "44".repeat(28);
const REFUND_CRED = "55".repeat(28);

const outputReference = (txHash: string, index: number): PlutusJson => ({
  constructor: 0,
  fields: [{ bytes: txHash }, { int: index }],
});

const withdrawalDatum = (): { constructor: number; fields: PlutusJson[] } => ({
  constructor: 0,
  fields: [
    // event: WithdrawalEvent { id, info }
    {
      constructor: 0,
      fields: [
        outputReference(L1_TX, 3),
        // info: WithdrawalInfo { body, signature, validity }
        {
          constructor: 0,
          fields: [
            // body: WithdrawalBody { l2_outref, l2_owner, l2_value, l1_address, l1_datum }
            {
              constructor: 0,
              fields: [
                outputReference(L2_TX, 1),
                { bytes: L2_OWNER },
                { constructor: 0, fields: [] },
                {
                  constructor: 0,
                  fields: [
                    { constructor: 0, fields: [{ bytes: REFUND_CRED }] },
                    { constructor: 1, fields: [] },
                  ],
                },
                { constructor: 0, fields: [] },
              ],
            },
            { constructor: 0, fields: [] },
            { constructor: 0, fields: [] },
          ],
        },
      ],
    },
    { int: 1784138246999 },
    { bytes: WITNESS },
    {
      constructor: 0,
      fields: [
        { constructor: 0, fields: [{ bytes: REFUND_CRED }] },
        { constructor: 1, fields: [] },
      ],
    },
    { constructor: 0, fields: [] },
  ],
});

describe("decodeWithdrawalDatum", () => {
  it("reads every field into the slot the on-chain type declares", () => {
    const d = decodeWithdrawalDatum(withdrawalDatum())!;
    expect(d).not.toBeNull();
    expect(d.l1OutRef).toEqual({ txHash: L1_TX, index: 3 });
    expect(d.l2OutRef).toEqual({ txHash: L2_TX, index: 1 });
    expect(d.l2Owner).toBe(L2_OWNER);
    expect(d.witness).toBe(WITNESS);
    expect(d.inclusionTime).toBe(1784138246999n);
  });

  // l2_owner and witness are both 28 byte hashes at different depths. A
  // decoder that reads the right shape from the wrong slot passes a
  // shape-only test and reports the wrong party.
  it("does not confuse the owner with the witness", () => {
    const d = decodeWithdrawalDatum(withdrawalDatum())!;
    expect(d.l2Owner).not.toBe(d.witness);
  });

  it("rejects a datum with the wrong arity rather than guessing", () => {
    const short = withdrawalDatum();
    short.fields = short.fields.slice(0, 4);
    expect(decodeWithdrawalDatum(short)).toBeNull();
  });

  it("rejects a body whose l2_owner is not a 28 byte hash", () => {
    const wrong = withdrawalDatum();
    const event = wrong.fields[0] as { fields: PlutusJson[] };
    const info = event.fields[1] as { fields: PlutusJson[] };
    const body = info.fields[0] as { fields: PlutusJson[] };
    body.fields[1] = { bytes: "00" };
    expect(decodeWithdrawalDatum(wrong)).toBeNull();
  });

  it("classifies a well-formed withdrawal rather than calling it unknown", () => {
    const c = classifyEvent("withdrawal", withdrawalDatum());
    expect(c.eventType).toBe("withdrawal");
    expect(c.decoded?.l2Owner).toBe(L2_OWNER);
    // BigInt does not survive JSON.stringify, so it crosses as a string.
    expect(c.decoded?.inclusionTime).toBe("1784138246999");
  });
});
