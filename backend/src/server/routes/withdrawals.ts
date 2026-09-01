import { Request, Response } from "express";
import { config } from "../../config";
import {
  decodeWithdrawalAddress,
  decodeWithdrawalValue,
} from "../../decode/withdrawal";
import { getWithdrawalsPage } from "../../db/withdrawals";
import { loadManifest } from "../../indexer/manifest";
import { logger } from "../../logger";
import { toHex } from "../../utils";
import { parseOptionalHexQuery, parsePageParam } from "../validate";

/** The network the L1 address is encoded for, or null when the deployment
 * manifest cannot be read.
 *
 * Null rather than a throw: the manifest is needed for one field of this
 * response, and `db/l1.ts` already treats an unreadable manifest as a loss of
 * attribution rather than a loss of the record. A listing that 500s because a
 * path is wrong is a worse answer than a listing whose addresses say why they
 * are not encoded. */
export function networkFor(
  path: string | undefined,
): "preprod" | "mainnet" | null {
  try {
    return loadManifest(path).network;
  } catch (error) {
    logger.warn(`Could not read the deployment manifest for a network: ${String(error)}`);
    return null;
  }
}

const NO_NETWORK =
  "The deployment manifest could not be read, so the address network is unknown.";

export async function getWithdrawalsPageRoute(req: Request, res: Response) {
  const parsedPage = parsePageParam(req.params.page);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const page = parsedPage.value;
  const parsedId = parseOptionalHexQuery(req.query.id);
  if (!parsedId.ok) return res.status(400).json({ error: parsedId.error });
  const id = parsedId.value;
  const { rows, hasNextPage, total, limit } = await getWithdrawalsPage(page, id);
  const network = networkFor(config.MIDGARD_MANIFEST_PATH);
  const payload = rows.map((row) => {
    const decodedValue = decodeWithdrawalValue(row.l2_value);
    const decodedAddress =
      network === null
        ? { value: null, error: NO_NETWORK }
        : decodeWithdrawalAddress(row.l1_address, network);
    return {
      event_id: toHex(row.event_id),
      withdrawal_l1_tx_hash: toHex(row.withdrawal_l1_tx_hash),
      withdrawal_l1_output_index: row.withdrawal_l1_output_index,
      l2_outref: toHex(row.l2_outref),
      l2_value: decodedValue.value,
      l2_value_raw: toHex(row.l2_value),
      l2_value_decode_error: decodedValue.error,
      l1_address: toHex(row.l1_address),
      l1_address_bech32: decodedAddress.value,
      l1_address_decode_error: decodedAddress.error,
      validity: row.validity,
      status: row.status,
      inclusion_time: row.inclusion_time,
      projected_header_hash: row.projected_header_hash
        ? toHex(row.projected_header_hash)
        : null,
    };
  });
  return res.json({ rows: payload, hasNextPage, total, limit });
}
