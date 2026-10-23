import { BLOCK_SCHEMA, archivingKey, controlKey, failureKey } from "../archive/keys";
import { AsyncLocalStorage } from "node:async_hooks";
import { BlockIndexEntry, Control, Generation, TxIndexEntry } from "../archive/schema";
import type { ArchiveStore } from "../archive/store";

/** What the ingester wrote for one archived block. Big integers are decimal
 * strings; times are POSIX milliseconds. */
export type BlockManifest = {
  schema: string;
  fingerprint: string;
  headerHash: string;
  prevHeaderHash: string;
  header: Record<string, string> & { prevHeaderHash: string; startTime: string; endTime: string };
  payloadKey: string;
  payloadSha256: string;
  payloadBytes: number;
  records: Record<string, { records: number; pages: number }>;
  verification: {
    payloadHash: "pass";
    headerBinding: "pass";
    commitment: "pass" | "fail" | "not_run";
    roots: { state: string; reason?: string };
    l1: "not_observed";
  };
};

/** One record as a page holds it: the value inline, in a detail object, or
 * only as a link into the archived payload when it fits neither. */
export type PageRecord = {
  index: number;
  key: string;
  valueBytes: number;
  value?: string;
  detailKey?: string;
  raw?: { payloadKey: string; kind: string; index: number };
};

export type Observation = { txId: string; headerHash: string; block: string; kind: string; index: number; page: number };

/** A recorded fate of a header that left the queue, with its evidence. Only
 * a recorded outcome is ever shown; none is inferred. */
export type Outcome = {
  outcome: "merged" | "removed" | "unresolved";
  evidence: string;
  observation: { source: string; chainPoint: string | null; at: string };
};

export type BlockLookup =
  | { state: "archived"; manifest: BlockManifest; entry: BlockIndexEntry; children: string[]; outcome: Outcome | null }
  | { state: "failed"; at: string | null; reason: string; detail: string | null }
  | { state: "archiving"; at: string }
  | { state: "awaiting"; at: null; namedBy: string[] };

export type Paged<T> = { rows: T[]; total: number; hasNextPage: boolean };

const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

/** How long an archiving marker means a run is still working on a header. */
export const ARCHIVING_TTL_MS = 10 * 60_000;

/**
 * The public source's read side: everything a request needs, from the
 * published generation and the immutable objects it names.
 *
 * One small read per request finds the head; the generation and every
 * immutable object are cached by key, since they never change. Nothing here
 * opens a database, fetches a payload, or decodes one.
 */
export class ArchiveView {
  private readonly store: ArchiveStore;
  private readonly fingerprint: string;
  private readonly now: () => number;
  private readonly ttl: number;
  private generation: { key: string; generation: Generation } | null = null;
  private readonly snapshots = new AsyncLocalStorage<{ head: { key: string; generation: Generation } | null }>();
  private readonly objects = new Map<string, unknown>();

  constructor(
    store: ArchiveStore,
    fingerprint: string,
    options: { now?: () => number; archivingTtlMs?: number } = {},
  ) {
    this.store = store;
    this.fingerprint = fingerprint;
    this.now = options.now ?? Date.now;
    this.ttl = options.archivingTtlMs ?? ARCHIVING_TTL_MS;
  }

  /** Whether the archive's control object can be read at all. */
  async readable(): Promise<boolean> {
    return (await this.store.get(controlKey(this.fingerprint))) !== null;
  }

  /** The published generation, or null before the first publication. */
  async head(): Promise<{ key: string; generation: Generation } | null> {
    const snapshot = this.snapshots.getStore();
    if (snapshot !== undefined) return snapshot.head;
    const control = await this.store.get(controlKey(this.fingerprint));
    if (control === null) return null;
    const { head } = Control.parse(parse(control.bytes));
    if (head === null) return null;
    if (this.generation?.key === head.generationKey) return this.generation;
    const value = await this.object<unknown>(head.generationKey);
    if (value === null) throw new Error(`archive head names ${head.generationKey}, which does not exist`);
    const found = { key: head.generationKey, generation: Generation.parse(value) };
    this.generation = found;
    return found;
  }

  /** Every read in an HTTP response uses the same published generation. */
  async withSnapshot<T>(read: () => T): Promise<Awaited<T>> {
    if (this.snapshots.getStore() !== undefined) return await read();
    const head = await this.head();
    return await this.snapshots.run({ head }, read);
  }

  /** An immutable object, read once. Null when it does not exist. */
  private async object<T>(key: string): Promise<T | null> {
    if (this.objects.has(key)) return this.objects.get(key) as T;
    const found = await this.store.get(key);
    if (found === null) return null;
    const value = parse(found.bytes);
    if (this.objects.size > 2_000) this.objects.clear();
    this.objects.set(key, value);
    return value as T;
  }

  /** A mutable marker, read fresh. */
  private async marker<T>(key: string): Promise<T | null> {
    const found = await this.store.get(key);
    return found === null ? null : (parse(found.bytes) as T);
  }

  /** Rows `[offset, offset + limit)` of a list cut into index pages. */
  private async slice<T>(
    list: { pages: string[]; count: number; pageSize: number },
    offset: number,
    limit: number,
    row: (value: unknown) => T,
  ): Promise<T[]> {
    const rows: T[] = [];
    const end = Math.min(list.count, offset + limit);
    for (let p = Math.floor(offset / list.pageSize); p * list.pageSize < end; p += 1) {
      const page = (await this.object<unknown[]>(list.pages[p]!)) ?? [];
      page.forEach((value, i) => {
        const at = p * list.pageSize + i;
        if (at >= offset && at < end) rows.push(row(value));
      });
    }
    return rows;
  }

  async blocksPage(page: number, perPage: number): Promise<Paged<BlockIndexEntry>> {
    const head = await this.head();
    if (head === null) return { rows: [], total: 0, hasNextPage: false };
    const list = head.generation.index.blocks;
    const offset = (page - 1) * perPage;
    const rows = await this.slice(list, offset, perPage, (v) => BlockIndexEntry.parse(v));
    return { rows, total: list.count, hasNextPage: offset + perPage < list.count };
  }

  async transactionsPage(page: number, perPage: number): Promise<Paged<TxIndexEntry>> {
    const head = await this.head();
    if (head === null) return { rows: [], total: 0, hasNextPage: false };
    const list = head.generation.index.transactions;
    const offset = (page - 1) * perPage;
    const rows = await this.slice(list, offset, perPage, (v) => TxIndexEntry.parse(v));
    return { rows, total: list.count, hasNextPage: offset + perPage < list.count };
  }

  /** The archived entry for a header, from the one index page that holds it. */
  async entry(headerHash: string): Promise<BlockIndexEntry | null> {
    const head = await this.head();
    const at = head?.generation.index.blockPage[headerHash];
    if (head === null || at === undefined) return null;
    const page = (await this.object<unknown[]>(head.generation.index.blocks.pages[at]!)) ?? [];
    const found = page.map((v) => BlockIndexEntry.parse(v)).find((e) => e.headerHash === headerHash);
    return found ?? null;
  }

  /**
   * One header's archive state. Archived wins; otherwise the newer of the
   * failure and archiving markers, with archiving shown only while younger
   * than its time to live. A header nothing archived names is unknown (null).
   */
  async block(headerHash: string): Promise<BlockLookup | null> {
    const head = await this.head();
    const entry = await this.entry(headerHash);
    if (head !== null && entry !== null) {
      const manifest = await this.object<BlockManifest>(entry.manifestKey);
      if (manifest === null) throw new Error(`archive index names ${entry.manifestKey}, which does not exist`);
      const outcome = (head.generation.outcomes[headerHash] as Outcome | undefined) ?? null;
      return { state: "archived", manifest, entry, children: entry.children, outcome };
    }
    const failure = await this.marker<{ reason: string; detail?: string; at?: string }>(failureKey(this.fingerprint, headerHash));
    const archiving = await this.marker<{ at: string }>(archivingKey(this.fingerprint, headerHash));
    const failedAt = failure?.at ? Date.parse(failure.at) : -Infinity;
    if (archiving !== null) {
      const startedAt = Date.parse(archiving.at);
      if (startedAt > failedAt && this.now() - startedAt < this.ttl) return { state: "archiving", at: archiving.at };
    }
    if (failure !== null) {
      return { state: "failed", at: failure.at ?? null, reason: failure.reason, detail: failure.detail ?? null };
    }
    const namedBy = await this.namedBy(headerHash);
    return namedBy.length > 0 ? { state: "awaiting", at: null, namedBy } : null;
  }

  /** Archived blocks whose header names this one as its parent, and seeds. */
  private async namedBy(headerHash: string): Promise<string[]> {
    const head = await this.head();
    if (head === null) return [];
    const seeds = (head.generation.seeds as Array<{ headerHash: string }>).filter((s) => s.headerHash === headerHash);
    const named: string[] = seeds.length > 0 ? [headerHash] : [];
    const list = head.generation.index.blocks;
    for (const key of list.pages) {
      for (const value of (await this.object<unknown[]>(key)) ?? []) {
        const e = BlockIndexEntry.parse(value);
        if (e.prevHeaderHash === headerHash) named.push(e.headerHash);
      }
    }
    return named;
  }

  /** One archive page of a block's records, or null past the last page. */
  async records(manifest: BlockManifest, kind: string, page: number): Promise<PageRecord[] | null> {
    const pages = manifest.records[kind]?.pages ?? 0;
    if (!Number.isSafeInteger(page) || page < 0 || page >= pages) return null;
    const block = manifest.payloadKey.split("/payloads/")[1]!.replace(/\.cbor$/, "");
    const key = `${this.fingerprint}/blocks/${block}-${BLOCK_SCHEMA}/${kind}/${page}.json`;
    const found = await this.object<{ records: PageRecord[] }>(key);
    if (found === null) throw new Error(`archive manifest counts page ${key}, which does not exist`);
    return found.records;
  }

  /** A record's value from its detail object. */
  async detail(key: string): Promise<{ value: string } | null> {
    return this.object<{ value: string }>(key);
  }

  /** Every archived block that carries this transaction. */
  async transaction(txId: string): Promise<Observation[]> {
    const head = await this.head();
    if (head === null) return [];
    const prefix = `${this.fingerprint}/txs/${txId}/`;
    const keys = head.generation.references.filter((k) => k.startsWith(prefix));
    const seen: Observation[] = [];
    for (const key of keys) {
      const o = await this.object<Observation>(key);
      if (o !== null) seen.push(o);
    }
    return seen;
  }
}
