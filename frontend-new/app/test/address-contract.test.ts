import { describe, expect, it } from "vitest";
import { decodeAddressResponse } from "@midgard-explorer/contracts";
// The browser fixture is intentionally the same JSON shape served to the app.
import { ADDRESSES, addressResponse } from "../e2e/fixtures/data.mjs";

describe("address API contract", () => {
  it("accepts the populated paged address response", () => {
    expect(() => decodeAddressResponse(addressResponse(ADDRESSES[1], 1))).not.toThrow();
  });

  it("keeps an address usable during an old-backend/new-frontend restart overlap", () => {
    const current = addressResponse(ADDRESSES[1], 1);
    const legacy = {
      balance: current.balance,
      undecodedOutputs: current.undecodedOutputs,
      utxoCount: current.utxoCount,
      utxos: current.utxos,
      txCount: current.txCount,
      firstActivity: current.firstActivity,
      latestActivity: current.latestActivity,
      history: current.history.map(({ finalization_status: _status, received, spent, ...row }) => ({
        ...row,
        received: received?.lovelace ?? null,
        spent: spent?.lovelace ?? null,
      })),
    };

    const decoded = decodeAddressResponse(legacy);
    expect(decoded.historyPage).toBe(1);
    expect(decoded.hasNextPage).toBe(false);
    expect(decoded.history[0]?.finalization_status).toBeNull();
    expect(decoded.history[0]?.received?.assets).toEqual({});
  });
});
