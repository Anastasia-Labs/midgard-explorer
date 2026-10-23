import { describe, expect, it } from "vitest";
import type { AddressResponse } from "@midgard-explorer/contracts";
import { addressForDisplay } from "../src/lib/addressDisplay";
import { ADDRESSES, addressResponse } from "../e2e/fixtures/data.mjs";

const address = ADDRESSES[0] as string;
const data = addressResponse(address) as unknown as AddressResponse;

describe("the address JSON on the Raw tab", () => {
  const shown = addressForDisplay(address, data);

  it("keeps what the address holds and its activity", () => {
    expect(shown.balance).toEqual(data.balance);
    expect(shown.history).toHaveLength(data.history.length);
    expect(shown.utxos).toHaveLength(data.utxos.length);
  });

  it("names transactions without their bodies, and paging stays in the API", () => {
    expect(JSON.stringify(shown)).not.toContain('"transaction"');
    for (const key of ["utxoCursor", "hasMoreUtxos", "historyPage", "limit"]) {
      expect(Object.keys(shown), key).not.toContain(key);
    }
  });

  it("states an unknown spend as null, never zero", () => {
    const pruned = addressForDisplay(address, {
      ...data,
      history: data.history.map((row) => ({ ...row, spentComplete: false })),
    });
    for (const row of pruned.history) expect(row.spent).toBeNull();
  });
});
