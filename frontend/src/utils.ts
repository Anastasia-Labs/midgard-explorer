import type { TransactionView, ValueView } from "./cddl";

export function formatHash(hash: string, head = 8, tail = 6) {
  if (!hash) return "";
  if (hash.length <= head + tail + 3) return hash;
  return `${hash.slice(0, head)}...${hash.slice(-tail)}`;
}

export function formatAda(lovelace: bigint | string | number) {
  const value = typeof lovelace === "bigint" ? lovelace : BigInt(lovelace || 0);
  const whole = value / 1_000_000n;
  const fraction = value % 1_000_000n;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionStr = fraction.toString().padStart(6, "0");
  return `${wholeStr}.${fractionStr} ADA`;
}

export function formatValueView(value: ValueView) {
  const ada = formatAda(value.lovelace);
  const assetCount = Object.values(value.assets).reduce(
    (count, names) => count + Object.keys(names).length,
    0,
  );
  return assetCount > 0 ? `${ada} + ${assetCount} assets` : ada;
}

export function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function safeStringify(value: unknown) {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

export function isHexOfLength(value: string, length: number) {
  return value.length === length && /^[0-9a-fA-F]+$/.test(value);
}

/**
 * Lightweight bech32 address check (no @emurgo CSL — which can't parse Midgard's
 * protected-header addresses anyway). Validates the shape only; the backend is the
 * source of truth for decoding.
 */
export function isValidAddress(address: string) {
  if (!address) return false;
  return /^addr(_test)?1[02-9ac-hj-np-z]{8,}$/.test(address);
}

export function formatTimestamp(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

// --- TransactionView accessors (the backend already decoded; these are trivial) ---

export function getInputsCount(tx: TransactionView) {
  return tx.inputs.length;
}

export function getOutputsCount(tx: TransactionView) {
  return tx.outputs.length;
}

export function getFee(tx: TransactionView | null) {
  return tx ? BigInt(tx.fee) : 0n;
}

export function getTotalOutput(tx: TransactionView) {
  return tx.outputs.reduce(
    (sum, output) => sum + BigInt(output.value.lovelace),
    0n,
  );
}
