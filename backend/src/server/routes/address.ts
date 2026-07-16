import { Request, Response } from "express";
import { getAddressHistory, getAddressUtxos } from "../../db/address";
import { computeBalance, decodeTransactionSafe } from "../../decode/transaction";

export async function getAddressRoute(req: Request, res: Response) {
  const address = req.query.address;
  if (typeof address !== "string" || address.length === 0) {
    return res.status(400).json({ error: "Missing address query param." });
  }

  const [history, utxos] = await Promise.all([
    getAddressHistory(address),
    getAddressUtxos(address),
  ]);
  const { balance, undecodedOutputs } = await computeBalance(
    utxos.map((row) => row.output),
  );
  const payload = await Promise.all(
    history.map(async (row) => {
      const decoded = await decodeTransactionSafe(Buffer.from(row.tx, "hex"));
      return {
        tx_id: row.tx_id,
        address: row.address,
        transaction: decoded.transaction,
        decodeError: decoded.error,
      };
    }),
  );
  return res.json({ balance, undecodedOutputs, history: payload });
}
