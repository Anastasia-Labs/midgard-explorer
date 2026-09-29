// Narrow Lucid imports avoid loading unused wallet and provider modules.
import { Data } from "@lucid-evolution/plutus";

/** Decode untrusted datum CBOR without failing the whole response. */
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
