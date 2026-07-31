import { Request, Response } from "express";
import { getAddressHistory, getAddressUtxos } from "../../db/address";
import { computeBalance, decodeTransactionSafe, decodeUtxos } from "../../decode/transaction";

export async function getAddressRoute(req: Request, res: Response) {
  const address = req.query.address;
  if (typeof address !== "string" || address.length === 0) {
    return res.status(400).json({ error: "Missing address query param." });
  }

  const [history, utxos] = await Promise.all([
    getAddressHistory(address),
    getAddressUtxos(address),
  ]);
  const [{ balance, undecodedOutputs }, utxoViews] = await Promise.all([
    computeBalance(utxos.map((row) => row.output)),
    decodeUtxos(utxos),
  ]);
  const payload = await Promise.all(
    history.map(async (row) => {
      const decoded = await decodeTransactionSafe(Buffer.from(row.tx, "hex"));
      const tx = decoded.transaction;
      // Received is exact: it reads the transaction's own outputs. Spent is
      // only exact when every input resolved, because a transaction's inputs
      // leave the ledger once it is applied (see db/ledger.ts). An unresolved
      // input is reported as unknown, never as zero.
      const received = tx
        ? tx.outputs
            .filter((o) => o.address === row.address)
            .reduce((sum, o) => sum + BigInt(o.value.lovelace), 0n)
            .toString()
        : null;
      const spentComplete = tx ? tx.inputs.every((i) => i.resolved !== null) : false;
      const spent =
        tx && spentComplete
          ? tx.inputs
              .filter((i) => i.resolved?.address === row.address)
              .reduce((sum, i) => sum + BigInt(i.resolved!.value.lovelace), 0n)
              .toString()
          : null;
      return {
        tx_id: row.tx_id,
        address: row.address,
        height: row.height,
        header_hash: row.header_hash,
        time_stamp_tz: row.time_stamp_tz,
        status: row.in_immutable ? "committed" : "pending_commit",
        received,
        spent,
        spentComplete,
        transaction: tx,
        decodeError: decoded.error,
      };
    }),
  );
  const times = payload
    .map((r) => r.time_stamp_tz)
    .filter((t): t is Date => t !== null)
    .map((t) => t.getTime());
  return res.json({
    balance,
    undecodedOutputs,
    utxoCount: utxos.length,
    utxos: utxoViews,
    txCount: payload.length,
    firstActivity: times.length > 0 ? new Date(Math.min(...times)) : null,
    latestActivity: times.length > 0 ? new Date(Math.max(...times)) : null,
    history: payload,
  });
}
