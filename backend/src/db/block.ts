import { prisma } from "../db";
import { config } from "../config";

export async function getAllBlocks() {
  return prisma.blocks.findMany();
}

export async function getBlock(headerHash: string) {
  const bytes = Buffer.from(headerHash, "hex");
  return prisma.$queryRaw<
    Array<{
      height: number;
      header_hash: Uint8Array;
      tx_id: Uint8Array;
      time_stamp_tz: Date;
      tx: Uint8Array | null;
    }>
  >`SELECT b.height,
      b.header_hash,
      b.tx_id,
      b.time_stamp_tz,
      COALESCE(i.tx, m.tx) AS tx
    FROM blocks AS b
    LEFT JOIN immutable AS i
      ON b.tx_id = i.tx_id
    LEFT JOIN mempool AS m
      ON b.tx_id = m.tx_id
    WHERE b.header_hash = ${bytes}
    ORDER BY b.height DESC;`;
}

export async function getLastBlocks(count: number) {
  const latestHeights = await prisma.blocks.findMany({
    distinct: ["header_hash"],
    orderBy: { height: "desc" },
    take: count,
    select: { header_hash: true },
  });
  const headerHashes = latestHeights.map((row) => row.header_hash);
  if (headerHashes.length === 0) {
    return [];
  }
  return prisma.blocks.findMany({
    where: { header_hash: { in: headerHashes } },
    orderBy: { height: "desc" },
  });
}

export async function getLastTransactions(count: number) {
  return prisma.blocks.findMany({ orderBy: { height: "desc" }, take: count });
}

export async function getTotalBlocks() {
  const rows = await prisma.blocks.groupBy({ by: ["header_hash"] });
  return rows.length;
}

export async function getBlocksPage(page: number) {
  const limit = config.BLOCKS_PER_PAGE;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const [rows, total] = await Promise.all([
    prisma.blocks.findMany({
      distinct: ["header_hash"],
      orderBy: { height: "desc" },
      skip: (safePage - 1) * limit,
      take: limit,
      select: {
        header_hash: true,
        time_stamp_tz: true,
      },
    }),
    prisma.blocks.groupBy({ by: ["header_hash"] }).then((res) => res.length),
  ]);
  const hasNextPage = safePage * limit < total;
  return { rows, hasNextPage, total, limit };
}
