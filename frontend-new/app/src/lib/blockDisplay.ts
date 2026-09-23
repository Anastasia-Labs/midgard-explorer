import type { BlockResponse } from "@midgard-explorer/contracts";

/** The block as a reader wants it on the Raw tab: its own facts, with each
 * transaction named by id and fee rather than repeated in full.
 *
 * The API response also carries the deployment it came from, how settlement
 * was reconciled, and every transaction body. That stays in the API response,
 * one link away. */
export function blockForDisplay(data: BlockResponse) {
  const { header, finalization, da } = data;
  const l1TxHash =
    data.cardano && "l1TxHash" in data.cardano
      ? data.cardano.l1TxHash
      : (finalization?.submitted_tx_hash ?? null);
  return {
    headerHash: header.header_hash,
    height: header.height,
    startTime: header.block_start_time,
    endTime: header.block_end_time,
    counts: {
      transactions: header.header_l2_transaction_count,
      deposits: header.header_deposit_count,
      withdrawals: header.header_withdrawal_count,
      forcedTransactions: header.header_forced_transaction_count,
    },
    transactions: data.rows.map((row) => ({
      txId: row.tx_id,
      fee: row.transaction?.fee ?? null,
    })),
    events: {
      deposits: data.events.deposits,
      withdrawals: data.events.withdrawals,
      forcedTransactions: data.events.forced_transactions,
    },
    payloadRetainedLocally: header.payload_retained_locally,
    ...(da ? { eventCount: da.total_event_count, transitionSteps: da.transition_step_count } : {}),
    merkleRoots: data.commitments ?? null,
    settlement: finalization === null ? null : { l1TxHash, state: finalization.status },
  };
}
