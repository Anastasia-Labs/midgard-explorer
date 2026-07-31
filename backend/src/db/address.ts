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

/** History rows carry their block and timing so the address page reads as a
 * statement rather than a list of hashes. `blocks` is left-joined because a
 * transaction can touch an address before any block carries it. */
export async function getAddressHistory(address: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      tx_id: Uint8Array;
      address: string;
      tx: Uint8Array;
      height: number | null;
      header_hash: Uint8Array | null;
      time_stamp_tz: Date | null;
      in_immutable: boolean;
    }>
  >`SELECT ah.tx_id,
      ah.address,
      tx_union.tx,
      b.height,
      b.header_hash,
      b.time_stamp_tz,
      (i.tx_id IS NOT NULL) AS in_immutable
    FROM (
      SELECT tx_id, tx FROM mempool
      UNION
      SELECT tx_id, tx FROM immutable
    ) AS tx_union
    INNER JOIN address_history AS ah
      ON tx_union.tx_id = ah.tx_id
    LEFT JOIN blocks AS b
      ON b.tx_id = ah.tx_id
    LEFT JOIN immutable AS i
      ON i.tx_id = ah.tx_id
    WHERE ah.address = ${address}
    ORDER BY b.height DESC NULLS FIRST;`;

  return rows.map((row) => ({
    ...row,
    tx_id: Buffer.from(row.tx_id).toString("hex"),
    tx: Buffer.from(row.tx).toString("hex"),
    header_hash: row.header_hash
      ? Buffer.from(row.header_hash).toString("hex")
      : null,
  }));
}
