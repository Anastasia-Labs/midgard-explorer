import { blake2b } from "@noble/hashes/blake2.js";

/** Native asset identity.
 *
 * An asset on Midgard is a policy ID and an asset name, both raw bytes. Three
 * things follow, and getting any of them wrong misidentifies value:
 *
 *   1. An asset name is bytes, not text. Most are UTF-8, some are binary, and
 *      a few are UTF-8 that happens to contain control characters or
 *      right-to-left overrides. Rendering those as text lets an asset name
 *      impersonate a label the explorer wrote. So a name is only shown as text
 *      when it decodes cleanly, is printable, and re-encodes to exactly the
 *      bytes we started with; otherwise the hex stands as the name.
 *   2. The canonical identifier is the hex, always. Decoded text is a
 *      convenience shown next to it, never a replacement for it.
 *   3. Two different assets can share a display name. CIP-14 fingerprints exist
 *      precisely for this and are the identifier a reader should compare.
 */

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function toWords(bytes: Uint8Array): number[] {
  let acc = 0;
  let bits = 0;
  const words: number[] = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

function bech32(hrp: string, bytes: Uint8Array): string {
  const words = toWords(bytes);
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => BECH32_CHARSET[w]).join("")}`;
}

const HEX = /^[0-9a-fA-F]*$/;

export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** CIP-14: bech32 over blake2b-160 of the concatenated policy and name bytes,
 * with the human-readable part `asset`. This is the identifier a reader should
 * compare, because display names are not unique and policy IDs are 56 hex
 * characters of noise. Null when either half is not valid hex, since a
 * fingerprint over bytes we could not parse would identify nothing. */
export function assetFingerprint(policyId: string, nameHex: string): string | null {
  const policy = hexToBytes(policyId);
  const name = hexToBytes(nameHex);
  if (policy === null || name === null || policy.length !== 28) return null;
  const joined = new Uint8Array(policy.length + name.length);
  joined.set(policy);
  joined.set(name, policy.length);
  return bech32("asset", blake2b(joined, { dkLen: 20 }));
}

export type AssetName =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "binary"; reason: "not_utf8" | "not_printable" };

/** Characters that must never reach a label: C0 and C1 controls, the bidi
 * overrides and isolates, and the zero-width joiners. A name carrying any of
 * these can reorder or hide the text around it, which is how a token
 * impersonates another one in a list. */
const UNSAFE = new RegExp(
  [
    "[\\u0000-\\u001f\\u007f-\\u009f]", // C0 and C1 controls
    "[\\u200b-\\u200f]", // zero-width characters and directional marks
    "[\\u202a-\\u202e]", // bidi embedding and overrides
    "[\\u2066-\\u2069]", // bidi isolates
    "\\ufeff", // zero-width no-break space
  ].join("|"),
);

export function decodeAssetName(nameHex: string): AssetName {
  if (nameHex === "") return { kind: "empty" };
  const bytes = hexToBytes(nameHex);
  if (bytes === null) return { kind: "binary", reason: "not_utf8" };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { kind: "binary", reason: "not_utf8" };
  }

  // Round-tripping is the real test. A decoder that silently substitutes
  // replacement characters would otherwise turn arbitrary bytes into a
  // plausible-looking name.
  if (bytesToHex(new TextEncoder().encode(text)) !== nameHex.toLowerCase()) {
    return { kind: "binary", reason: "not_utf8" };
  }
  if (UNSAFE.test(text)) return { kind: "binary", reason: "not_printable" };
  return { kind: "text", text };
}

/** What to show as the asset's name, and whether that is the canonical form.
 * Callers must render `canonical` alongside anything not canonical. */
export function assetLabel(nameHex: string): { label: string; canonical: boolean } {
  const decoded = decodeAssetName(nameHex);
  if (decoded.kind === "text") return { label: decoded.text, canonical: false };
  if (decoded.kind === "empty") return { label: "(no name)", canonical: true };
  return { label: nameHex, canonical: true };
}

/** The unit string used as an asset's key and URL segment: policy ID followed
 * by the asset name hex, exactly as the ledger concatenates them. */
export const assetUnit = (policyId: string, nameHex: string): string => policyId + nameHex;

export function parseAssetUnit(unit: string): { policyId: string; nameHex: string } | null {
  if (unit.length < 56 || !HEX.test(unit) || unit.length % 2 !== 0) return null;
  return { policyId: unit.slice(0, 56).toLowerCase(), nameHex: unit.slice(56).toLowerCase() };
}

/** Quantities are unbounded integers. Formatting them through Number would
 * silently round anything past 2^53, which for a token supply is the
 * difference between a correct figure and a fabricated one. */
export function formatQuantity(quantity: string): string {
  const negative = quantity.startsWith("-");
  const digits = negative ? quantity.slice(1) : quantity;
  if (!/^\d+$/.test(digits)) return quantity;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}
