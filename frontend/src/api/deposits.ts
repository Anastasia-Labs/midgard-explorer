import { api } from "./client";
import type { ValueView } from "../cddl";

export type DepositStatus = "awaiting" | "projected" | "consumed";

export type DepositRow = {
  event_id: string;
  deposit_l1_tx_hash: string;
  ledger_tx_id: string;
  ledger_address: string;
  status: DepositStatus;
  inclusion_time: string;
  projected_header_hash: string | null;
  value: ValueView | null;
};

type DepositsPageResponse = {
  rows: DepositRow[];
  total: number;
  limit: number;
  hasNextPage: boolean;
};

export async function fetchDepositsPage(page: number) {
  const response = await api.get(`/api/deposits/${page}`);
  const data = response.data ?? {};
  const rows: DepositRow[] = Array.isArray(data?.rows) ? data.rows : [];
  return {
    rows,
    total: typeof data.total === "number" ? data.total : 0,
    limit: typeof data.limit === "number" ? data.limit : rows.length,
    hasNextPage: Boolean(data.hasNextPage),
  } as DepositsPageResponse;
}
