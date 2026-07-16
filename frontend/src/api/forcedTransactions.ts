import { api } from "./client";

export type ForcedTxStatus = "awaiting" | "projected" | "finalized";

export type OperatorValidity =
  | "TxIsValid"
  | "NonExistentInputUtxo"
  | "InvalidSignature"
  | "FailedScript"
  | "FeeTooLow"
  | "UnbalancedTx";

export type ForcedTxRow = {
  tx_order_id: string;
  tx_order_l1_tx_hash: string;
  tx_order_l1_output_index: number;
  tx_id: string;
  operator_validity: OperatorValidity;
  status: ForcedTxStatus;
  inclusion_time: string;
  projected_header_hash: string | null;
};

type ForcedTransactionsPageResponse = {
  rows: ForcedTxRow[];
  total: number;
  limit: number;
  hasNextPage: boolean;
};

export async function fetchForcedTransactionsPage(page: number) {
  const response = await api.get(`/api/forced-transactions/${page}`);
  const data = response.data ?? {};
  const rows: ForcedTxRow[] = Array.isArray(data?.rows) ? data.rows : [];
  return {
    rows,
    total: typeof data.total === "number" ? data.total : 0,
    limit: typeof data.limit === "number" ? data.limit : rows.length,
    hasNextPage: Boolean(data.hasNextPage),
  } as ForcedTransactionsPageResponse;
}
