import { api } from "./client";
import type { TransactionView, ValueView } from "../cddl";

export type AddressHistoryRow = {
  tx_id: string;
  address: string;
  transaction: TransactionView | null;
  decodeError: string | null;
};

export type AddressResponse = {
  balance: ValueView;
  history: AddressHistoryRow[];
};

export async function fetchAddressTransactions(
  address: string,
): Promise<AddressResponse> {
  if (!address) {
    throw new Error("Missing address");
  }

  const url = `/api/address?address=${encodeURIComponent(address)}`;
  const response = await api.get(url);
  const data = response.data ?? {};
  return {
    balance: data.balance ?? { lovelace: "0", assets: {} },
    history: Array.isArray(data.history) ? data.history : [],
  };
}
