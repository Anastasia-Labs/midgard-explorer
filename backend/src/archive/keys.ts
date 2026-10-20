/**
 * Every archive key, built in one place.
 *
 * Every key starts with the deployment fingerprint, the 64-hex manifest id
 * (D7), so two deployments can never share an object. A key is a relative
 * path of lowercase segments: nothing here can name a file outside the
 * archive.
 */
export const KEY = /^[0-9a-f]{64}(\/[a-z0-9][a-z0-9._-]*)+$/;

const hex = (value: string, length: number, what: string): string => {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`archive ${what} must be ${length} lowercase hex characters`);
  }
  return value;
};

export const fingerprint = (fp: string): string => hex(fp, 64, "fingerprint");

export const controlKey = (fp: string): string => `${fingerprint(fp)}/control`;

export const generationKey = (fp: string, n: number, sha256: string): string => {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error("archive generation number must be a positive integer");
  return `${fingerprint(fp)}/generations/${n}-${hex(sha256, 64, "generation hash")}.json`;
};

export const objectKey = (fp: string, sha256: string): string =>
  `${fingerprint(fp)}/objects/${hex(sha256, 64, "object hash")}.json`;

export const payloadKey = (fp: string, headerHash: string, payloadHash: string): string =>
  `${fingerprint(fp)}/payloads/${hex(headerHash, 56, "header hash")}-${hex(payloadHash, 64, "payload hash")}.cbor`;

/** The archive format version a block manifest is written under. */
export const BLOCK_SCHEMA = "v1";

/** A block manifest, named by its header, its verified payload and the format. */
export const blockManifestKey = (fp: string, headerHash: string, payloadHash: string): string =>
  `${fingerprint(fp)}/blocks/${hex(headerHash, 56, "header hash")}-${hex(payloadHash, 64, "payload hash")}-${BLOCK_SCHEMA}.json`;

/** The last failure to archive a header, replaced by the next one. */
export const failureKey = (fp: string, headerHash: string): string =>
  `${fingerprint(fp)}/failures/${hex(headerHash, 56, "header hash")}.json`;

/** Set when a run starts fetching a header; stale after the reader's TTL. */
export const archivingKey = (fp: string, headerHash: string): string =>
  `${fingerprint(fp)}/archiving/${hex(headerHash, 56, "header hash")}.json`;

/** Throws unless `key` is a well-formed archive key. */
export const assertKey = (key: string): string => {
  if (
    !KEY.test(key) ||
    key.endsWith(".versions") ||
    key.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`not an archive key: ${JSON.stringify(key)}`);
  }
  return key;
};
