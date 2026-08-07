import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/** Koios returns EMPTY ARRAYS, not errors, for detail you did not request.
 * Measured on preprod tx 9152dc88...ddf92: with only `_scripts: true` the
 * response carries inputs: [], reference_inputs: [], collateral_inputs: []
 * and assets_minted: [], while the same transaction really has 3, 5, 1 and 1.
 * Nothing downstream can tell that apart from a transaction with no inputs,
 * so the only place this can be caught is here, at the request. */
describe("fetchTxInfo request flags", () => {
  let body: Record<string, unknown> | null;

  beforeEach(() => {
    body = null;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  // One assertion per flag, so a dropped flag names itself in the failure.
  for (const flag of ["_scripts", "_inputs", "_assets", "_metadata", "_withdrawals", "_certs"]) {
    it(`requests ${flag}, without which Koios returns that section empty`, async () => {
      const { fetchTxInfo } = await import("../src/indexer/koios.js");
      await fetchTxInfo(["9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92"]);
      expect(body).not.toBeNull();
      expect(body![flag]).toBe(true);
    });
  }
});
