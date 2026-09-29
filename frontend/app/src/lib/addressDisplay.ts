import type { AddressResponse } from "@midgard-explorer/contracts";

/** The address as a reader wants it on the Raw tab: what it holds and this
 * page of its activity, with each transaction named rather than repeated in
 * full.
 *
 * Paging cursors and each transaction body stay in the API response, one link
 * away. `spent` is null where inputs were pruned, which means unknown, not
 * zero. */
export function addressForDisplay(address: string, data: AddressResponse) {
  return {
    address,
    balance: data.balance,
    ...(data.undecodedOutputs > 0 ? { undecodedOutputs: data.undecodedOutputs } : {}),
    utxoCount: data.utxoCount,
    txCount: data.txCount,
    firstActivity: data.firstActivity,
    latestActivity: data.latestActivity,
    history: data.history.map((row) => ({
      txId: row.tx_id,
      status: row.status,
      settlement: row.finalization_status,
      block: row.header_hash === null ? null : { headerHash: row.header_hash, height: row.height },
      timestamp: row.time_stamp_tz,
      received: row.received,
      spent: row.spentComplete ? row.spent : null,
    })),
    utxos: data.utxos.map((utxo) => ({
      outRef:
        utxo.txId === null || utxo.index === null ? utxo.outRefHex : `${utxo.txId}#${utxo.index}`,
      value: utxo.value,
      hasDatum: utxo.hasDatum,
      hasScriptRef: utxo.hasScriptRef,
    })),
  };
}
