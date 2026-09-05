import { describe, expect, it } from "vitest";
import { LOAD_ORDER, generateDataset, streamDataset } from "../bench/generate.mjs";
import { PROFILES } from "../bench/profiles.mjs";

/**
 * Streaming must produce the same dataset, not a similar one.
 *
 * `stress` is 50,000 blocks and roughly 370,000 transactions; holding every
 * CBOR body at once exhausted the machine. Batching only helps if the rows are
 * identical to the in-memory path, so this compares them row for row at a
 * profile small enough to hold both.
 */
/** Rows carry bigints and Buffers, neither of which JSON serialises by default. */
const stable = (rows: readonly unknown[]): string =>
  JSON.stringify(rows, (_key, value) =>
    typeof value === "bigint" ? `${value}n` : value,
  );

describe("streamDataset", () => {
  it("emits exactly the rows the in-memory path builds", async () => {
    const whole = generateDataset(PROFILES.small);
    const seen: Record<string, unknown[]> = Object.fromEntries(
      LOAD_ORDER.map((t) => [t, [] as unknown[]]),
    );
    let batches = 0;
    await streamDataset(PROFILES.small, {}, async (tables) => {
      batches += 1;
      for (const table of LOAD_ORDER) seen[table].push(...(tables[table] ?? []));
    }, 7);

    expect(batches).toBeGreaterThan(1);
    for (const table of LOAD_ORDER) {
      expect(seen[table].length, `${table} row count`).toBe(whole.tables[table].length);
    }
    // Content, not just counts: a batch boundary must not reorder or drop.
    expect(stable(seen.da_payloads)).toBe(stable(whole.tables.da_payloads));
    expect(stable(seen.address_history)).toBe(stable(whole.tables.address_history));
    expect(stable(seen.immutable)).toBe(stable(whole.tables.immutable));
  }, 120_000);

  it("reports what it wrote, so a short ledger is visible rather than silent", async () => {
    const report = await streamDataset(PROFILES.small, {}, async () => {}, 10);
    const whole = generateDataset(PROFILES.small);
    const expected = LOAD_ORDER.reduce((n, t) => n + whole.tables[t].length, 0);
    expect(report.rows).toBe(expected);
    expect(report.ledgerRows).toBe(whole.tables.mempool_ledger.length);
  }, 120_000);
});
