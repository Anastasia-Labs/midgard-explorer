import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { indexerPrisma } from "../src/indexer/db.js";
import { parseTxInfo } from "../src/indexer/koios.js";
import { loadManifest } from "../src/indexer/manifest.js";
import { ingestTxInfos } from "../src/indexer/ingest.js";
import {
  getL1TransactionsPage,
  getL1Transaction,
  getL1BlockHeaders,
  getL1BlockHeader,
  getL1Deposits,
  getL1Summary,
  getSourceIdentity,
  getL1Validator,
  isFixtureDatabase,
  resetSourceIdentity,
} from "../src/db/l1.js";
import { truncateL1 } from "./helpers/truncate.mjs";

const infos = parseTxInfo(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url),
      "utf8",
    ),
  ),
);
const { validators, deploymentId } = loadManifest(
  new URL("./fixtures/manifest-sample.json", import.meta.url).pathname,
);

let reachable = false;

/** Bounded probe. A stopped container on WSL2 black-holes TCP rather than
 * refusing it, so an unguarded query hangs past Vitest's hook timeout and the
 * suite reports FAIL instead of skipping. The race turns that into a clean
 * negative. */
async function probe(): Promise<void> {
  await Promise.race([
    indexerPrisma.$queryRaw`SELECT 1;`,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("probe timed out after 3000ms")), 3000),
    ),
  ]);
}

beforeAll(async () => {
  try {
    await probe();
    reachable = true;
    await truncateL1();
    await ingestTxInfos(infos, validators, deploymentId);
  } catch (err) {
    console.warn(`Skipping: indexer Postgres unreachable. ${String(err)}`);
  }
});

afterAll(async () => {
  if (reachable) {
    await truncateL1();
    await indexerPrisma.$disconnect();
  }
});

describe("L1 read queries", () => {
  it("pages transactions newest first", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const p = await getL1TransactionsPage(1);
    expect(p.total).toBeGreaterThanOrEqual(1);
    expect(p.rows.length).toBeGreaterThanOrEqual(1);
    expect(p.limit).toBeGreaterThan(0);
  });

  it("returns a single transaction with its Midgard actions", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const tx = (await getL1Transaction(
      "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92",
    )) as { events: unknown[]; actions: Array<{ kind: string }> } | null;
    expect(tx).not.toBeNull();
    expect(Array.isArray(tx!.events)).toBe(true);
    expect(tx!.actions.some((action) => action.kind === "block_commitment")).toBe(true);
  });

  // The counts below are what this real preprod transaction actually holds.
  // It was captured before the detail flags were added, so its input,
  // reference and collateral arrays are genuinely empty, and asserting
  // otherwise would be asserting against a fixture rather than against Koios.
  it("returns every stored section of a transaction, not just its events", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const tx = (await getL1Transaction(
      "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92",
    ))!;
    expect(tx.outputs).toHaveLength(4);
    expect(tx.redeemers).toHaveLength(3);
    expect(tx.inputs).toEqual([]);
    expect(tx.referenceInputs).toEqual([]);
    expect(tx.collateral).toEqual([]);
    expect(tx.mints).toEqual([]);
  });

  it("returns the collateral output as one UTxO rather than a list", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const tx = (await getL1Transaction(
      "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92",
    ))!;
    expect(tx.collateralOutput).not.toBeNull();
    expect(tx.collateralOutput!.lovelace).toBe(2684266094n);
  });

  it("hangs native assets off the UTxO they were found in", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const tx = (await getL1Transaction(
      "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92",
    ))!;
    for (const out of tx.outputs) expect(Array.isArray(out.assets)).toBe(true);
  });

  it("returns null for an unknown transaction", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    expect(await getL1Transaction("f".repeat(64))).toBeNull();
  });

  it("returns block headers", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    expect((await getL1BlockHeaders(10)).length).toBeGreaterThanOrEqual(1);
  });

  it("returns one Cardano-observed header with protocol evidence", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const first = (await getL1BlockHeaders(1))[0]!;
    const header = await getL1BlockHeader(first.headerHash);
    expect(header?.headerHash).toBe(first.headerHash);
    expect(header?.operatorVkey).toMatch(/^[0-9a-f]{56}$/);
    expect(header?.protocolVersion).toBeGreaterThanOrEqual(0n);
  });

  it("builds validator UTxOs, history and operation groups from indexed rows", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const validator = validators.find((row) => row.scriptHash.length === 56)!;
    const detail = await getL1Validator(validator.scriptHash);
    expect(detail?.validator.scriptHash).toBe(validator.scriptHash);
    expect(Array.isArray(detail?.utxos)).toBe(true);
    expect(Array.isArray(detail?.history)).toBe(true);
    expect(Array.isArray(detail?.operations)).toBe(true);
  });

  // The two conventions in routes/l1.ts, pinned. A page number is a
  // navigation hint and coerces; an identifier names a resource and 400s.
  // Without a test, "consistent" drifts back to whichever a future edit
  // happens to prefer.
  it("coerces a nonsense page to the first page rather than failing", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const bad = await getL1TransactionsPage(Number.NaN);
    const first = await getL1TransactionsPage(1);
    expect(bad.rows.map((r: { txHash: string }) => r.txHash)).toEqual(
      first.rows.map((r: { txHash: string }) => r.txHash),
    );
  });

  it("caps the block header limit so one request cannot ask for the table", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    expect((await getL1BlockHeaders(100000)).length).toBeLessThanOrEqual(100);
  });

  it("summarises counts by validator", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const s = await getL1Summary();
    expect(s.transactions).toBeGreaterThanOrEqual(1);
    expect(s.byValidator.length).toBeGreaterThanOrEqual(1);
  });
});

/** Preprod's 6 real deposits live in the node database, not in this fixture,
 * so the row is seeded. What is under test is the query and its ordering, not
 * the decoder, which has its own tests against a real preprod datum. */
/**
 * The worst bug this project had was invisible in every diff: the explorer read
 * a phase-4 test database for weeks and presented it as the live chain. A code
 * review cannot catch that. Naming the source in the payload can.
 */
describe("source identity", () => {
  /** The one fact the banner exists to state: which database answered. Asking
   * `config` re-reads the name under suspicion, because the incident was a
   * .env whose name did not match the connection. Only the server can say. */
  it("reports the database the connection reached, not the one config names", async () => {
    const { prisma } = await import("../src/db.js");
    let nodeReachable = false;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1;`,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("probe timed out after 3000ms")),
            3000,
          ),
        ),
      ]);
      nodeReachable = true;
    } catch {
      /* falls through to the skip below */
    }
    if (!nodeReachable) return;

    const [{ db }] = await prisma.$queryRaw<Array<{ db: string }>>`
      SELECT current_database() AS db;`;
    const { config } = await import("../src/config.js");
    const original = config.POSTGRES_DB;
    resetSourceIdentity();
    // Deliberately misconfigured. The identity is read from the connection with
    // `current_database()`, so what the environment claims the database is
    // named cannot change the answer. This is the whole point: the explorer
    // spent weeks reporting figures from a database nobody thought it was
    // reading, and an echo of the configured name would have agreed with the
    // mistake.
    (config as { POSTGRES_DB?: string }).POSTGRES_DB =
      "midgard_phase4_process_txcoverage";
    try {
      const s = await getSourceIdentity();
      expect(s!.l2Database).toBe(db);
      expect(s!.isFixture).toBe(isFixtureDatabase(db));
    } finally {
      (config as { POSTGRES_DB?: string }).POSTGRES_DB = original;
      resetSourceIdentity();
    }
  });

  /** A memoised failure outlives its cause. One unreadable read at boot would
   * otherwise pin "Data source unconfirmed" on every page until a restart. */
  it("retries after a failed read instead of memoising the failure", async () => {
    const { config } = await import("../src/config.js");
    const original = config.MIDGARD_MANIFEST_PATH;
    resetSourceIdentity();
    (config as { MIDGARD_MANIFEST_PATH: string }).MIDGARD_MANIFEST_PATH =
      "/nonexistent/manifest.json";
    try {
      expect(await getSourceIdentity()).toBeNull();
      (config as { MIDGARD_MANIFEST_PATH: string }).MIDGARD_MANIFEST_PATH =
        original;
      expect(await getSourceIdentity()).not.toBeNull();
    } finally {
      (config as { MIDGARD_MANIFEST_PATH: string }).MIDGARD_MANIFEST_PATH =
        original;
      resetSourceIdentity();
    }
  });

  it("names the deployment, the network and the L2 database", async () => {
    const s = await getSourceIdentity();
    expect(s).not.toBeNull();
    expect(s!.deployment).toMatch(/^[0-9a-f]{64}$/);
    expect(s!.network).toBe("preprod");
    expect(s!.l2Database.length).toBeGreaterThan(0);
    expect(typeof s!.isFixture).toBe("boolean");
    expect(s!.validators.length).toBeGreaterThan(0);
    expect(
      s!.validators.every((validator) => validator.address.startsWith("addr")),
    ).toBe(true);
  });

  // The summary route is documented to answer whether or not anything else is
  // up, so an unreadable manifest must degrade to an unconfirmed source rather
  // than a 500. The consumer contract has a null case for exactly this.
  it("returns null rather than throwing when the manifest cannot be read", async () => {
    const { config } = await import("../src/config.js");
    const original = config.MIDGARD_MANIFEST_PATH;
    resetSourceIdentity();
    (config as { MIDGARD_MANIFEST_PATH: string }).MIDGARD_MANIFEST_PATH =
      "/nonexistent/manifest.json";
    try {
      expect(await getSourceIdentity()).toBeNull();
    } finally {
      (config as { MIDGARD_MANIFEST_PATH: string }).MIDGARD_MANIFEST_PATH =
        original;
      resetSourceIdentity();
    }
  });

  it("calls anything that is not the live node database a fixture", () => {
    expect(isFixtureDatabase("midgard")).toBe(false);
    expect(isFixtureDatabase("midgard_phase4_process_txcoverage")).toBe(true);
    // Not an allowlist: an unknown database is a fixture until proven live,
    // which is the opposite of how this went wrong before.
    expect(isFixtureDatabase("midgard_something_new")).toBe(true);
  });

  it("carries the source on the summary a viewer actually reads", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const s = await getL1Summary();
    expect(s.source?.l2Database).toBe((await getSourceIdentity())?.l2Database);
  });
});

describe("L1 deposits", () => {
  const DEPOSIT_TX = "d".repeat(64);

  beforeAll(async () => {
    if (!reachable) return;
    await indexerPrisma.l1Tx.create({
      data: {
        txHash: DEPOSIT_TX,
        blockHeight: 4980000,
        blockHash: "e".repeat(64),
        slot: 128000000,
        epoch: 303,
        txTime: new Date("2026-07-20T00:00:00Z"),
        fee: 1000n,
        size: 500,
        totalOutput: 2000000n,
        blockIndex: 0,
        certDeposit: 0n,
        events: {
          create: [
            {
              validator: "deposit",
              deployment: deploymentId,
              eventType: "deposit",
              outputIndex: 0,
              lovelace: 2000000n,
              decoded: {
                l1OutRef: { txHash: "a".repeat(64), index: 1 },
                l2PaymentCredential: "d7cb",
                inclusionTime: "1784138246999",
              },
            },
            {
              validator: "deposit",
              deployment: deploymentId,
              eventType: "unknown",
              outputIndex: 1,
              lovelace: 3000000n,
              decoded: undefined,
            },
          ],
        },
        ios: {
          create: {
            kind: "input",
            position: 0,
            sourceTxHash: "a".repeat(64),
            sourceIndex: 1,
            address: "addr_test1vr8canonicalfundingaddress",
            lovelace: 2000000n,
          },
        },
      },
    });
  });

  it("lists deposits with the transaction they arrived in", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const deposits = await getL1Deposits(10);
    expect(deposits.length).toBe(2);
    expect(deposits[0]!.tx.txHash).toBe(DEPOSIT_TX);
    expect(deposits.find((row) => row.decoded !== null)!.fundingAddresses).toEqual([
      "addr_test1vr8canonicalfundingaddress",
    ]);
  });

  // A decoder gap must be visible. Filtering undecoded deposits out would make
  // the list quietly shorter than the chain, which is the failure mode this
  // project has already had once.
  it("lists a deposit whose datum did not decode", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const deposits = await getL1Deposits(10);
    expect(deposits.some((d) => d.decoded === null)).toBe(true);
  });

  it("caps the limit so one request cannot ask for the whole table", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    expect((await getL1Deposits(100000)).length).toBeLessThanOrEqual(100);
    expect((await getL1Deposits(Number.NaN)).length).toBeGreaterThan(0);
  });
});

describe("L1 transaction paging across a same-block tie", () => {
  // txTime is populated from the Cardano block, not a per-transaction clock,
  // so every transaction in the same block gets a byte-identical txTime.
  // These five rows share one txTime on purpose: it is the exact condition
  // that requires a deterministic tiebreaker in the orderBy, and it is the
  // only way a page-boundary bug (dropped/duplicated rows, wrong hasNextPage)
  // would actually surface instead of hiding behind incidental row order.
  const tiedTxTime = new Date("2026-01-01T00:00:00.000Z");
  const syntheticHashes = Array.from(
    { length: 5 },
    (_, i) => `${"a".repeat(63)}${i}`,
  );

  beforeAll(async () => {
    if (!reachable) return;
    await truncateL1();
    await indexerPrisma.l1Tx.createMany({
      data: syntheticHashes.map((txHash, i) => ({
        txHash,
        blockHeight: 9000 + i,
        blockHash: `synthetic-block-${i}`,
        slot: 9000 + i,
        epoch: 1,
        txTime: tiedTxTime,
        fee: 0n,
        size: 0,
        totalOutput: 0n,
        blockIndex: i,
        certDeposit: 0n,
      })),
    });
  });

  afterAll(async () => {
    if (!reachable) return;
    await truncateL1();
  });

  it("keeps pages disjoint and complete when every row ties on txTime", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    const page1 = await getL1TransactionsPage(1, 2);
    const page2 = await getL1TransactionsPage(2, 2);
    const page3 = await getL1TransactionsPage(3, 2);

    expect(page1.total).toBe(5);
    expect(page1.rows.length).toBe(2);
    expect(page1.hasNextPage).toBe(true);
    expect(page2.rows.length).toBe(2);
    expect(page2.hasNextPage).toBe(true);
    expect(page3.rows.length).toBe(1);
    expect(page3.hasNextPage).toBe(false);

    const hashesPerPage = [page1, page2, page3].map((p) =>
      p.rows.map((r) => (r as { txHash: string }).txHash),
    );
    const allHashes = hashesPerPage.flat();

    // Pairwise disjoint and together covering all 5: this is what actually
    // proves the tiebreaker works, not just that each page has the right
    // length. A missing tiebreaker can repeat a tied row across pages or
    // drop one entirely while every length assertion above still passes.
    expect(new Set(allHashes).size).toBe(5);
    expect([...allHashes].sort()).toEqual([...syntheticHashes].sort());
  });

  it("orders tied timestamps deterministically by the tiebreaker", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    await truncateL1();

    // Same txTime for every row, so ONLY the tiebreaker can order them. The
    // hashes are inserted ascending while the tiebreaker sorts descending, so
    // heap order and correct order are opposites: a missing tiebreaker returns
    // the exact reverse of what this asserts.
    const tied = new Date("2026-07-26T09:32:00.000Z");
    const hashes = ["aa", "bb", "cc", "dd", "ee"].map((c) => c.repeat(32));
    await indexerPrisma.l1Tx.createMany({
      data: hashes.map((txHash, i) => ({
        txHash,
        blockHeight: 4980661,
        blockHash: "f".repeat(64),
        slot: 128458937 + i,
        epoch: 303,
        txTime: tied,
        fee: 0n,
        size: 0,
        totalOutput: 0n,
        blockIndex: i,
        certDeposit: 0n,
      })),
    });

    const page = await getL1TransactionsPage(1, 5);
    expect(page.rows.map((r: { txHash: string }) => r.txHash)).toEqual(
      [...hashes].reverse(),
    );
  });
});

/** Who spent an output is a fact the index holds and never answered: an input
 * row already points at the UTxO it consumed, and the transaction page that
 * produced that UTxO never looked. */
describe("consumed-by attribution", () => {
  const SPENT = "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92";
  const SPENDER = "b".repeat(64);

  // The paging suite above empties the index in its own hooks, so this one
  // seeds what it needs rather than reading whatever survived.
  beforeAll(async () => {
    if (!reachable) return;
    await truncateL1();
    await ingestTxInfos(infos, validators, deploymentId);
  });

  afterAll(async () => {
    if (reachable) await indexerPrisma.l1Tx.deleteMany({ where: { txHash: SPENDER } });
  });

  it("names the transaction that spent an output, and answers null for the rest", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");
    const before = (await getL1Transaction(SPENT))!;
    expect(before.outputs.length).toBeGreaterThan(1);
    expect(before.outputs.every((out) => out.spentBy === null)).toBe(true);

    const target = before.outputs[0]!;
    await indexerPrisma.l1Tx.create({
      data: {
        txHash: SPENDER,
        blockHeight: 4980999,
        blockHash: "e".repeat(64),
        slot: 128459999,
        epoch: 303,
        txTime: new Date("2026-08-01T00:00:00Z"),
        fee: 0n,
        size: 0,
        totalOutput: 0n,
        blockIndex: 0,
        certDeposit: 0n,
        ios: {
          create: {
            kind: "input",
            position: 0,
            sourceTxHash: SPENT,
            sourceIndex: target.sourceIndex,
            lovelace: target.lovelace,
          },
        },
      },
    });

    const after = (await getL1Transaction(SPENT))!;
    const spent = after.outputs.find((out) => out.sourceIndex === target.sourceIndex)!;
    expect(spent.spentBy).toBe(SPENDER);
    expect(
      after.outputs
        .filter((out) => out.sourceIndex !== target.sourceIndex)
        .every((out) => out.spentBy === null),
    ).toBe(true);

    // An input carries no spender at all. Its consumer is the transaction the
    // reader is already looking at, so the field would restate the page.
    expect(after.inputs.every((io) => !("spentBy" in io))).toBe(true);
  });
});
