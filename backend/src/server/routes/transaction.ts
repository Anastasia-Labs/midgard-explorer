import { Request, Response } from "express";
import { getTotalTransactions, getTransaction } from "../../db/transaction";
import { toHex } from "../../utils";

export async function getTransactionRoute(req: Request, res: Response) {
  const txHash = req.query.tx_hash;
  if (typeof txHash !== "string" || txHash.length === 0) {
    return res.status(400).json({ error: "Missing tx_hash query param." });
  }

  const tx = await getTransaction(txHash);
  if (!tx) {
    return res.status(404).json({ error: "Transaction not found." });
  }

  return res.json({
    tx: {
      ...tx,
      tx_id: toHex(tx.tx_id),
      tx: toHex(tx.tx),
    },
  });
}

export async function getTotalTransactionsRoute(_req: Request, res: Response) {
  const total = await getTotalTransactions();
  return res.json({ total });
}
