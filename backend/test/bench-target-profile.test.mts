import { describe, expect, it } from "vitest";
import { PROFILES, expectedTotals } from "../bench/profiles.mjs";
import { generateDataset, LOAD_ORDER } from "../bench/generate.mjs";

/**
 * The `target` profile, generated end to end.
 *
 * Gated behind `BENCH_TARGET=1` because it builds 5,000 blocks and every
 * transaction in them through the codec, which is far too slow for the ordinary
 * suite. It is still a test rather than a script: `target` is the profile every
 * approved budget is measured against, so "it generates" is a claim that needs
 * to be checkable rather than remembered.
 */

const RUN = process.env.BENCH_TARGET === "1";
const target = RUN ? describe : describe.skip;

target("the target profile", () => {
  const dataset = generateDataset(PROFILES.target);

  it("builds every block the profile asks for", () => {
    expect(dataset.blocks.length).toBe(PROFILES.target.blocks);
  });

  it("leaves no table empty", () => {
    const empty = LOAD_ORDER.filter((t) => (dataset.tables[t] ?? []).length === 0);
    expect(empty).toEqual([]);
  });

  it("clears the ledger floor and lands near the derived event totals", () => {
    // A floor, not a target: the shapes determine the size, and the number is
    // here to guarantee the bound is crossed.
    const ledger = dataset.tables.mempool_ledger.length;
    expect(ledger).toBeGreaterThanOrEqual(PROFILES.target.ledgerUtxos);
    // Above SCAN_LIMIT, or `asset-roster` measures the untruncated case.
    expect(ledger).toBeGreaterThan(20_000);

    const totals = expectedTotals(PROFILES.target);
    const deposits = dataset.tables.deposits_utxos.length;
    expect(Math.abs(deposits - totals.deposits) / totals.deposits).toBeLessThan(0.2);
  });

  it("holds exactly one non-terminal block and collides ~5% of timestamps", () => {
    const nonTerminal = dataset.blocks.filter(
      (b) => b.status !== "finalized" && b.status !== "abandoned",
    );
    expect(nonTerminal.length).toBe(1);
    expect(dataset.blocks.some((b) => b.status === "abandoned")).toBe(true);

    const distinct = new Set(dataset.blocks.map((b) => b.blockEndTime.getTime())).size;
    const collisionRate = (dataset.blocks.length - distinct) / dataset.blocks.length;
    expect(Math.abs(collisionRate - PROFILES.target.timestampCollisionRate))
      .toBeLessThan(0.02);
  });

  it("has enough rows for the deepest paginated workload", () => {
    // blocks-list-page-deep asks for page 100 at 25 rows a page.
    expect(dataset.tables.pending_block_finalizations.length).toBeGreaterThan(2_500);
  });
}, 900_000);
