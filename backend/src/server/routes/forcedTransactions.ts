import { Request, Response } from "express";
import { LIMIT, getForcedTransactionsPage } from "../../db/forcedTransactions";
import { decodeForcedVerdict } from "../../decode/forcedVerdict";
import { toHex } from "../../utils";
import { parseOptionalHexQuery, parsePageParam } from "../validate";

export async function getForcedTransactionsPageRoute(
  req: Request,
  res: Response,
) {
  const parsedPage = parsePageParam(req.params.page, LIMIT);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const page = parsedPage.value;
  const parsedId = parseOptionalHexQuery(req.query.id);
  if (!parsedId.ok) return res.status(400).json({ error: parsedId.error });
  const id = parsedId.value;
  const { rows, hasNextPage, total, limit, page: served } =
    await getForcedTransactionsPage(page, id);
  const payload = await Promise.all(
    rows.map(async (row) => {
      const verdict = await decodeForcedVerdict(row.forced_inclusion_value);
      return {
        tx_order_id: toHex(row.tx_order_id),
        tx_order_l1_tx_hash: toHex(row.tx_order_l1_tx_hash),
        tx_order_l1_output_index: row.tx_order_l1_output_index,
        tx_id: toHex(row.tx_id),
        operator_validity: verdict?.verdict ?? "Unknown",
        operator_verdict_reason: verdict?.reason ?? null,
        status: row.status,
        inclusion_time: row.inclusion_time,
        projected_header_hash: row.projected_header_hash
          ? toHex(row.projected_header_hash)
          : null,
      };
    }),
  );
  return res.json({ rows: payload, hasNextPage, total, limit, page: served });
}
