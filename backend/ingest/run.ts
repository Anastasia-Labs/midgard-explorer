import { buildIndexes } from "../src/archive/chainIndex";
import { ArchiveWriter } from "../src/archive/publish";
import { BlockIndexEntry, TxIndexEntry } from "../src/archive/schema";
import { readHead } from "../src/archive/reader";
import type { ArchiveStore } from "../src/archive/store";
import { ingestBlock, type IngestResult, type PayloadSource } from "./ingestBlock";

/** A header someone supplied, and where they got it. Never treated as the tip. */
export type Seed = { headerHash: string; source: string };

export type SeedRecord = Seed & { stop: Walk["stop"]; gapAt?: string };

export type Walk = {
  seed: string;
  /** Blocks this walk archived. */
  archived: number;
  /** genesis: reached the genesis header. archived: reached a header already
   * archived. gap: a header no peer served, named in `gapAt`. */
  stop: "genesis" | "archived" | "gap" | "block_limit" | "time_limit";
  gapAt?: string;
};

export type RunOptions = {
  store: ArchiveStore;
  fingerprint: string;
  headerHashes: readonly string[];
  /** Headers to walk back from along `prevHeaderHash`. */
  seeds?: readonly Seed[];
  /** The deployment's genesis header, where a walk ends. */
  genesisHeaderHash?: string;
  /** Bounds on the blocks a run archives by walking, and on its time. */
  maxBlocks?: number;
  timeBudgetMs?: number;
  sources: readonly PayloadSource[];
  limits: { maxPayloadBytes: number };
  retries: number;
  owner: string;
  leaseMs: number;
};

export type RunReport = {
  results: Array<{ headerHash: string } & IngestResult>;
  walks: Walk[];
  /** False when nothing new was archived, so no generation was published. */
  published: boolean;
};

/**
 * One `pnpm ingest` run: takes the lease, archives each requested header, and
 * publishes one generation that references every block archived so far. A
 * failed header is never referenced; its failure marker says why. A run that
 * archives nothing new publishes nothing, so repeating a run is a no-op. The
 * lease is renewed while the run lasts and released when it ends, so the next
 * run starts at once; a run that is killed holds it until it expires.
 */
const leaseLost = () =>
  new Error("the archive lease could not be kept during the run (taken over, or renewal failed); nothing was published");

export async function runIngest(options: RunOptions): Promise<RunReport> {
  const writer = new ArchiveWriter({
    store: options.store,
    fingerprint: options.fingerprint,
    owner: options.owner,
    leaseMs: options.leaseMs,
  });
  await writer.acquire();

  // Renewed on a timer, so a fetch longer than the lease keeps it. A renewal
  // that fails or throws means the lease cannot be trusted any more: stop
  // fetching and publish nothing. The chain never rejects, so the release in
  // `finally` always runs.
  let lost = false;
  let renewing: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    renewing = renewing.then(async () => {
      if (lost) return;
      try {
        if (!(await writer.renew())) lost = true;
      } catch {
        lost = true;
      }
    });
  }, Math.max(1, Math.floor(options.leaseMs / 3)));

  try {
    const head = await readHead(options.store, options.fingerprint);
    const previous = new Set(head?.generation.references ?? []);
    const results: RunReport["results"] = [];
    const archivedKeys: string[] = [];
    const entries: BlockIndexEntry[] = [];
    const txEntries: TxIndexEntry[] = [];
    const servedBy = new Set<string>();

    /** The parent of an archived header, or undefined when it is not archived. */
    const parents = new Map<string, string>();
    const parentOf = async (headerHash: string): Promise<string | undefined> => {
      if (parents.has(headerHash)) return parents.get(headerHash);
      const key = [...previous].find((k) => k.includes(`/blocks/${headerHash}-`));
      if (key === undefined) return undefined;
      const manifest = JSON.parse(new TextDecoder().decode((await options.store.get(key))!.bytes));
      parents.set(headerHash, manifest.prevHeaderHash);
      return manifest.prevHeaderHash;
    };
    const ingest = async (headerHash: string) => {
      const result = await ingestBlock({
        store: options.store,
        fingerprint: options.fingerprint,
        headerHash,
        sources: options.sources,
        limits: options.limits,
        retries: options.retries,
      });
      results.push({ headerHash, ...result });
      if (result.state === "archived") {
        archivedKeys.push(...result.keys);
        entries.push(result.entry);
        txEntries.push(...result.transactions);
        servedBy.add(result.servedBy);
        parents.set(headerHash, result.prevHeaderHash);
      }
      return result;
    };

    for (const headerHash of options.headerHashes) {
      if (lost) break;
      await ingest(headerHash);
    }

    const walks: Walk[] = [];
    const started = Date.now();
    let budget = options.maxBlocks ?? 100;
    for (const seed of options.seeds ?? []) {
      let current = seed.headerHash;
      let archived = 0;
      let walk: Walk | undefined;
      while (walk === undefined) {
        if (lost) throw leaseLost();
        if ((await parentOf(current)) !== undefined) {
          walk = { seed: seed.headerHash, archived, stop: "archived" };
        } else if (budget <= 0) {
          walk = { seed: seed.headerHash, archived, stop: "block_limit" };
        } else if (Date.now() - started > (options.timeBudgetMs ?? 10 * 60_000)) {
          walk = { seed: seed.headerHash, archived, stop: "time_limit" };
        } else {
          const result = await ingest(current);
          if (result.state !== "archived") {
            walk = { seed: seed.headerHash, archived, stop: "gap", gapAt: current };
          } else {
            archived += 1;
            budget -= 1;
            if (result.prevHeaderHash === options.genesisHeaderHash) {
              walk = { seed: seed.headerHash, archived, stop: "genesis" };
            }
            current = result.prevHeaderHash;
          }
        }
      }
      walks.push(walk);
    }
    if (lost) throw leaseLost();

    // A seed is recorded once, with the stop of its first walk. A new seed
    // is new information even when it archived nothing.
    const recorded = (head?.generation.seeds ?? []) as SeedRecord[];
    const known = new Set(recorded.map((s) => `${s.headerHash} ${s.source}`));
    const newSeeds: SeedRecord[] = (options.seeds ?? []).flatMap((s, i) => {
      if (known.has(`${s.headerHash} ${s.source}`)) return [];
      const w = walks[i]!;
      return [{ ...s, stop: w.stop, ...(w.gapAt ? { gapAt: w.gapAt } : {}) }];
    });

    const added = [...new Set(archivedKeys)].filter((k) => !previous.has(k));
    if (added.length === 0 && newSeeds.length === 0) return { results, walks, published: false };

    // The new keys were just written; publish re-asserts them as immutable
    // (a no-op for identical bytes) and carries the earlier ones unread.
    const objects: Record<string, Uint8Array> = {};
    for (const key of added) {
      const found = await options.store.get(key);
      if (found === null) throw new Error(`archive key ${key} was archived but is missing`);
      objects[key] = found.bytes;
    }
    // The lists are rebuilt over the earlier entries and this run's. Earlier
    // index pages are not carried: each generation names its own.
    const readList = async <T>(pages: readonly string[], parse: (row: unknown) => T): Promise<T[]> => {
      const rows: T[] = [];
      for (const key of pages) {
        const found = await options.store.get(key);
        if (found === null) throw new Error(`index page ${key} is missing`);
        rows.push(...(JSON.parse(new TextDecoder().decode(found.bytes)) as unknown[]).map(parse));
      }
      return rows;
    };
    const earlier = head?.generation.index;
    const indexes = buildIndexes(
      options.fingerprint,
      [...(await readList(earlier?.blocks.pages ?? [], (r) => BlockIndexEntry.parse(r))), ...entries],
      [...(await readList(earlier?.transactions.pages ?? [], (r) => TxIndexEntry.parse(r))), ...txEntries],
    );
    const indexPages = new Set([...(earlier?.blocks.pages ?? []), ...(earlier?.transactions.pages ?? [])]);
    const published = await writer.publish({
      objects: { ...objects, ...indexes.objects },
      carried: [...previous].filter((k) => !indexPages.has(k)),
      seeds: [...recorded, ...newSeeds],
      outcomes: head?.generation.outcomes ?? {},
      // Every source that served an archived copy, so a reader can tell a
      // fixture-fed archive from a live one.
      coverage: {
        ...(head?.generation.coverage ?? {}),
        sources: [...new Set([...((head?.generation.coverage.sources as string[] | undefined) ?? []), ...servedBy])].sort(),
      },
      index: indexes.index,
    });
    if (!published) throw new Error("the archive lease was lost before publishing; rerun to finish");
    return { results, walks, published };
  } finally {
    clearInterval(timer);
    await renewing;
    // Ownership-checked: after a takeover this changes nothing.
    await writer.release().catch(() => false);
  }
}
