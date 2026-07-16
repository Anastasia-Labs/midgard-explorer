import { Request, Response } from "express";
import { getDepositsPage } from "../../db/deposits";
import { computeBalance } from "../../decode/transaction";
import { toHex } from "../../utils";

export async function getDepositsPageRoute(req: Request, res: Response) {
  const page = Number(req.params.page);
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page." });
  }
  const { rows, hasNextPage, total, limit } = await getDepositsPage(page);
  const payload = await Promise.all(
    rows.map(async (row) => {
      // Decode failure on this row: return null for value only.
      const { balance, undecodedOutputs } = await computeBalance([
        row.ledger_output,
      ]);
      const value = undecodedOutputs > 0 ? null : balance;
      return {
        event_id: toHex(row.event_id),
        deposit_l1_tx_hash: toHex(row.deposit_l1_tx_hash),
        ledger_tx_id: toHex(row.ledger_tx_id),
        ledger_address: row.ledger_address,
        status: row.status,
        inclusion_time: row.inclusion_time,
        projected_header_hash: row.projected_header_hash
          ? toHex(row.projected_header_hash)
          : null,
        value,
      };
    }),
  );
  return res.json({ rows: payload, hasNextPage, total, limit });
}
