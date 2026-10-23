export const toBytes = (hex: string) => Buffer.from(hex, "hex");
export const toHex = (value: Uint8Array) => Buffer.from(value).toString("hex");

/**
 * The two protocol hash widths, in hex characters, named once.
 *
 * They were written as inline regular expressions in eighteen places across the
 * repository, and the copies did not agree: some accepted uppercase, some did
 * not, and the routes differed over whether they normalised before querying.
 * A disagreement between two of these is not a style problem. It is the defect
 * class that put a 32-byte Merkle root in a column every route validated at 28
 * bytes, and it recurred a second time as a case mismatch that made an indexed
 * block report itself as unobserved.
 */
export const HASH28_HEX = 56;
export const HASH32_HEX = 64;

/** Hex of an exact length, in either case. Input, not storage. */
export const isHexOfLength = (value: string, length: number) =>
  value.length === length && /^[0-9a-fA-F]+$/.test(value);

/** A blake2b-224 hash: script hashes, policy ids, Midgard block header hashes. */
export const isHash28 = (value: string) => isHexOfLength(value, HASH28_HEX);

/** A blake2b-256 hash: transaction ids, Cardano block hashes, Merkle roots. */
export const isHash32 = (value: string) => isHexOfLength(value, HASH32_HEX);

/**
 * The single spelling both databases agree on.
 *
 * Hashes are stored lowercase. The node's tables hold `bytea`, so
 * `Buffer.from(hex, "hex")` reads either case and a query against them appears
 * to work; the explorer's own index stores text, so the same uppercase value
 * silently matches nothing. `/api/block` with an uppercase header hash
 * therefore returned the block and reported `reconciliation: node_only`,
 * claiming Cardano had not been seen for a block the index had attributed.
 *
 * Applied where an identifier ENTERS, so nothing downstream has to remember.
 */
export const canonicalHash = (value: string) => value.trim().toLowerCase();

/**
 * A hash as it appears in DECODED chain data, which is canonically lowercase.
 *
 * Stricter than the input predicates above, and deliberately so. Those accept
 * either case because a person may paste an uppercase hash; a decoder reading
 * bytes out of CBOR or Koios JSON is not reading anything a person typed, so
 * accepting uppercase there would mean accepting a shape the chain does not
 * produce and cannot detect a decoder that has gone wrong.
 */
export const CANONICAL_HASH28 = new RegExp(`^[0-9a-f]{${HASH28_HEX}}$`);
export const CANONICAL_HASH32 = new RegExp(`^[0-9a-f]{${HASH32_HEX}}$`);
