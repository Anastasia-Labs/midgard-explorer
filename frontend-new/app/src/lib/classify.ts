/** Universal-search identifier classification.
 * Midgard: block header hash = 56 hex (Blake2b-224), tx hash = 64 hex
 * (verified against backend route validation). Addresses: bech32 prefix,
 * charset, and BIP-173 checksum, so a mistyped address is rejected in place
 * instead of navigating to an empty result page. */
const BECH32_CHARSET = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/;
const ADDRESS_PREFIXES = ["addr1", "addr_test1", "stake1", "stake_test1"];

/** BIP-173 bech32 checksum. Cardano shelley addresses use plain bech32
 * (not bech32m), so the constant is 1. Zero-dependency by choice: the whole
 * algorithm is 30 lines and adding a package for it is not worth the
 * supply-chain surface. */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

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

export function bech32ChecksumValid(s: string): boolean {
  const lower = s.toLowerCase();
  if (lower !== s && s.toUpperCase() !== s) return false; // mixed case
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return false;
  const hrp = lower.slice(0, sep);
  const data: number[] = [];
  for (const ch of lower.slice(sep + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v === -1) return false;
    data.push(v);
  }
  return polymod([...hrpExpand(hrp), ...data]) === 1;
}

export type Classification =
  | { kind: "transaction"; value: string }
  | { kind: "block"; value: string }
  | { kind: "address"; value: string }
  | { kind: "invalid"; reason: string };

export function classify(raw: string): Classification {
  const input = raw.trim();
  if (input.length === 0) return { kind: "invalid", reason: "Enter a search term." };
  if (/^[0-9a-fA-F]{64}$/.test(input)) return { kind: "transaction", value: input.toLowerCase() };
  if (/^[0-9a-fA-F]{56}$/.test(input)) return { kind: "block", value: input.toLowerCase() };

  const prefix = ADDRESS_PREFIXES.find((p) => input.startsWith(p));
  if (prefix) {
    const data = input.slice(prefix.length);
    if (data.length >= 6 && BECH32_CHARSET.test(data.toLowerCase())) {
      if (!bech32ChecksumValid(input)) {
        return {
          kind: "invalid",
          reason:
            "That address has an invalid checksum. Check it for a typo or a missing character.",
        };
      }
      return { kind: "address", value: input };
    }
    return { kind: "invalid", reason: "Looks like an address but contains invalid characters." };
  }

  if (/^[0-9a-fA-F]+$/.test(input)) {
    return {
      kind: "invalid",
      reason: `Hex of length ${input.length}. A transaction hash is 64 characters, a block header hash is 56.`,
    };
  }

  return {
    kind: "invalid",
    reason:
      "Not a recognized identifier. Expected a 64-hex transaction hash, a 56-hex block header hash, or a bech32 address (addr…/stake…).",
  };
}

export function hrefFor(c: Classification): string | null {
  switch (c.kind) {
    case "transaction":
      return `/transaction/${c.value}`;
    case "block":
      return `/block/${c.value}`;
    case "address":
      return `/address/${c.value}`;
    case "invalid":
      return null;
  }
}
