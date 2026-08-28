import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import { backfillMissingProtocolParams, refreshProtocolParams } from "../src/indexer/sync.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/** Cardano's execution limits are governance-changeable, so the explorer reads
 * them rather than compiling them in. These cover the three things that makes
 * true: they are stored per epoch, an outage does not clear what is stored,
 * and a re-read of the same epoch updates rather than duplicates. */

beforeEach(truncateL1);
afterAll(async () => {
  await truncateL1();
  await indexerPrisma.$disconnect();
});

const params = (epochNo: number) => ({
  epochNo,
  maxTxExMem: 17_500_000n,
  maxTxExSteps: 10_000_000_000n,
});

describe("refreshProtocolParams", () => {
  it("records the current epoch's execution limits", async () => {
    await refreshProtocolParams(async () => params(318));
    const row = await indexerPrisma.l1ProtocolParams.findUnique({ where: { epochNo: 318 } });
    expect(row?.maxTxExMem).toBe(17_500_000n);
    expect(row?.maxTxExSteps).toBe(10_000_000_000n);
  });

  it("keeps each epoch's own limits rather than overwriting one row", async () => {
    await refreshProtocolParams(async () => params(318));
    await refreshProtocolParams(async () => ({ ...params(319), maxTxExMem: 20_000_000n }));
    const rows = await indexerPrisma.l1ProtocolParams.findMany({ orderBy: { epochNo: "asc" } });
    expect(rows.map((r) => [r.epochNo, r.maxTxExMem])).toEqual([
      [318, 17_500_000n],
      [319, 20_000_000n],
    ]);
  });

  it("leaves stored parameters alone when the upstream read fails", async () => {
    await refreshProtocolParams(async () => params(318));
    await refreshProtocolParams(async () => {
      throw new Error("Koios responded 503");
    });
    expect(await indexerPrisma.l1ProtocolParams.count()).toBe(1);
  });

  it("stores nothing when upstream reports no epoch", async () => {
    await refreshProtocolParams(async () => null);
    expect(await indexerPrisma.l1ProtocolParams.count()).toBe(0);
  });
});

describe("backfillMissingProtocolParams", () => {
  const tx = (txHash: string, epoch: number) => ({
    txHash,
    blockHeight: 1,
    blockHash: "b".repeat(64),
    slot: 1,
    epoch,
    txTime: new Date(),
    fee: 1n,
    size: 1,
    totalOutput: 1n,
    blockIndex: 0,
    certDeposit: 0n,
    invalidBefore: null,
    invalidAfter: null,
    metadata: undefined,
  });

  it("asks only for the epochs the indexer holds transactions for", async () => {
    await indexerPrisma.l1Tx.createMany({
      data: [tx("a".repeat(64), 301), tx("b".repeat(64), 301), tx("c".repeat(64), 307)],
    });
    const asked: Array<number | undefined> = [];
    const stored = await backfillMissingProtocolParams(async (epochNo) => {
      asked.push(epochNo);
      return { ...params(epochNo ?? 0) };
    });
    expect(asked.sort()).toEqual([301, 307]);
    expect(stored).toBe(2);
  });

  it("does not re-ask for an epoch already on record", async () => {
    await indexerPrisma.l1Tx.create({ data: tx("a".repeat(64), 301) });
    await refreshProtocolParams(async () => params(301));
    const asked: Array<number | undefined> = [];
    await backfillMissingProtocolParams(async (epochNo) => {
      asked.push(epochNo);
      return params(epochNo ?? 0);
    });
    expect(asked).toEqual([]);
  });
});
