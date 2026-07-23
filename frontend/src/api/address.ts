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
  undecodedOutputs: number;
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
    undecodedOutputs:
      typeof data.undecodedOutputs === "number" &&
      Number.isFinite(data.undecodedOutputs)
        ? Math.max(0, Math.floor(data.undecodedOutputs))
        : 0,
    history: Array.isArray(data.history) ? data.history : [],
  };
}
