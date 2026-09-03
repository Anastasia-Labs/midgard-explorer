import { Schema } from "effect";

export const DecimalString = Schema.String.pipe(
  Schema.pattern(/^\d+$/),
  Schema.brand("DecimalString"),
);
export type DecimalString = Schema.Schema.Type<typeof DecimalString>;

/**
 * A decimal integer that may be negative.
 *
 * `DecimalString` is unsigned, which is right for lovelace and for asset
 * balances: neither can go below zero. A mint quantity can. A burn is
 * represented by a negative quantity, so encoding it as `DecimalString` made
 * the contract unable to express a burn at all, and Schema rejected the whole
 * response rather than the one field.
 */
export const SignedDecimalString = Schema.String.pipe(
  Schema.pattern(/^-?\d+$/),
  Schema.brand("SignedDecimalString"),
);
export type SignedDecimalString = Schema.Schema.Type<typeof SignedDecimalString>;

export const HexString = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]*$/i),
  Schema.brand("HexString"),
);
export type HexString = Schema.Schema.Type<typeof HexString>;

/**
 * A timestamp the UI can actually format.
 *
 * This was `Schema.String`, so it accepted anything. A manifest with no
 * `createdAt` reached the backend as the literal string "undefined", passed
 * this boundary unchanged, and threw inside `new Date(...).toISOString()` when
 * the source banner rendered it. Parsing here means a bad value is a decode
 * error naming the field rather than an exception in a component.
 */
export const IsoTimestamp = Schema.String.pipe(
  Schema.filter((s) => !Number.isNaN(new Date(s).getTime()), {
    message: () => "expected a parseable ISO timestamp",
  }),
  Schema.brand("IsoTimestamp"),
);
export type IsoTimestamp = Schema.Schema.Type<typeof IsoTimestamp>;

/** The two protocol hash widths, in hex characters. The backend states why in
 * `src/utils.ts`; the two workspaces share no code, so the constants are
 * restated here and the reasoning is not. */
export const HASH28_HEX = 56;
export const HASH32_HEX = 64;

/** Either case, because a hash pasted from another explorer may be uppercase
 * and refusing that is pedantry. Callers normalise; the backend stores and
 * compares lowercase. */
const hashPattern = (width: number) => new RegExp(`^[0-9a-fA-F]{${width}}$`);

/** The single spelling both stores agree on. A hash reaching a query in any
 * other form finds the node's `bytea` and misses the index's text. */
export const canonicalHash = (value: string): string => value.trim().toLowerCase();

export const isHash28 = (value: string): boolean => hashPattern(HASH28_HEX).test(value);
export const isHash32 = (value: string): boolean => hashPattern(HASH32_HEX).test(value);

/** A blake2b-224 hash: script hashes, policy ids, payment credentials, and a
 * Midgard L2 block header hash, which is 28 bytes and not 32. Measured on the
 * node's `blocks.header_hash`. */
export const Hash28 = Schema.String.pipe(
  Schema.pattern(hashPattern(HASH28_HEX)),
  Schema.brand("Hash28"),
);
export type Hash28 = Schema.Schema.Type<typeof Hash28>;

/** A blake2b-256 hash: transaction ids, block header hashes, datum hashes. */
export const Hash32 = Schema.String.pipe(
  Schema.pattern(hashPattern(HASH32_HEX)),
  Schema.brand("Hash32"),
);
export type Hash32 = Schema.Schema.Type<typeof Hash32>;

export const KNOWN_TX_STATUSES = [
  "committed",
  "pending_commit",
  "accepted",
  "rejected",
  "validating",
  "queued",
] as const;

export type KnownTxStatus = (typeof KNOWN_TX_STATUSES)[number];

/** Statuses arrive as open strings: the node may add values we do not know yet. */
export const StatusString = Schema.String;
export type StatusString = Schema.Schema.Type<typeof StatusString>;

export const isKnownTxStatus = (s: string): s is KnownTxStatus =>
  (KNOWN_TX_STATUSES as readonly string[]).includes(s);

export const ApiErrorBody = Schema.Struct({
  error: Schema.String,
  detail: Schema.optional(Schema.String),
});
export type ApiErrorBody = Schema.Schema.Type<typeof ApiErrorBody>;

export const paged = <A, I, R>(row: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    rows: Schema.Array(row),
    hasNextPage: Schema.Boolean,
    total: Schema.Number,
    limit: Schema.Number,
  });
