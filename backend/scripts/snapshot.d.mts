/** Types for the snapshot CLI's two exported helpers, so the safety suite can
 * assert against the real table list rather than a copy of it that drifts. */
export declare const TABLES: readonly string[];
export declare function schemaFingerprint(url: string): string;
