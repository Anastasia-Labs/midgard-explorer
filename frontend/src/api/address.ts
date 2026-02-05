import axios from "axios";
export async function fetchAddressTransactions(address: string) {
  if (!address) {
    throw new Error("Missing address");
  }

  const url = `/api/address?address=${encodeURIComponent(address)}`;
  const response = await axios.get(url);
  return response.data;
}
