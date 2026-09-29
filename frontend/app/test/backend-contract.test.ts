import { Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import * as C from "@midgard-explorer/contracts";

/**
 * The REAL backend satisfies the contracts, not just the fixture.
 *
 * Every other parity test in this directory decodes `e2e/fixtures/data.mjs`,
 * which proves the fixture agrees with the schema and says nothing about the
 * server. That gap is not hypothetical: the fixture served the L2 block header
 * hash under `headerHash` while the indexer stored a 32-byte Merkle root there,
 * so the join worked in every test and in no deployment, and three pages
 * shipped dead links behind a green suite.
 *
 * Opt-in by design. It needs a running backend, so it skips when there is none
 * and fails loudly when `REQUIRE_BACKEND=1` says one should be there. A CI job
 * that sets that flag cannot report a pass it never measured.
 *
 *   BACKEND_URL=http://127.0.0.1:3101 REQUIRE_BACKEND=1 pnpm test
 */

const BASE = process.env.BACKEND_URL ?? "http://127.0.0.1:3101";
const REQUIRED = process.env.REQUIRE_BACKEND === "1";

let reachable = false;

const get = async (path: string, timeoutMs = 10_000): Promise<unknown> => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
};

/** The reachability probe gives up well inside Vitest's 10 s hook limit.
 *
 * It used the same 10 s as the contract checks, which equals the hook limit.
 * Where nothing listens and the connection is refused, that never mattered.
 * Where the port hangs instead, as a dead localhost port does under WSL, the
 * hook died at 10,000 ms before the probe could give up, and the file failed
 * rather than skipping. That turned "no backend running" into a red frontend
 * gate. Three seconds is what the app's own `/api/health` allows. */
const PROBE_TIMEOUT_MS = 3_000;

/** Decodes, or fails naming the field rather than the whole response. */
const satisfies = async (path: string, schema: Schema.Schema<never, never, never> | unknown) => {
  const body = await get(path);
  const result = Schema.decodeUnknownEither(schema as never)(body);
  if (result._tag === "Left") {
    throw new Error(`${path} does not satisfy its contract: ${String(result.left).slice(0, 600)}`);
  }
};

beforeAll(async () => {
  try {
    await get("/healthz", PROBE_TIMEOUT_MS);
    reachable = true;
  } catch (error) {
    if (REQUIRED) throw error;
    console.warn(`Skipping backend contract parity: ${BASE} unreachable. ${String(error)}`);
  }
});

describe("the backend answers the shapes the frontend decodes", () => {
  it("was reachable when REQUIRE_BACKEND is set", () => {
    if (!REQUIRED) return;
    expect(reachable).toBe(true);
  });

  it("blocks page", async () => {
    if (!reachable) return;
    await satisfies("/api/blocks/1", C.BlocksPageResponse);
  });

  it("transactions page", async () => {
    if (!reachable) return;
    await satisfies("/api/transactions/1", C.TxsPageResponse);
  });

  it("recent transactions", async () => {
    if (!reachable) return;
    await satisfies("/api/transactions/recent", C.RecentTxsResponse);
  });

  it("deposits, withdrawals and forced transactions", async () => {
    if (!reachable) return;
    await satisfies("/api/deposits/1", C.DepositsPageResponse);
    await satisfies("/api/withdrawals/1", C.WithdrawalsPageResponse);
    await satisfies("/api/forced-transactions/1", C.ForcedTxsPageResponse);
  });

  /** Which deployment and database the figures come from. The shell's banner
   * is built from this on every page, so a drift here is a drift everywhere. */
  it("the source, with its identity state and freshness", async () => {
    if (!reachable) return;
    await satisfies("/api/source", C.DeploymentContext);
  });

  it("the node-recorded Cardano activity and its summary", async () => {
    if (!reachable) return;
    await satisfies("/api/l1/activity/1", C.CardanoActivityPage);
    await satisfies("/api/l1/activity/summary", C.CardanoActivitySummary);
  });

  it("the validators the manifest declares", async () => {
    if (!reachable) return;
    await satisfies("/api/l1/validators", C.L1ValidatorsResponse);
  });

  /** A detail response, which is where the association envelope lives. */
  it("a block detail, with its deployment context and association", async () => {
    if (!reachable) return;
    const blocks = (await get("/api/blocks/1")) as { rows: Array<{ header_hash: string }> };
    const first = blocks.rows[0];
    // Silence here was the whole test evaporating. Where a backend is
    // REQUIRED, a block is required too: the envelope is the thing under test
    // and it only appears on a block detail.
    if (first === undefined) {
      if (REQUIRED) {
        throw new Error(
          "The backend holds no blocks, so the association envelope was never " +
            "decoded. Point it at a Midgard database that has some before running " +
            "with REQUIRE_BACKEND=1.",
        );
      }
      return;
    }
    await satisfies(`/api/block?header_hash=${first.header_hash}`, C.BlockResponse);
  });
});
