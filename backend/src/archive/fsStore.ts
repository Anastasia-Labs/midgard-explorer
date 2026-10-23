import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { assertKey } from "./keys";
import { ArchiveConflict, type ArchiveStore } from "./store";

const etagOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A mutable key is a directory of numbered versions; the highest is current. */
const VERSIONS = ".versions";
const versionName = (seq: number) => String(seq).padStart(12, "0");

const isScratch = (name: string) => name.includes(".tmp-");

/** Test seams. Nothing in production sets them. */
export type FsStoreHooks = { afterRead?: () => Promise<void> };

/** Crash points the crash tests inject by environment, and nothing else does. */
export const crashAt = (point: string): void => {
  if (process.env.ARCHIVE_CRASH_AT === point) process.kill(process.pid, "SIGKILL");
};

/**
 * The archive on a local filesystem (D2).
 *
 * Immutable keys are linked into place, which fails when the key exists, so a
 * second writer can never replace one.
 *
 * A mutable key, such as `control`, is a directory of numbered versions, and
 * a swap links version n + 1 into place, which fails when another writer got
 * there first. There is no lock: a writer that pauses after reading version n,
 * for any length of time, finds n + 1 taken when it resumes and reports a lost
 * swap, and nothing it does can remove another writer's version. The etag
 * names the version as well as the bytes, so a value that returns to earlier
 * bytes never satisfies a compare made against the earlier version. Versions
 * are kept; each is a small JSON object written once per swap.
 */
export class FsArchiveStore implements ArchiveStore {
  private readonly root: string;
  private readonly hooks: FsStoreHooks;
  constructor(root: string, hooks: FsStoreHooks = {}) {
    this.root = root;
    this.hooks = hooks;
  }

  private path(key: string): string {
    return join(this.root, ...assertKey(key).split("/"));
  }

  /** The current version of a mutable key, or null when it has none. */
  private async latest(key: string): Promise<{ seq: number; bytes: Uint8Array; etag: string } | null> {
    const dir = `${this.path(key)}${VERSIONS}`;
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => /^\d{12}$/.test(n)).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const last = names.at(-1);
    if (last === undefined) return null;
    const bytes = new Uint8Array(await readFile(join(dir, last)));
    const seq = Number(last);
    return { seq, bytes, etag: `${seq}-${etagOf(bytes)}` };
  }

  async get(key: string) {
    const mutable = await this.latest(key);
    if (mutable !== null) return { bytes: mutable.bytes, etag: mutable.etag };
    try {
      const bytes = new Uint8Array(await readFile(this.path(key)));
      return { bytes, etag: etagOf(bytes) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private async writeTemp(path: string, bytes: Uint8Array): Promise<string> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp-${randomUUID()}`;
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return temp;
  }

  private async syncDir(dir: string): Promise<void> {
    const handle = await open(dir, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async putImmutable(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.path(key);
    const temp = await this.writeTemp(path, bytes);
    try {
      await link(temp, path);
      await this.syncDir(dirname(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const existing = new Uint8Array(await readFile(path));
      if (etagOf(existing) !== etagOf(bytes)) throw new ArchiveConflict(key);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }

  async putIfMatch(key: string, bytes: Uint8Array, expectedEtag: string | null) {
    const dir = `${this.path(key)}${VERSIONS}`;
    const current = await this.latest(key);
    await this.hooks.afterRead?.();
    const currentEtag = current?.etag ?? null;
    if (currentEtag !== expectedEtag) return { ok: false, etag: currentEtag };
    const seq = (current?.seq ?? 0) + 1;
    const temp = await this.writeTemp(join(dir, versionName(seq)), bytes);
    try {
      crashAt("put-if-match:before-link");
      await link(temp, join(dir, versionName(seq)));
      crashAt("put-if-match:after-link");
      await this.syncDir(dir);
      return { ok: true, etag: `${seq}-${etagOf(bytes)}` };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Another writer took version `seq` after this one read version seq - 1.
      return { ok: false, etag: (await this.latest(key))?.etag ?? null };
    } finally {
      await unlink(temp).catch(() => {});
    }
  }

  async list(prefix: string, after?: string, limit = 1000): Promise<string[]> {
    const keys: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && entry.name.endsWith(VERSIONS)) {
          keys.push(relative(this.root, full.slice(0, -VERSIONS.length)).split(sep).join("/"));
        } else if (entry.isDirectory()) await walk(full);
        else if (!isScratch(entry.name)) keys.push(relative(this.root, full).split(sep).join("/"));
      }
    };
    await walk(this.root);
    return keys
      .filter((key) => key.startsWith(prefix) && (after === undefined || key > after))
      .sort()
      .slice(0, limit);
  }
}
