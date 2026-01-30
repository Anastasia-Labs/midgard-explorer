import { decode } from "cbor-x/decode";
import type { Transaction } from "./cddl";

export function parseCbor(cborHex: string): Transaction {
  if (!cborHex) {
    throw new Error("Missing CBOR payload");
  }

  if (!/^[0-9a-fA-F]+$/.test(cborHex)) {
    throw new Error("Invalid CBOR hex: non-hex characters found");
  }

  const bytes = new Uint8Array(cborHex.length / 2);
  for (let i = 0; i < cborHex.length; i += 2) {
    bytes[i / 2] = parseInt(cborHex.slice(i, i + 2), 16);
  }

  return decode(bytes) as Transaction;
}
