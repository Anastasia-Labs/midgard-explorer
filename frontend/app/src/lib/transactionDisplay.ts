import type { Association, TransactionWithMeta, TxInclusion } from "@midgard-explorer/contracts";

/** The transaction as a reader wants it on the Raw tab: its own facts, in the
 * order the page presents them.
 *
 * The API response also carries the explorer's plumbing: which database it
 * read, the deployment manifest, admission attempt counts, how settlement was
 * reconciled. That stays in the API response, one link away, and out of the
 * JSON a reader copies. `cborTruncated` appears only when it is true, because
 * then the hex below it is not the whole transaction. */
export function transactionForDisplay({
  tx,
  status,
  inclusion,
  cardano,
}: {
  tx: TransactionWithMeta;
  status: string;
  inclusion: TxInclusion | null;
  cardano: Association | null | undefined;
}) {
  const l1TxHash = cardano && "l1TxHash" in cardano ? cardano.l1TxHash : null;
  const l1State = cardano?.evidence.find((item) => item.rawState !== null)?.rawState ?? null;
  return {
    txId: tx.txId,
    status,
    block: inclusion ? { headerHash: inclusion.header_hash, height: inclusion.height } : null,
    timestamp: tx.timestamp,
    fee: tx.fee,
    size: tx.size,
    validity: tx.validity,
    validityInterval: tx.validityInterval,
    networkId: tx.networkId,
    inputs: tx.inputs.map((input) => ({
      txId: input.txId,
      index: input.index,
      address: input.resolved?.address ?? null,
      value: input.resolved?.value ?? null,
    })),
    outputs: tx.outputs.map((output) => ({
      index: output.index,
      address: output.address,
      value: output.value,
      datum: output.datum,
      scriptRef: output.scriptRef,
      status: output.state.status,
      spentBy: output.state.consumedBy
        ? `${output.state.consumedBy.txId}#${output.state.consumedBy.index}`
        : null,
    })),
    referenceInputs: tx.referenceInputs.map((input) => ({
      txId: input.txId,
      index: input.index,
      address: input.resolved?.address ?? null,
      value: input.resolved?.value ?? null,
    })),
    mint: tx.mint,
    requiredSigners: tx.requiredSigners,
    requiredObservers: tx.requiredObservers,
    scriptIntegrityHash: tx.scriptIntegrityHash,
    auxiliaryDataHash: tx.auxiliaryDataHash,
    witnesses: tx.witnesses,
    settlement: l1TxHash === null ? null : { l1TxHash, state: l1State },
    cborHex: tx.cborHex,
    ...(tx.cborTruncated ? { cborTruncated: true } : {}),
  };
}
