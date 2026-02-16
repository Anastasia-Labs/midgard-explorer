import { prisma } from "../db";
import { config } from "../config";

export async function getAllBlocks() {
  return prisma.blocks.findMany();
}

export async function getBlock(headerHash: string) {
  const bytes = Buffer.from(headerHash, "hex");
  return prisma.blocks.findMany({ where: { header_hash: bytes } });
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
