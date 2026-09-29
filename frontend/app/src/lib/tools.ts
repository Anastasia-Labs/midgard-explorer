import { decode as decodeCbor } from "cborg";
import { assetLabel } from "./asset";

/**
 * Pure functions behind the standalone developer utilities.
 *
 * Kept out of the components so they are testable without a DOM, and so the
 * same conversions can be reused wherever else they are needed. Every one of
 * them takes untrusted input from a paste box, so the contract is: throw a
 * message a human can act on, or return a tagged failure. Never guess.
 */

const HEX = /^[0-9a-fA-F]*$/;

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? []);

/** Strips a `0x` prefix and any whitespace, which is how bytes actually arrive
 * from a terminal, a log or another explorer. */
export function normalizeHex(input: string): string {
  const stripped = input
    .trim()
    .replace(/\s+/g, "")
    .replace(/^0[xX]/, "");
  if (!HEX.test(stripped)) throw new Error("Not hex: expected characters 0-9 and a-f only.");
  if (stripped.length % 2 !== 0) throw new Error("Hex must have an even number of characters.");
  return stripped.toLowerCase();
}

/** Lovelace to ada. Integer arithmetic throughout: ada amounts routinely exceed
 * what a double can represent exactly, and a balance that is off by a lovelace
 * is a wrong balance. */
export function lovelaceToAda(lovelace: string): string {
  const trimmed = lovelace.trim();
  if (!/^-?\d+$/.test(trimmed)) throw new Error("Lovelace must be a whole number.");
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const n = BigInt(digits);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  const sign = negative && n !== 0n ? "-" : "";
  if (frac === 0n) return `${sign}${whole}`;
  return `${sign}${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

export function adaToLovelace(ada: string): string {
  const trimmed = ada.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) throw new Error("Ada must be a decimal number.");
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", frac = ""] = unsigned.split(".");
  if (frac.length > 6) {
    throw new Error("Ada has at most six decimal places; one lovelace is the smallest unit.");
  }
  const scaled = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0") || "0");
  return `${negative && scaled !== 0n ? "-" : ""}${scaled}`;
}

export type AssetUnitParts = {
  policyId: string;
  assetName: string;
  /** The decoded name, or null when the bytes do not read as text the explorer
   * is willing to show. Never a guess. */
  readable: string | null;
};

/** An asset unit is a 28-byte policy id followed by the asset name. */
export function splitAssetUnit(unit: string): AssetUnitParts {
  const hex = normalizeHex(unit);
  if (hex.length < 56) {
    throw new Error("An asset unit starts with a 56-character policy id.");
  }
  const policyId = hex.slice(0, 56);
  const assetName = hex.slice(56);
  if (assetName === "") return { policyId, assetName: "", readable: "" };
  const { label, canonical } = assetLabel(assetName);
  return { policyId, assetName, readable: canonical ? null : label };
}

export type CborResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Bytes and bigints do not survive JSON, so they are rendered the way the rest
 * of the explorer renders them: bytes as `0x`-prefixed hex, bigints as decimal
 * strings. */
function toDisplayable(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return `0x${[...value].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toDisplayable);
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value].map(([k, v]) => [String(toDisplayable(k)), toDisplayable(v)]),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toDisplayable(v)]));
  }
  return value;
}

/**
 * Decode a CBOR payload pasted as hex.
 *
 * Returns a tagged failure rather than throwing: this runs on every keystroke
 * of a paste box, and a half-typed value is the normal case, not an error worth
 * breaking the page over.
 */
export function decodeCborHex(input: string): CborResult {
  let hex: string;
  try {
    hex = normalizeHex(input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (hex === "") return { ok: false, error: "Nothing to decode." };
  try {
    // `cborg` is the same decoder the Midgard codec uses, so a payload this
    // page accepts is one the backend would also read.
    const value = decodeCbor(hexToBytes(hex), { useMaps: true });
    return { ok: true, value: toDisplayable(value) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "This is not valid CBOR.",
    };
  }
}
