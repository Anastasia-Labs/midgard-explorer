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

const get = async (path: string): Promise<unknown> => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
};

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
    await get("/healthz");
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

  it("the L1 summary, including source kind and freshness", async () => {
    if (!reachable) return;
    await satisfies("/api/l1/summary", C.L1SummaryResponse);
  });

  /**
   * The one that would have caught the original defect on the day it landed.
   *
   * `L1BlockHeader.headerHash` is branded `Hash28`, so a 32-byte Merkle root in
   * that field fails to decode here rather than silently producing a page whose
   * links go nowhere.
   */
  it("L1 block headers, keyed by a 28-byte hash", async () => {
    if (!reachable) return;
    await satisfies("/api/l1/block-headers?limit=5", Schema.Array(C.L1BlockHeader));
  });

  /** A detail response, which is where the association envelope lives. */
  it("a block detail, with its deployment context and association", async () => {
    if (!reachable) return;
    const headers = (await get("/api/l1/block-headers?limit=1")) as Array<{ headerHash: string }>;
    const first = headers[0];
    // Silence here was the whole test evaporating.
    //
    // This returned when the index held no header, so a CI job whose index was
    // never built proved nothing about the association envelope and reported a
    // pass. Where a backend is REQUIRED, a header is required too: the envelope
    // is the thing under test and it only appears on a block detail.
    if (first === undefined) {
      if (REQUIRED) {
        throw new Error(
          "The backend holds no block headers, so the association envelope was " +
            "never decoded. Seed the index before running with REQUIRE_BACKEND=1.",
        );
      }
      return;
    }
    await satisfies(`/api/block?header_hash=${first.headerHash}`, C.BlockResponse);
  });
});
