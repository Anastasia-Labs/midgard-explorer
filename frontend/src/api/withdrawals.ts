import { api } from "./client";
import type { ValueView } from "../cddl";

export type WithdrawalStatus = "awaiting" | "projected" | "finalized";

export type WithdrawalRow = {
  event_id: string;
  withdrawal_l1_tx_hash: string;
  withdrawal_l1_output_index: number;
  l2_outref: string;
  l2_value: ValueView | null;
  l1_address: string;
  validity: string | null;
  status: WithdrawalStatus;
  inclusion_time: string;
  projected_header_hash: string | null;
};

type WithdrawalsPageResponse = {
  rows: WithdrawalRow[];
  total: number;
  limit: number;
  hasNextPage: boolean;
};

export async function fetchWithdrawalsPage(page: number) {
  const response = await api.get(`/api/withdrawals/${page}`);
  const data = response.data ?? {};
  const rows: WithdrawalRow[] = Array.isArray(data?.rows) ? data.rows : [];
  return {
    rows,
    total: typeof data.total === "number" ? data.total : 0,
    limit: typeof data.limit === "number" ? data.limit : rows.length,
    hasNextPage: Boolean(data.hasNextPage),
  } as WithdrawalsPageResponse;
}
