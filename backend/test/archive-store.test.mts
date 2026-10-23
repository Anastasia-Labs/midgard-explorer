import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArchiveConflict } from "../src/archive/store.js";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { ArchiveWriter } from "../src/archive/publish.js";
import { readHead } from "../src/archive/reader.js";
import { controlKey } from "../src/archive/keys.js";

/**
 * The archive's storage and its publication protocol.
 *
 * Readers trust one thing: `control.head`. Everything it names is written
 * first and never changes, and `control` changes only by compare-and-swap, so
 * lease takeover and publication cannot interleave. These cases pin the
 * properties that make that true.
 */

const FP = "ab".repeat(32);
const bytes = (s: string) => new TextEncoder().encode(s);
const root = () => mkdtempSync(join(tmpdir(), "archive-"));

/** A clock tests move by hand. */
const clock = (start = Date.parse("2026-10-19T00:00:00Z")) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("the filesystem store", () => {
  it("writes an immutable key once, accepts the same bytes again, and refuses others", async () => {
    const store = new FsArchiveStore(root());
    await store.putImmutable(`${FP}/objects/a.json`, bytes("one"));
    await store.putImmutable(`${FP}/objects/a.json`, bytes("one"));
    await expect(store.putImmutable(`${FP}/objects/a.json`, bytes("two"))).rejects.toBeInstanceOf(
      ArchiveConflict,
    );
    expect(new TextDecoder().decode((await store.get(`${FP}/objects/a.json`))!.bytes)).toBe("one");
  });

  it("swaps a mutable key only on the etag it was read with", async () => {
    const store = new FsArchiveStore(root());
    const key = `${FP}/control`;
    const first = await store.putIfMatch(key, bytes("v1"), null);
    expect(first.ok).toBe(true);
    expect((await store.putIfMatch(key, bytes("v2"), null)).ok).toBe(false);
    expect((await store.putIfMatch(key, bytes("v2"), "0".repeat(64))).ok).toBe(false);
    expect((await store.putIfMatch(key, bytes("v2"), first.etag)).ok).toBe(true);
    expect(new TextDecoder().decode((await store.get(key))!.bytes)).toBe("v2");
  });

  it("refuses a key that could leave the archive", async () => {
    const store = new FsArchiveStore(root());
    for (const key of ["../x", `${FP}/../../x`, "/etc/passwd", `${FP}/a b`]) {
      await expect(store.get(key), key).rejects.toThrow(/key/);
    }
  });

  /**
   * The swap itself must hold when a writer pauses between reading the current
   * value and writing the next one: a stale writer resuming after another
   * writer's swap must fail, and must not undo or unlock anything.
   */
  it("fails a swap whose writer paused after reading while another writer swapped", async () => {
    const dir = root();
    const key = `${FP}/control`;
    const first = await new FsArchiveStore(dir).putIfMatch(key, bytes("v1"), null);
    const b = new FsArchiveStore(dir);
    let bResult: { ok: boolean } | undefined;
    const a = new FsArchiveStore(dir, {
      afterRead: async () => {
        bResult = await b.putIfMatch(key, bytes("from-b"), first.etag);
      },
    });
    const aResult = await a.putIfMatch(key, bytes("from-a"), first.etag);
    expect(bResult?.ok).toBe(true);
    expect(aResult.ok).toBe(false);
    expect(new TextDecoder().decode((await b.get(key))!.bytes)).toBe("from-b");
    // B's write is still the one a third writer swaps against.
    const current = await b.get(key);
    expect((await b.putIfMatch(key, bytes("v3"), current!.etag)).ok).toBe(true);
  });

  /** Content alone cannot be the etag: a value that returns to earlier bytes
   * must not satisfy a compare made against the earlier version. */
  it("refuses an etag from an earlier version even when the bytes are the same again", async () => {
    const store = new FsArchiveStore(root());
    const key = `${FP}/control`;
    const v1 = await store.putIfMatch(key, bytes("same"), null);
    const v2 = await store.putIfMatch(key, bytes("other"), v1.etag);
    await store.putIfMatch(key, bytes("same"), v2.etag);
    expect((await store.putIfMatch(key, bytes("stale"), v1.etag)).ok).toBe(false);
  });
});

describe("the publication protocol", () => {
  const generation = (label: string) => ({
    objects: { [`${FP}/objects/${label}.json`]: bytes(`{"label":"${label}"}`) },
  });

  it("publishes a generation that readers then see, with everything it names present", async () => {
    const store = new FsArchiveStore(root());
    const t = clock();
    const a = new ArchiveWriter({ store, fingerprint: FP, owner: "a", now: t.now, leaseMs: 60_000 });
    await a.acquire();
    expect(await a.publish(generation("one"))).toBe(true);
    const head = await readHead(store, FP);
    expect(head?.generation.n).toBe(1);
    for (const key of head!.generation.references) expect(await store.get(key), key).not.toBeNull();
  });

  /** The one that matters: a takeover between A's last check and A's swap. */
  it("fails a publish that a takeover races, and keeps head off the loser's generation", async () => {
    const store = new FsArchiveStore(root());
    const t = clock();
    const b = new ArchiveWriter({ store, fingerprint: FP, owner: "b", now: t.now, leaseMs: 60_000 });
    const a = new ArchiveWriter({
      store,
      fingerprint: FP,
      owner: "a",
      now: t.now,
      leaseMs: 60_000,
      hooks: {
        beforePublishSwap: async () => {
          t.advance(10 * 60_000);
          await b.acquire();
        },
      },
    });
    await a.acquire();
    expect(await a.publish(generation("from-a"))).toBe(false);
    expect(await readHead(store, FP)).toBeNull();
    expect(await b.publish(generation("from-b"))).toBe(true);
    const head = await readHead(store, FP);
    expect(head!.generation.references).toContain(`${FP}/objects/from-b.json`);
    expect(head!.generation.references).not.toContain(`${FP}/objects/from-a.json`);
  });

  it("lets exactly one of two simultaneous takeovers win, raising the fence by one", async () => {
    const store = new FsArchiveStore(root());
    const t = clock();
    const writer = (owner: string) =>
      new ArchiveWriter({ store, fingerprint: FP, owner, now: t.now, leaseMs: 60_000 });
    const results = await Promise.allSettled([writer("a").acquire(), writer("b").acquire()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const control = JSON.parse(new TextDecoder().decode((await store.get(controlKey(FP)))!.bytes));
    expect(control.lease.fence).toBe(1);
  });

  it("frees the lease on release, keeping head, so the next writer starts at once", async () => {
    const store = new FsArchiveStore(root());
    const t = clock();
    const a = new ArchiveWriter({ store, fingerprint: FP, owner: "a", now: t.now, leaseMs: 60_000 });
    await a.acquire();
    await a.publish(generation("one"));
    expect(await a.release()).toBe(true);
    const b = new ArchiveWriter({ store, fingerprint: FP, owner: "b", now: t.now, leaseMs: 60_000 });
    expect(await b.acquire()).toBe(2);
    expect((await readHead(store, FP))?.generation.n).toBe(1);
  });

  /** Release must not undo a takeover: it clears only this writer's own lease. */
  it("leaves another writer's lease alone when a writer releases after losing it", async () => {
    const store = new FsArchiveStore(root());
    const t = clock();
    const a = new ArchiveWriter({ store, fingerprint: FP, owner: "a", now: t.now, leaseMs: 60_000 });
    const b = new ArchiveWriter({ store, fingerprint: FP, owner: "b", now: t.now, leaseMs: 60_000 });
    await a.acquire();
    t.advance(10 * 60_000);
    await b.acquire();
    expect(await a.release()).toBe(false);
    expect(await a.renew()).toBe(false);
    expect(await b.publish(generation("from-b"))).toBe(true);
  });

  /** A host name and pid can be reused; a writer instance cannot. */
  it("refuses a second writer instance with the same owner name while the first holds the lease", async () => {
    const store = new FsArchiveStore(root());
    const t = clock();
    const writer = () => new ArchiveWriter({ store, fingerprint: FP, owner: "host:123", now: t.now, leaseMs: 60_000 });
    await writer().acquire();
    await expect(writer().acquire()).rejects.toThrow(/held/);
  });

  it("refuses to publish for a holder whose lease expired, even before anyone takes over", async () => {
    const store = new FsArchiveStore(root());
    const t = clock();
    const a = new ArchiveWriter({ store, fingerprint: FP, owner: "a", now: t.now, leaseMs: 60_000 });
    await a.acquire();
    t.advance(61_000);
    expect(await a.publish(generation("late"))).toBe(false);
    expect(await readHead(store, FP)).toBeNull();
  });
});

describe("a reader during publication", () => {
  /** Readers trust only head. While writers take turns publishing, every
   * read sees a whole generation whose references all exist. */
  it("never sees a partial generation or a reference that does not exist yet", async () => {
    const dir = root();
    const reader = new FsArchiveStore(dir);
    let writing = true;
    let reads = 0;
    const failures: string[] = [];
    const loop = (async () => {
      while (writing) {
        try {
          const head = await readHead(reader, FP);
          if (head !== null) {
            for (const key of head.generation.references) {
              if ((await reader.get(key)) === null) failures.push(`missing ${key}`);
            }
          }
          reads += 1;
        } catch (err) {
          failures.push(String(err));
        }
        await new Promise((r) => setImmediate(r));
      }
    })();
    for (let round = 0; round < 6; round += 1) {
      const store = new FsArchiveStore(dir);
      const writer = new ArchiveWriter({ store, fingerprint: FP, owner: `w${round}`, leaseMs: 60_000 });
      await writer.acquire();
      const objects: Record<string, Uint8Array> = {};
      for (let i = 0; i < 20; i += 1) objects[`${FP}/objects/r${round}-${i}.json`] = bytes(`{"r":${round},"i":${i}}`);
      expect(await writer.publish({ objects, carried: (await readHead(store, FP))?.generation.references ?? [] })).toBe(true);
      await writer.release();
    }
    writing = false;
    await loop;
    expect(failures).toEqual([]);
    expect(reads).toBeGreaterThan(6);
    expect((await readHead(reader, FP))!.generation.references).toHaveLength(120);
  });
});
