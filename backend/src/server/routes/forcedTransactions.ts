import { Request, Response } from "express";
import { getForcedTransactionsPage } from "../../db/forcedTransactions";
import { toHex } from "../../utils";

export async function getForcedTransactionsPageRoute(
  req: Request,
  res: Response,
) {
  const page = Number(req.params.page);
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page." });
  }
  const { rows, hasNextPage, total, limit } =
    await getForcedTransactionsPage(page);
  const payload = rows.map((row) => ({
    tx_order_id: toHex(row.tx_order_id),
    tx_order_l1_tx_hash: toHex(row.tx_order_l1_tx_hash),
    tx_order_l1_output_index: row.tx_order_l1_output_index,
    tx_id: toHex(row.tx_id),
    operator_validity: row.operator_validity,
    status: row.status,
    inclusion_time: row.inclusion_time,
    projected_header_hash: row.projected_header_hash
      ? toHex(row.projected_header_hash)
      : null,
  }));
  return res.json({ rows: payload, hasNextPage, total, limit });
}
