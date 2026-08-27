import { Request, Response } from "express";
import { getDepositsPage } from "../../db/deposits";
import { computeBalance } from "../../decode/transaction";
import { toHex } from "../../utils";
import { parseOptionalHexQuery, parsePageParam } from "../validate";

export async function getDepositsPageRoute(req: Request, res: Response) {
  const parsedPage = parsePageParam(req.params.page);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const page = parsedPage.value;
  const parsedId = parseOptionalHexQuery(req.query.id);
  if (!parsedId.ok) return res.status(400).json({ error: parsedId.error });
  const id = parsedId.value;
  const { rows, hasNextPage, total, limit } = await getDepositsPage(page, id);
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
