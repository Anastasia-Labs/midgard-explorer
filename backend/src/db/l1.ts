import { indexerPrisma, getSyncCursor } from "../indexer/db";

const PAGE_SIZE = 25;

export async function getL1TransactionsPage(page: number, pageSize = PAGE_SIZE) {
  const current = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const skip = (current - 1) * pageSize;

  const [rows, total] = await Promise.all([
    indexerPrisma.l1Tx.findMany({
      // txTime comes from the Cardano block, so every transaction in the same
      // block ties. Without a deterministic tiebreaker, OFFSET/LIMIT can
      // repeat or drop rows across pages once the table exceeds one page.
      orderBy: [{ txTime: "desc" }, { txHash: "desc" }],
      skip,
      take: pageSize,
      include: { events: true },
    }),
    indexerPrisma.l1Tx.count(),
  ]);

  return {
    rows,
    total,
    hasNextPage: skip + rows.length < total,
    limit: pageSize,
  };
}

export async function getL1Transaction(txHash: string) {
  return indexerPrisma.l1Tx.findUnique({
    where: { txHash },
    include: { events: true },
  });
}

export async function getL1BlockHeaders(limit: number) {
  return indexerPrisma.l1BlockHeader.findMany({
    orderBy: [{ endTime: "desc" }, { headerHash: "desc" }],
    take: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 25,
  });
}

export async function getL1Summary() {
  const [transactions, events, blockHeaders, cursor, grouped] =
    await Promise.all([
      indexerPrisma.l1Tx.count(),
      indexerPrisma.l1Event.count(),
      indexerPrisma.l1BlockHeader.count(),
      getSyncCursor("l1"),
      indexerPrisma.l1Event.groupBy({
        by: ["validator"],
        _count: { validator: true },
      }),
    ]);

  return {
    transactions,
    events,
    blockHeaders,
    lastSyncedHeight: cursor?.lastBlockHeight ?? null,
    byValidator: grouped
      .map((g) => ({ validator: g.validator, count: g._count.validator }))
      .sort((a, b) => b.count - a.count),
  };
}
