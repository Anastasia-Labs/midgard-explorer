import { prisma } from "../db";

export async function getAllAddressHistory() {
  return prisma.addressHistory.findMany();
}

export async function getAddressHistory(address: string) {
  const rows = await prisma.$queryRaw<
    Array<{ tx_id: Uint8Array; address: string; tx: Uint8Array }>
  >`SELECT ah.tx_id, ah.address, tx_union.tx
    FROM (
      SELECT tx_id, tx FROM mempool
      UNION
      SELECT tx_id, tx FROM immutable
    ) AS tx_union
    INNER JOIN address_history AS ah
      ON tx_union.tx_id = ah.tx_id
    WHERE ah.address = ${address};`;

  return rows.map((row) => ({
    ...row,
    tx_id: Buffer.from(row.tx_id).toString("hex"),
    tx: Buffer.from(row.tx).toString("hex"),
  }));
}
