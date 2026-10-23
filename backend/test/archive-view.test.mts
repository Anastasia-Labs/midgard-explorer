import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { archivingKey } from "../src/archive/keys.js";
import { ArchiveView } from "../src/public/archiveView.js";
import { fixturePayloadSource, type FixtureBlock } from "../ingest/fixtureSource.js";
import { runIngest } from "../ingest/run.js";

/**
 * What a reader gets from a published archive, with no database and no
 * payload decoding: ordered block and transaction lists, one block's verified
 * header and bounded record pages, and a typed archive state for a header
 * that is not archived.
 *
 * The fixtures are Midgard's own `buildPayloadFixture` blocks at f4cf28ca1.
 * They all carry the same header times, so list order rests on ancestry.
 */

const FP = "cd".repeat(32);
const GENESIS = "00".repeat(28);
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/da-payloads-f4cf28ca1.json", import.meta.url), "utf8"),
) as { chain: [FixtureBlock, FixtureBlock, FixtureBlock]; fork: FixtureBlock };
const [c1, c2, c3] = fixture.chain;
/** Blocks carrying real native transactions; the fork re-carries the first's. */
const txs = JSON.parse(
  readFileSync(new URL("./fixtures/da-payloads-transactions.json", import.meta.url), "utf8"),
) as { chain: Array<FixtureBlock & { txIds: string[] }>; fork: FixtureBlock & { txIds: string[] }; sharedTxId: string };
const [t1, t2] = txs.chain;
const source = fixturePayloadSource([c1, c2, c3, fixture.fork, ...txs.chain, txs.fork], "test");

const ingest = (store: FsArchiveStore, seeds: string[], extra = {}) =>
  runIngest({
    store,
    fingerprint: FP,
    headerHashes: [],
    seeds: seeds.map((headerHash) => ({ headerHash, source: "fixture" })),
    genesisHeaderHash: GENESIS,
    sources: [source],
    limits: { maxPayloadBytes: 64 * 1024 * 1024 },
    retries: 0,
    owner: "test",
    leaseMs: 60_000,
    ...extra,
  });

const newStore = () => new FsArchiveStore(mkdtempSync(join(tmpdir(), "view-")));

describe("the block list", () => {
  it("keeps one generation for a response while another request sees a new publication", async () => {
    const store = newStore();
    await ingest(store, [c1.headerHash]);
    const view = new ArchiveView(store, FP);
    let published!: () => void;
    const ready = new Promise<void>((resolve) => { published = resolve; });
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    const response = view.withSnapshot(async () => {
      expect((await view.blocksPage(1, 10)).total).toBe(1);
      reading();
      await ready;
      expect(await view.entry(c2.headerHash)).toBeNull();
      expect((await view.blocksPage(1, 10)).total).toBe(1);
      const block = await view.block(c1.headerHash);
      expect(block?.state === "archived" && block.children).toEqual([]);
    });
    await started;
    await ingest(store, [c2.headerHash]);
    expect((await view.withSnapshot(() => view.blocksPage(1, 10))).total).toBe(2);
    published();
    await response;
  });

  it("lists archived blocks newest first, a descendant before its ancestor, with no heights", async () => {
    const store = newStore();
    await ingest(store, [c3.headerHash]);
    const view = new ArchiveView(store, FP);
    const page = await view.blocksPage(1, 2);
    expect(page.total).toBe(3);
    expect(page.hasNextPage).toBe(true);
    expect(page.rows.map((r) => r.headerHash)).toEqual([c3.headerHash, c2.headerHash]);
    expect((await view.blocksPage(2, 2)).rows.map((r) => r.headerHash)).toEqual([c1.headerHash]);
  });

  it("is unchanged by a repeated ingestion of the same ancestry", async () => {
    const store = newStore();
    await ingest(store, [c3.headerHash]);
    const before = await new ArchiveView(store, FP).blocksPage(1, 10);
    expect((await ingest(store, [c3.headerHash])).published).toBe(false);
    expect(await new ArchiveView(store, FP).blocksPage(1, 10)).toEqual(before);
  });
});

describe("one block", () => {
  it("is served from its manifest: verified header, both links, and what was verified", async () => {
    const store = newStore();
    await ingest(store, [c3.headerHash]);
    const found = await new ArchiveView(store, FP).block(c2.headerHash);
    expect(found?.state).toBe("archived");
    if (found?.state !== "archived") return;
    expect(found.manifest.header.prevHeaderHash).toBe(c1.headerHash);
    expect(found.children).toEqual([c3.headerHash]);
    expect(found.manifest.verification).toMatchObject({ payloadHash: "pass", headerBinding: "pass", l1: "not_observed" });
  });

  it("serves its transactions one archive page at a time", async () => {
    const store = newStore();
    await ingest(store, [t2!.headerHash]);
    const view = new ArchiveView(store, FP);
    const found = await view.block(t2!.headerHash);
    if (found?.state !== "archived") throw new Error("not archived");
    const records = await view.records(found.manifest, "transactions", 0);
    expect(records?.map((r) => r.key).sort()).toEqual([...t2!.txIds].sort());
    expect(await view.records(found.manifest, "transactions", 1)).toBeNull();
  });
});

describe("a header that is not archived", () => {
  it("is failed when no peer served it, with the reason and when", async () => {
    const store = newStore();
    await ingest(store, [c3.headerHash], { sources: [fixturePayloadSource([c3, c1], "partial")] });
    const found = await new ArchiveView(store, FP).block(c2.headerHash);
    expect(found).toMatchObject({ state: "failed", reason: "unavailable", at: expect.any(String) });
  });

  it("is awaiting when an archived block names it as its parent and nothing was tried", async () => {
    const store = newStore();
    await ingest(store, [c3.headerHash], { maxBlocks: 1 });
    expect(await new ArchiveView(store, FP).block(c2.headerHash)).toMatchObject({ state: "awaiting" });
  });

  it("is archiving only while its marker is younger than the time to live", async () => {
    const store = newStore();
    await ingest(store, [c3.headerHash], { maxBlocks: 1 });
    const at = Date.parse("2026-10-20T00:00:00Z");
    await store.putIfMatch(
      archivingKey(FP, c2.headerHash),
      new TextEncoder().encode(JSON.stringify({ headerHash: c2.headerHash, at: new Date(at).toISOString() })),
      null,
    );
    const view = (now: number) => new ArchiveView(store, FP, { now: () => now, archivingTtlMs: 60_000 });
    expect(await view(at + 1_000).block(c2.headerHash)).toMatchObject({ state: "archiving" });
    expect(await view(at + 61_000).block(c2.headerHash)).toMatchObject({ state: "awaiting" });
  });

  it("is unknown when nothing in the archive names it", async () => {
    const store = newStore();
    await ingest(store, [c3.headerHash]);
    expect(await new ArchiveView(store, FP).block("ef".repeat(28))).toBeNull();
  });
});

describe("a transaction", () => {
  it("has one observation per archived block that carries it, and is listed once per block", async () => {
    const store = newStore();
    await ingest(store, [t1!.headerHash, txs.fork.headerHash]);
    const view = new ArchiveView(store, FP);
    const seen = await view.transaction(txs.sharedTxId);
    expect(seen.map((o) => o.headerHash).sort()).toEqual([t1!.headerHash, txs.fork.headerHash].sort());
    const page = await view.transactionsPage(1, 10);
    expect(page.total).toBe(2);
    // The fork closed later, so it lists first.
    expect(page.rows.map((r) => r.headerHash)).toEqual([txs.fork.headerHash, t1!.headerHash]);
  });
});
