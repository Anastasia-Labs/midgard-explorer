/// <reference path="../src/types/midgard-untyped.d.ts" />
import { createHash } from "node:crypto";
import { BLOCK_SCHEMA, archivingKey, blockManifestKey, failureKey, payloadKey } from "../src/archive/keys";
import type { BlockIndexEntry, TxIndexEntry } from "../src/archive/schema";
import { RECORD_KINDS, summarise } from "./summarise";
import type { ArchiveStore } from "../src/archive/store";

type FaultProofs = typeof import("@al-ft/midgard-fault-proofs", { with: { "resolution-mode": "import" } });
type Envelope = typeof import("@al-ft/midgard-core/da-payload-envelope", {
  with: { "resolution-mode": "import" },
});
type Sdk = typeof import("@al-ft/midgard-sdk", { with: { "resolution-mode": "import" } });

/** Where a payload is fetched from: Midgard's retained-DA source interface. */
export type PayloadSource = Parameters<FaultProofs["fetchRetainedDaPayloadByHeaderHash"]>[0]["sources"][number];

let modules: Promise<[FaultProofs, Envelope, Sdk]> | null = null;
const load = () =>
  (modules ??= Promise.all([
    import("@al-ft/midgard-fault-proofs") as Promise<FaultProofs>,
    import("@al-ft/midgard-core/da-payload-envelope") as Promise<Envelope>,
    import("@al-ft/midgard-sdk") as Promise<Sdk>,
  ]));

/**
 * What was checked about an archived block, each field on its own. Hashing
 * and header binding passing says nothing about the roots or about Cardano.
 */
export type Verification = {
  /** The envelope's declared size and sha256 match the payload it carries. */
  payloadHash: "pass";
  /** The payload's embedded header hashes to the requested header hash. */
  headerBinding: "pass";
  commitment: "pass" | "fail" | "not_run";
  roots: { state: "pass" | "fail" } | { state: "not_run"; reason: string };
  l1: "not_observed";
};

export type IngestOptions = {
  store: ArchiveStore;
  fingerprint: string;
  headerHash: string;
  sources: readonly PayloadSource[];
  limits: { maxPayloadBytes: number };
  /** Retries per source while its attempts are plausibly transient. */
  retries: number;
  /** Test seams. Nothing in production sets them. */
  hooks?: { beforeManifest?: () => Promise<void> };
};

export type IngestResult =
  | {
      state: "archived";
      manifestKey: string;
      keys: string[];
      prevHeaderHash: string;
      /** The source that served the archived copy. Not in the manifest, which
       * depends on the payload alone. */
      servedBy: string;
      /** This block's entries in the published lists. */
      entry: BlockIndexEntry;
      transactions: TxIndexEntry[];
    }
  | { state: "failed"; reason: string; detail: string };

/**
 * Where each kind's records are in the payload. A transaction's entry in
 * `transactions` is its Merkle root value; its body is in
 * `transaction_preimages`, keyed by the same id, and forced transactions
 * follow the same split.
 */
const RECORD_SOURCE = {
  transactions: "transaction_preimages",
  deposits: "deposits",
  withdrawals: "withdrawals",
  forced_transactions: "forced_transaction_preimages",
} as const;

/** BigInt counts are written as decimal strings. */
const json = (value: unknown) =>
  new TextEncoder().encode(
    `${JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`,
  );

/** Replaces a mutable marker with this value. Markers sit outside any
 * generation: a reader consults them only for a header that is not archived. */
const mark = async (store: ArchiveStore, key: string, value: unknown) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.get(key);
    if ((await store.putIfMatch(key, json(value), current?.etag ?? null)).ok) return;
  }
};

/** Replaces the header's failure marker with this one. */
const markFailure = async (options: IngestOptions, reason: string, detail: string) => {
  await mark(options.store, failureKey(options.fingerprint, options.headerHash), {
    headerHash: options.headerHash,
    reason,
    detail: detail.slice(0, 2000),
    at: new Date().toISOString(),
  });
  return { state: "failed" as const, reason, detail };
};

/**
 * Fetches one block's DA payload, verifies it with Midgard's own header
 * verifier, and archives it.
 *
 * The archived payload is the verified inner payload, decompressed, keyed by
 * its sha256, so one block has one archived copy however it was served. The
 * block manifest is a function of that payload alone and is written last: a
 * run that dies before it leaves no manifest, and the next run writes the
 * same bytes. Nothing written here is visible to readers until a generation
 * that references it is published.
 *
 * Root reconstruction needs an authenticated L1 observation of the header,
 * which may never come from the payload itself, so without a queue source it
 * is recorded as not run.
 */
export async function ingestBlock(options: IngestOptions): Promise<IngestResult> {
  const [faultProofs, envelope, sdk] = await load();
  const { store, fingerprint, headerHash } = options;
  await mark(store, archivingKey(fingerprint, headerHash), { headerHash, at: new Date().toISOString() });

  let served: Buffer;
  let servedBy: string;
  try {
    const fetched = await faultProofs.fetchRetainedDaPayloadByHeaderHash({
      headerHash,
      sources: options.sources,
      retries: options.retries,
    });
    served = fetched.payloadEnvelopeCbor;
    servedBy = fetched.sourceId;
  } catch (err) {
    return markFailure(options, "unavailable", (err as Error).message);
  }

  let inner: Buffer;
  let payload: ReturnType<Sdk["decodeDaPayload"]>;
  try {
    inner = Buffer.from(
      (await envelope.unwrapDaPayload(served, { maxPayloadBytes: options.limits.maxPayloadBytes })).innerBytes,
    );
    payload = sdk.decodeDaPayload(inner);
  } catch (err) {
    return markFailure(options, "invalid_payload", (err as Error).message);
  }

  const payloadSha256 = createHash("sha256").update(inner).digest("hex");
  const verification: Verification = {
    payloadHash: "pass",
    headerBinding: "pass",
    commitment: "not_run",
    roots: { state: "not_run", reason: "no_authenticated_l1_header_observation" },
    l1: "not_observed",
  };
  const pKey = payloadKey(fingerprint, headerHash, payloadSha256);
  const mKey = blockManifestKey(fingerprint, headerHash, payloadSha256);

  await store.putImmutable(pKey, inner);

  // Bounded pages and detail objects, so a reader never loads the payload to
  // serve a block's records.
  const block = `${headerHash}-${payloadSha256}-${BLOCK_SCHEMA}`;
  const pageKeys: string[] = [];
  const transactions: TxIndexEntry[] = [];
  const header = payload.block_body.header;
  const records: Record<string, { records: number; pages: number }> = {};
  for (const kind of RECORD_KINDS) {
    const entries = payload.block_body[RECORD_SOURCE[kind]] as ReadonlyArray<readonly [string, string]>;
    const cut = summarise({ fingerprint, block, payloadKey: pKey, kind, entries });
    for (const [key, bytes] of [...Object.entries(cut.details), ...Object.entries(cut.pages)]) {
      await store.putImmutable(key, bytes);
      pageKeys.push(key);
    }
    records[kind] = cut.count;
    // One immutable observation per (transaction, block): a transaction two
    // blocks carry has two, and neither replaces the other.
    if (kind === "transactions") {
      for (const [index, [txId]] of entries.entries()) {
        if (!/^[0-9a-f]{64}$/.test(txId)) continue;
        const key = `${fingerprint}/txs/${txId}/${block}.json`;
        await store.putImmutable(
          key,
          json({ txId, headerHash, block, kind, index, page: cut.pageOf[index] }),
        );
        pageKeys.push(key);
        transactions.push({ txId, headerHash, observationKey: key, index, endTime: String(header.endTime) });
      }
    }
  }

  await options.hooks?.beforeManifest?.();
  await store.putImmutable(
    mKey,
    json({
      schema: "midgard-explorer-archive-block-v1",
      fingerprint,
      headerHash,
      prevHeaderHash: payload.block_body.header.prevHeaderHash,
      // The verified header as the payload carries it, so a block page is
      // served from this object alone. Times are POSIX milliseconds.
      header: payload.block_body.header,
      payloadKey: pKey,
      payloadSha256,
      payloadBytes: inner.length,
      counts: payload.block_body.counts,
      records,
      verification,
    }),
  );
  return {
    state: "archived",
    manifestKey: mKey,
    keys: [pKey, ...pageKeys, mKey],
    prevHeaderHash: header.prevHeaderHash,
    servedBy,
    entry: {
      headerHash,
      prevHeaderHash: header.prevHeaderHash,
      manifestKey: mKey,
      startTime: String(header.startTime),
      endTime: String(header.endTime),
      counts: {
        transactions: String(header.l2TransactionCount),
        deposits: String(header.depositCount),
        withdrawals: String(header.withdrawalCount),
        forcedTransactions: String(header.forcedTransactionCount),
      },
      archivedTransactions: records.transactions?.records ?? 0,
      children: [],
    },
    transactions,
  };
}
