import { prisma } from "../db";

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
