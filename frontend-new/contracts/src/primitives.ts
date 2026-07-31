import { Schema } from "effect";

export const DecimalString = Schema.String.pipe(
  Schema.pattern(/^\d+$/),
  Schema.brand("DecimalString"),
);
export type DecimalString = Schema.Schema.Type<typeof DecimalString>;

export const HexString = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]*$/i),
  Schema.brand("HexString"),
);
export type HexString = Schema.Schema.Type<typeof HexString>;

export const IsoTimestamp = Schema.String;
export type IsoTimestamp = Schema.Schema.Type<typeof IsoTimestamp>;

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
