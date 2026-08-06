import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TransactionWithMeta } from "@midgard-explorer/contracts";
import { TXS } from "../e2e/fixtures/data.mjs";

/**
 * The fixture backend must satisfy the same contract the real backend does.
 *
 * Without this, a fixture that drifts from the schema only fails in the e2e
 * suite, and it fails as "no rows on the page" twelve minutes later rather than
 * as "this field is wrong" in a second. That is exactly how a signed mint
 * quantity got through: `DecimalString` is `/^\d+$/`, a burn is negative, and
 * Schema rejected the whole response rather than the one field.
 */

const decode = Schema.decodeUnknownEither(TransactionWithMeta);

describe("fixture transactions satisfy the wire contract", () => {
  const decodable = TXS.filter((t) => t.transaction !== null && !t.decodeError).map((t) => ({
    ...t,
    transaction: t.transaction!,
  }));

  it("has transactions to check, so this gate is not measuring nothing", () => {
    expect(decodable.length).toBeGreaterThan(0);
  });

  it("decodes every fixture transaction", () => {
    const failures: string[] = [];
    for (const t of decodable) {
      const result = decode({ ...t.transaction, timestamp: t.time_stamp_tz });
      if (result._tag === "Left") {
        failures.push(`${t.tx_id.slice(0, 12)}…: ${String(result.left).slice(0, 200)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("covers a burn, so a negative quantity cannot regress unnoticed", () => {
    const burns = decodable.flatMap((t) =>
      (t.transaction.mint?.assets ?? []).filter((a) => a.quantity.startsWith("-")),
    );
    expect(burns.length).toBeGreaterThan(0);
  });

  it("covers a datum that will not decode to JSON", () => {
    const hexOnly = decodable.flatMap((t) =>
      t.transaction.outputs.filter((o) => o.datum !== null && o.datum.json === null),
    );
    expect(hexOnly.length).toBeGreaterThan(0);
  });

  it("covers both address kinds", () => {
    const kinds = new Set(
      decodable.flatMap((t) => t.transaction.outputs.map((o) => o.addressKind)),
    );
    expect([...kinds].sort()).toEqual(["PubKey", "Script"]);
  });
});
