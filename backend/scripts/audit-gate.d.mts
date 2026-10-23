/**
 * Types for the two pure functions the audit gate exports.
 *
 * The gate itself stays plain JavaScript on purpose: it runs as
 * `node scripts/audit-gate.mjs` in CI before anything is built or transpiled,
 * so it must not need ts-node to answer whether a dependency advisory has been
 * triaged. Declaring its surface here lets the suite import it with real types
 * instead of suppressing the error.
 */

/** One recorded acceptance from security-advisories.json. `owner` and
 * `expiresOn` are deliberately `unknown`: whether they are present and
 * well-formed is exactly what `checkDispositions` is there to decide. */
export type Disposition = {
  id: string;
  module?: string;
  owner?: unknown;
  expiresOn?: unknown;
};

/** A real calendar date, or null. Returns null for a date-shaped string that
 * names no date, such as 2026-99-99 or 2026-02-31. */
export declare const parseExpiry: (value: unknown) => Date | null;

/** Every problem with the given dispositions, empty when there are none. */
export declare const checkDispositions: (
  entries: readonly Disposition[],
  today?: Date,
) => string[];
