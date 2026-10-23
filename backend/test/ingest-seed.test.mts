import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { admitEvidenceProvenance, assertSecurityGradeEvidence } from "@al-ft/midgard-sdk";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { readHead } from "../src/archive/reader.js";
import { runIngest } from "../ingest/run.js";
import type { PayloadSource } from "../ingest/ingestBlock.js";

/**
 * Walking back from a seed header (P5).
 *
 * A seed is a header someone supplied, with a stated source. It is never the
 * tip: it sets no canonical chain and no heights. The walk follows each
 * payload's `prevHeaderHash` until it reaches genesis, a header already
 * archived, a header no peer serves, or its block or time bound. A second,
 * different seed is another ancestry, never evidence of a rollback.
 */

const FP = "ab".repeat(32);
type Row = { headerHash: string; prevHeaderHash: string; identity: string };
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/da-payloads-f4cf28ca1.json", import.meta.url), "utf8"),
) as { chain: [Row, Row, Row]; fork: Row; withTransaction: [Row, Row]; sharedTxId: string };
const [c1, c2, c3] = fixture.chain;
const { fork } = fixture;
const GENESIS = "00".repeat(28);

const servingOnly = (rows: Row[]): PayloadSource => ({
  sourceId: "stub",
  async fetchPayloadByHeaderHash(headerHash, options) {
    const row = rows.find((r) => r.headerHash === headerHash);
    if (!row) {
      return { ok: false, sourceId: "stub", attempts: [{ sourceId: "stub", sourcePeerId: "p", protocol: "payload-by-header", status: "not_found", detail: "" }] };
    }
    const payloadEnvelopeCbor = Buffer.from(row.identity, "hex");
    await options?.verifyPayload?.(payloadEnvelopeCbor);
    return {
      ok: true,
      sourceId: "stub",
      sourcePeerId: "p",
      payloadEnvelopeCbor,
      metadata: {},
      attempts: [],
      provenance: assertSecurityGradeEvidence(
        admitEvidenceProvenance({
          provenance: { trustClass: "public_or_permissionless_da", sourceId: "stub/p", grade: "security" },
        }),
      ),
    };
  },
});
const everything = servingOnly([c1, c2, c3, fork]);

const seed = (store: FsArchiveStore, seeds: Array<{ headerHash: string; source: string }>, extra = {}) =>
  runIngest({
    store,
    fingerprint: FP,
    headerHashes: [],
    seeds,
    genesisHeaderHash: GENESIS,
    maxBlocks: 100,
    timeBudgetMs: 60_000,
    sources: [everything],
    limits: { maxPayloadBytes: 64 * 1024 * 1024 },
    retries: 0,
    owner: "test",
    leaseMs: 60_000,
    ...extra,
  });

const archived = async (store: FsArchiveStore) =>
  ((await readHead(store, FP))?.generation.references ?? [])
    .filter((k) => k.includes("/blocks/"))
    .map((k) => k.split("/blocks/")[1]!.slice(0, 56));

const newStore = () => new FsArchiveStore(mkdtempSync(join(tmpdir(), "seed-")));

describe("a seed", () => {
  it("is walked back to genesis, and recorded with its stated source", async () => {
    const store = newStore();
    const report = await seed(store, [{ headerHash: c3.headerHash, source: "tx-status of tx 6dfc…" }]);
    expect(report.walks).toEqual([{ seed: c3.headerHash, archived: 3, stop: "genesis" }]);
    expect((await archived(store)).sort()).toEqual([c1, c2, c3].map((r) => r.headerHash).sort());
    expect((await readHead(store, FP))!.generation.seeds).toEqual([
      { headerHash: c3.headerHash, source: "tx-status of tx 6dfc…", stop: "genesis" },
    ]);
  });

  it("from another branch keeps both ancestries and infers no rollback", async () => {
    const store = newStore();
    await seed(store, [{ headerHash: c3.headerHash, source: "first" }]);
    const report = await seed(store, [{ headerHash: fork.headerHash, source: "second" }]);
    expect(report.walks).toEqual([{ seed: fork.headerHash, archived: 1, stop: "archived" }]);
    expect((await archived(store)).sort()).toEqual([c1, c2, c3, fork].map((r) => r.headerHash).sort());
    const seeds = (await readHead(store, FP))!.generation.seeds as Array<{ headerHash: string; source: string }>;
    expect(seeds.map((s) => [s.headerHash, s.source])).toEqual([
      [c3.headerHash, "first"],
      [fork.headerHash, "second"],
    ]);
  });

  it("stops at its block bound, and at the first header no peer serves", async () => {
    const bounded = await seed(newStore(), [{ headerHash: c3.headerHash, source: "s" }], { maxBlocks: 1 });
    expect(bounded.walks).toEqual([{ seed: c3.headerHash, archived: 1, stop: "block_limit" }]);
    const gap = await seed(newStore(), [{ headerHash: c3.headerHash, source: "s" }], {
      sources: [servingOnly([c3, c1])],
    });
    expect(gap.walks).toEqual([{ seed: c3.headerHash, archived: 1, stop: "gap", gapAt: c2.headerHash }]);
  });

  it("is a no-op when walked again", async () => {
    const store = newStore();
    await seed(store, [{ headerHash: c3.headerHash, source: "s" }]);
    const first = (await readHead(store, FP))!.key;
    const again = await seed(store, [{ headerHash: c3.headerHash, source: "s" }]);
    expect(again.published).toBe(false);
    expect((await readHead(store, FP))!.key).toBe(first);
  });
});

describe("a transaction in two archived blocks", () => {
  /** Two blocks can carry one transaction; each gets its own observation,
   * and neither replaces the other. */
  it("gets one observation per block, both published", async () => {
    const txs = JSON.parse(
      readFileSync(new URL("./fixtures/da-payloads-transactions.json", import.meta.url), "utf8"),
    ) as { chain: Row[]; fork: Row; sharedTxId: string };
    const [first] = txs.chain;
    const store = newStore();
    await seed(store, [
      { headerHash: first!.headerHash, source: "s" },
      { headerHash: txs.fork.headerHash, source: "s" },
    ], { sources: [servingOnly([...txs.chain, txs.fork])] });
    const references = (await readHead(store, FP))!.generation.references;
    const observations = references.filter((k) => k.startsWith(`${FP}/txs/${txs.sharedTxId}/`));
    expect(observations).toHaveLength(2);
    for (const block of [first!, txs.fork]) {
      expect(observations.some((k) => k.includes(`/${block.headerHash}-`))).toBe(true);
    }
    const one = JSON.parse(new TextDecoder().decode((await store.get(observations[0]!))!.bytes));
    expect(one).toMatchObject({ txId: txs.sharedTxId, kind: "transactions", index: 0, page: 0 });
  });
});
