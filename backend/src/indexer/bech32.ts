// Minimal bech32 encoder. Hand-rolled rather than pulled from a dependency:
// this is the only encoding the indexer needs, and @lucid-evolution/lucid is a
// devDependency we do not want on the server's runtime path.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function convertBits(data: number[], from: number, to: number): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const b of data) {
    acc = (acc << from) | b;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (bits > 0) out.push((acc << (to - bits)) & maxv);
  return out;
}

function bech32Encode(hrp: string, data: number[]): string {
  const checksum = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const check: number[] = [];
  for (let i = 0; i < 6; i++) check.push((checksum >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...check].map((d) => CHARSET[d]).join("")}`;
}

/**
 * Enterprise script address: header byte 0b0111_nnnn where the low nibble is
 * the network id (0 testnet, 1 mainnet), followed by the 28-byte script hash.
 */
export function scriptHashToAddress(
  scriptHashHex: string,
  network: "preprod" | "mainnet",
): string {
  const bytes = Buffer.from(scriptHashHex, "hex");
  if (bytes.length !== 28) {
    throw new Error(
      `Script hash must be 28 bytes, got ${bytes.length} from "${scriptHashHex}"`,
    );
  }
  const header = network === "mainnet" ? 0x71 : 0x70;
  const hrp = network === "mainnet" ? "addr" : "addr_test";
  const payload = [header, ...bytes];
  return bech32Encode(hrp, convertBits(payload, 8, 5));
}
