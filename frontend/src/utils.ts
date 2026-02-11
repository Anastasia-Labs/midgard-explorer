import { decode } from "cbor-x/decode";
import { Address } from "@emurgo/cardano-serialization-lib-browser";
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

export function formatHash(hash: string, head = 8, tail = 6) {
  if (!hash) return "";
  if (hash.length <= head + tail + 3) return hash;
  return `${hash.slice(0, head)}...${hash.slice(-tail)}`;
}

export function formatAda(lovelace: bigint) {
  const whole = lovelace / 1_000_000n;
  const fraction = lovelace % 1_000_000n;
  const wholeStr = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionStr = fraction.toString().padStart(6, "0");
  return `${wholeStr}.${fractionStr} ADA`;
}

export function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function addressToBech32(address: Uint8Array | string) {
  if (!address) return "";
  if (typeof address === "string") {
    if (address.startsWith("addr")) return address;
    if (/^[0-9a-fA-F]+$/.test(address)) {
      const bytes = new Uint8Array(address.length / 2);
      for (let i = 0; i < address.length; i += 2) {
        bytes[i / 2] = parseInt(address.slice(i, i + 2), 16);
      }
      try {
        return Address.from_bytes(bytes).to_bech32();
      } catch {
        return address;
      }
    }
    return address;
  }
  try {
    return Address.from_bytes(address).to_bech32();
  } catch {
    return toHex(address);
  }
}
