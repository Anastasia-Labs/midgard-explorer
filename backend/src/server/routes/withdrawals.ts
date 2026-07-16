import { Request, Response } from "express";
import { getWithdrawalsPage } from "../../db/withdrawals";
import { decodeValueSafe } from "../../decode/transaction";
import { toHex } from "../../utils";

export async function getWithdrawalsPageRoute(req: Request, res: Response) {
  const page = Number(req.params.page);
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page." });
  }
  const { rows, hasNextPage, total, limit } = await getWithdrawalsPage(page);
  const payload = await Promise.all(
    rows.map(async (row) => {
      // decodeValueSafe never throws: it returns null on decode failure, which
      // isolates a bad row's l2_value without failing the whole page (mirrors
      // the deposits per-row decode isolation pattern).
      const l2_value = await decodeValueSafe(row.l2_value);
      return {
        event_id: toHex(row.event_id),
        withdrawal_l1_tx_hash: toHex(row.withdrawal_l1_tx_hash),
        withdrawal_l1_output_index: row.withdrawal_l1_output_index,
        l2_outref: toHex(row.l2_outref),
        l2_value,
        l1_address: toHex(row.l1_address),
        validity: row.validity,
        status: row.status,
        inclusion_time: row.inclusion_time,
        projected_header_hash: row.projected_header_hash
          ? toHex(row.projected_header_hash)
          : null,
      };
    }),
  );
  return res.json({ rows: payload, hasNextPage, total, limit });
}
