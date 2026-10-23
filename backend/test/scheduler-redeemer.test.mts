import { describe, expect, it } from "vitest";
import { decodeSchedulerRedeemer } from "../src/decode/schedulerRedeemer.js";

type PlutusJson =
  | { constructor: number; fields: PlutusJson[] }
  | { bytes: string }
  | { int: number };

/** SpendRedeemer wraps the approach in two indices it does not otherwise use
 * here, so every case below shares the same envelope. */
const wrap = (approach: PlutusJson): PlutusJson => ({
  constructor: 0,
  fields: [{ int: 0 }, { int: 0 }, approach],
});

const int = (n: number): PlutusJson => ({ int: n });

describe("decodeSchedulerRedeemer", () => {
  /** Ground truth, not a hand-written fixture. Read from preprod on 2026-08-14
   * from tx c934b1a42154db5a40e75158527aef2ef3f82a7e86b65103de3228c629346e10,
   * whose spend redeemer is constructor 1 with three fields. That is a rewind,
   * not an advance, which is exactly the distinction a single generic summary
   * sentence would have got wrong on the only real example available. */
  it("reads RewindDueToEndOfShift from the live preprod redeemer", () => {
    const live: PlutusJson = {
      constructor: 0,
      fields: [int(0), int(0), { constructor: 1, fields: [int(0), int(2), int(1)] }],
    };
    expect(decodeSchedulerRedeemer(live)).toEqual({ action: "rewindEndOfShift" });
  });

  it("reads GoToNextDueToEndOfShift", () => {
    expect(decodeSchedulerRedeemer(wrap({ constructor: 0, fields: [int(3)] }))).toEqual({
      action: "advanceEndOfShift",
    });
  });

  it("reads a skipped-operator advance and the deposit it left behind", () => {
    const approach: PlutusJson = {
      constructor: 2,
      fields: [int(1), int(2), int(3), int(4), int(5), { constructor: 1, fields: [int(7)] }],
    };
    expect(decodeSchedulerRedeemer(wrap(approach))).toEqual({
      action: "advanceSkippedOperator",
      neglected: { kind: "deposit", refInputIndex: 7 },
    });
  });

  it("reads a skipped-operator rewind that neglected nothing", () => {
    const approach: PlutusJson = {
      constructor: 3,
      fields: [
        int(1),
        int(2),
        int(3),
        int(4),
        int(5),
        int(6),
        { constructor: 0, fields: [] },
      ],
    };
    expect(decodeSchedulerRedeemer(wrap(approach))).toEqual({
      action: "rewindSkippedOperator",
      neglected: { kind: "none" },
    });
  });

  it("distinguishes retirement from slashing on an advance", () => {
    const retire: PlutusJson = {
      constructor: 4,
      fields: [int(0), { constructor: 0, fields: [] }],
    };
    const slash: PlutusJson = {
      constructor: 4,
      fields: [int(0), { constructor: 1, fields: [] }],
    };
    expect(decodeSchedulerRedeemer(wrap(retire))).toEqual({
      action: "advanceOperatorRemoval",
      reason: "retirement",
    });
    expect(decodeSchedulerRedeemer(wrap(slash))).toEqual({
      action: "advanceOperatorRemoval",
      reason: "slashing",
    });
  });

  it("reads a removal rewind and its reason from the third field", () => {
    const approach: PlutusJson = {
      constructor: 5,
      fields: [int(0), { constructor: 0, fields: [] }, { constructor: 1, fields: [] }, int(2)],
    };
    expect(decodeSchedulerRedeemer(wrap(approach))).toEqual({
      action: "rewindOperatorRemoval",
      reason: "slashing",
    });
  });

  it("reads AppointFirstOperator", () => {
    expect(decodeSchedulerRedeemer(wrap({ constructor: 6, fields: [int(0), int(1)] }))).toEqual({
      action: "appointFirstOperator",
    });
  });

  it("returns null for an approach constructor the type does not define", () => {
    expect(decodeSchedulerRedeemer(wrap({ constructor: 9, fields: [] }))).toBeNull();
  });

  /* Arity is the whole defence here. Several approach constructors are just
   * lists of Ints, so a decoder that accepted "at least n" fields would report
   * an end-of-shift advance for a skipped-operator rewind. */
  it("returns null when the approach arity is wrong for its constructor", () => {
    expect(decodeSchedulerRedeemer(wrap({ constructor: 0, fields: [] }))).toBeNull();
    expect(
      decodeSchedulerRedeemer(wrap({ constructor: 1, fields: [int(0), int(1)] })),
    ).toBeNull();
  });

  it("returns null when the outer redeemer is not the three-field spend record", () => {
    expect(decodeSchedulerRedeemer({ constructor: 0, fields: [int(0)] })).toBeNull();
    expect(decodeSchedulerRedeemer({ constructor: 1, fields: [int(0), int(0), int(0)] })).toBeNull();
  });

  it("returns null on a neglected-event shape it cannot prove", () => {
    const approach: PlutusJson = {
      constructor: 2,
      fields: [int(1), int(2), int(3), int(4), int(5), { constructor: 1, fields: [] }],
    };
    expect(decodeSchedulerRedeemer(wrap(approach))).toBeNull();
  });

  it("returns null rather than throwing on a non-object", () => {
    expect(decodeSchedulerRedeemer(null)).toBeNull();
    expect(decodeSchedulerRedeemer("spend")).toBeNull();
  });
});
