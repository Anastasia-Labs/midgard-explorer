import { describe, expect, it } from "vitest";
import { contractVerdict } from "../src/db/l1.js";

/** The row builder used to write `validContract: true` for every deposit,
 * withdrawal and block commitment it classified. Nothing had checked. A
 * reader could not tell a deposit whose script failed from one that succeeded,
 * because both rendered as success.
 */

const familyOf = (hash: string) =>
  ({ aaa: "deposit", bbb: "deposit", ccc: "stateQueue" })[hash];

describe("contractVerdict", () => {
  it("reports no verdict when the family ran no script", () => {
    // The ordinary deposit: paying to a script address executes nothing, so
    // there is no redeemer and therefore nothing that passed.
    expect(contractVerdict([], familyOf, "deposit")).toBe(null);
    expect(
      contractVerdict([{ scriptHash: "ccc", validContract: true }], familyOf, "deposit"),
    ).toBe(null);
  });

  it("reports the verdict of the family's own redeemer", () => {
    expect(
      contractVerdict([{ scriptHash: "aaa", validContract: true }], familyOf, "deposit"),
    ).toBe(true);
    expect(
      contractVerdict([{ scriptHash: "aaa", validContract: false }], familyOf, "deposit"),
    ).toBe(false);
  });

  it("fails the family when any one of its redeemers failed", () => {
    expect(
      contractVerdict(
        [
          { scriptHash: "aaa", validContract: true },
          { scriptHash: "bbb", validContract: false },
        ],
        familyOf,
        "deposit",
      ),
    ).toBe(false);
  });

  it("ignores redeemers belonging to other families", () => {
    expect(
      contractVerdict(
        [
          { scriptHash: "ccc", validContract: false },
          { scriptHash: "aaa", validContract: true },
        ],
        familyOf,
        "deposit",
      ),
    ).toBe(true);
  });
});
