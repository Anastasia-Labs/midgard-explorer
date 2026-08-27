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

/** The network the L1 address is encoded for, or null when the deployment
 * manifest cannot be read.
 *
 * Null rather than a throw: the manifest is needed for one field of this
 * response, and `db/l1.ts` already treats an unreadable manifest as a loss of
 * attribution rather than a loss of the record. A listing that 500s because a
 * path is wrong is a worse answer than a listing whose addresses say why they
 * are not encoded. */
export function networkFor(path: string): "preprod" | "mainnet" | null {
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
  const page = Number(req.params.page);
  if (!Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: "Invalid page." });
  }
  const id = typeof req.query.id === "string" ? req.query.id.toLowerCase() : undefined;
  if (id !== undefined && !/^[0-9a-f]+$/.test(id)) {
    return res.status(400).json({ error: "id must be hexadecimal." });
  }
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
