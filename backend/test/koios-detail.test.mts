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

/** Defaulting a field that Koios always sends turns a Koios schema change
 * into a silent wrong value instead of a loud parse failure: exactly the
 * masking pattern this task exists to close, just at the schema layer
 * instead of the request layer. A minimal, otherwise-valid tx_info fixture
 * is used so each test isolates one field. */
describe("txInfoSchema rejects missing always-sent fields instead of defaulting", () => {
  const baseTx = {
    tx_hash: "abc",
    block_height: 1,
    block_hash: "abc",
    absolute_slot: 1,
    epoch_no: 1,
    tx_timestamp: 1,
    outputs: [],
    fee: "1",
    tx_size: 1,
    total_output: "1",
    tx_block_index: 1,
    deposit: "0",
    withdrawals: [],
    certificates: [],
  };

  it("rejects a plutus_contracts entry missing valid_contract instead of defaulting to true", async () => {
    const { parseTxInfo } = await import("../src/indexer/koios.js");
    const tx = {
      ...baseTx,
      plutus_contracts: [{ script_hash: "hash", input: null }],
    };
    expect(() => parseTxInfo([tx])).toThrow();
  });

  it('rejects a transaction missing deposit instead of defaulting to "0"', async () => {
    const { parseTxInfo } = await import("../src/indexer/koios.js");
    const { deposit: _deposit, ...tx } = baseTx;
    expect(() => parseTxInfo([tx])).toThrow();
  });

  it("keeps withdrawals through parsing instead of stripping them", async () => {
    const { parseTxInfo } = await import("../src/indexer/koios.js");
    const withdrawal = { stake_addr: "stake_test1u...", amount: "100" };
    const tx = { ...baseTx, withdrawals: [withdrawal] };
    const [parsed] = parseTxInfo([tx]);
    expect(parsed.withdrawals).toEqual([withdrawal]);
  });

  it("keeps certificates through parsing instead of stripping them", async () => {
    const { parseTxInfo } = await import("../src/indexer/koios.js");
    const certificate = { type: "stake_registration", index: 0 };
    const tx = { ...baseTx, certificates: [certificate] };
    const [parsed] = parseTxInfo([tx]);
    expect(parsed.certificates).toEqual([certificate]);
  });
});
