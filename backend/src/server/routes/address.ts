import { Request, Response } from "express";
import { getAddressHistory, getAddressUtxos } from "../../db/address";
import { computeBalance, decodeTransactionSafe, decodeUtxos } from "../../decode/transaction";
import type { ValueView } from "../../decode/types";
import { toHex } from "../../utils";
import { parsePageQuery } from "../validate";

function sumValues(values: ValueView[]): ValueView {
  let lovelace = 0n;
  const assets: ValueView["assets"] = {};
  for (const value of values) {
    lovelace += value.lovelace;
    for (const [policyId, names] of Object.entries(value.assets)) {
      const policy = assets[policyId] ?? {};
      for (const [assetName, quantity] of Object.entries(names)) {
        policy[assetName] = (policy[assetName] ?? 0n) + quantity;
      }
      assets[policyId] = policy;
    }
  }
  return { lovelace, assets };
}

export async function getAddressRoute(req: Request, res: Response) {
  const address = req.query.address;
  if (typeof address !== "string" || address.length === 0) {
    return res.status(400).json({ error: "Missing address query param." });
  }
  const parsedPage = parsePageQuery(req.query.page);
  if (!parsedPage.ok) return res.status(400).json({ error: parsedPage.error });
  const page = parsedPage.value;

  const [history, utxos] = await Promise.all([
    getAddressHistory(address, page),
    getAddressUtxos(address),
  ]);
  const [{ balance, undecodedOutputs }, utxoViews] = await Promise.all([
    computeBalance(utxos.map((row) => row.output)),
    decodeUtxos(utxos),
  ]);
  const payload = await Promise.all(
    history.rows.map(async (row) => {
      const decoded = row.tx
        ? await decodeTransactionSafe(row.tx)
        : { transaction: null, error: "Transaction payload is unavailable in the node's retained data." };
      const tx = decoded.transaction;
      const received = tx
        ? sumValues(tx.outputs.filter((o) => o.address === row.address).map((o) => o.value))
        : null;
      const spentComplete = tx ? tx.inputs.every((i) => i.resolved !== null) : false;
      const spent =
        tx && spentComplete
          ? sumValues(
              tx.inputs
                .filter((i) => i.resolved?.address === row.address)
                .map((i) => i.resolved!.value),
            )
          : null;
      const status =
        row.header_hash !== null || row.tx_source === "immutable" || row.tx_source === "journal"
          ? "committed"
          : row.tx_source === "processed_mempool"
            ? "pending_commit"
            : row.tx_source === "mempool"
              ? "accepted"
              : "unknown";
      return {
        tx_id: toHex(row.tx_id),
        address: row.address,
        height: row.height,
        header_hash: row.header_hash ? toHex(row.header_hash) : null,
        time_stamp_tz: row.time_stamp_tz,
        status,
        finalization_status: row.finalization_status,
        received,
        spent,
        spentComplete,
        transaction: tx,
        decodeError: decoded.error,
      };
    }),
  );
  return res.json({
    balance,
    undecodedOutputs,
    utxoCount: utxos.length,
    utxos: utxoViews,
    txCount: history.total,
    historyPage: page,
    hasNextPage: history.hasNextPage,
    limit: history.limit,
    firstActivity: history.firstActivity,
    latestActivity: history.latestActivity,
    history: payload,
  });
}
