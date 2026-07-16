import { prisma } from "../db";

export async function getAllAddressHistory() {
  return prisma.addressHistory.findMany();
}

/**
 * Current spendable UTxOs owned by an address. The node's live ledger is
 * `mempool_ledger`; deposit-sourced rows only become spendable once their
 * deposit is projected (mirrors the node's `spendablePredicate` in
 * demo/midgard-node/src/database/mempoolLedger.ts). Each `output` is
 * Midgard-native canonical CBOR; the decode layer turns it into a value.
 */
export async function getAddressUtxos(address: string) {
  return prisma.$queryRaw<Array<{ output: Uint8Array }>>`
    SELECT ml.output
    FROM mempool_ledger AS ml
    LEFT JOIN deposits_utxos AS d ON d.event_id = ml.source_event_id
    WHERE ml.address = ${address}
      AND (ml.source_event_id IS NULL OR d.projected_header_hash IS NOT NULL);`;
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
