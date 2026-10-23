/**
 * Where the archive keeps its objects.
 *
 * Two kinds of key. Content keys are written once with `putImmutable` and
 * never change. The `control` key changes only through `putIfMatch`, a
 * compare-and-swap on the etag it was read with. The publication protocol
 * (`publish.ts`) is built on exactly these two guarantees, so another backend
 * (an object store with conditional writes) can replace the filesystem one.
 */
export interface ArchiveStore {
  /** The bytes and their etag, or null when the key does not exist. */
  get(key: string): Promise<{ bytes: Uint8Array; etag: string } | null>;
  /** Writes once. The same bytes again are a no-op; different bytes throw `ArchiveConflict`. */
  putImmutable(key: string, bytes: Uint8Array): Promise<void>;
  /** Replaces the key only if its etag is `expectedEtag`, or if it is absent when that is null. */
  putIfMatch(
    key: string,
    bytes: Uint8Array,
    expectedEtag: string | null,
  ): Promise<{ ok: boolean; etag: string | null }>;
  /** Keys under `prefix`, in order, after `after`, at most `limit`. */
  list(prefix: string, after?: string, limit?: number): Promise<string[]>;
}

/** An immutable key already holds different bytes. */
export class ArchiveConflict extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`archive key ${key} already holds different bytes`);
    this.key = key;
    this.name = "ArchiveConflict";
  }
}
