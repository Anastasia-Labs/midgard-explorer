import { Data } from "@lucid-evolution/lucid";

/**
 * The one safe entry point for turning datum CBOR into a typed value.
 *
 * `Data.from` throws, and a throwing decoder is wrong here: the indexer ingests
 * arbitrary chain data on a timer, so one malformed datum would take down the
 * whole sync tick instead of marking one event undecoded.
 *
 * This is not a new convention. The SDK never calls `Data.from` bare either:
 * `getDatumFromUTxO` (midgard-sdk/src/internals.ts) wraps it in `Effect.try`
 * and fails with `DataCoercionError`, and `parseSafeDatum` in the DCU toolkit
 * does the same for a raw datum string. Neither is importable from this
 * backend, so this is that same shape expressed with the error handling this
 * codebase already uses: return null, never guess. Replace it with an SDK
 * export the moment one ships that takes CBOR bytes.
 */

export type DatumResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** Use when the reason belongs in a log line. */
export function decodeDatumResult<T>(
  cborHex: string | null | undefined,
  schema: unknown,
): DatumResult<T> {
  // An empty string is a missing datum, not an empty one. Koios returns
  // inline_datum.bytes as null on a UTxO that carries no datum at all.
  if (!cborHex) return { ok: false, reason: "missing datum" };
  try {
    return { ok: true, value: Data.from(cborHex, schema as never) as T };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

/** The common case: a value or nothing. */
export function decodeDatum<T>(
  cborHex: string | null | undefined,
  schema: unknown,
): T | null {
  const r = decodeDatumResult<T>(cborHex, schema);
  return r.ok ? r.value : null;
}
