import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FsArchiveStore } from "../src/archive/fsStore.js";
import { readHead } from "../src/archive/reader.js";

/**
 * A writer killed at any point leaves the archive readable, and a rerun
 * finishes the job.
 *
 * `head` moves only by one compare-and-swap, after everything it will name is
 * written. So a kill before that swap leaves the previous head, and a kill
 * after the link leaves the new one, complete either way. The killed writer's
 * lease is still held, so the rerun runs as the same owner.
 */

const FP = "cd".repeat(32);
const backend = resolve(import.meta.dirname, "..");

const run = (root: string, label: string, crashAt?: string) =>
  spawnSync(
    join(backend, "node_modules/.bin/ts-node"),
    ["--transpile-only", "test/helpers/archiveCrashChild.ts", root, FP, "writer", label],
    {
      cwd: backend,
      encoding: "utf8",
      env: { ...process.env, ARCHIVE_CRASH_AT: crashAt ?? "" },
      timeout: 60_000,
    },
  );

/** Whatever head names exists, and so does everything it references. */
const assertConsistent = async (store: FsArchiveStore) => {
  const head = await readHead(store, FP);
  if (head === null) return null;
  for (const key of head.generation.references) expect(await store.get(key), key).not.toBeNull();
  return head;
};

describe("a writer killed mid-publish", () => {
  for (const point of [
    "publish:after-objects",
    "publish:after-generation",
    "put-if-match:before-link",
    "put-if-match:after-link",
  ]) {
    it(`at ${point} leaves a consistent archive that a rerun completes`, async () => {
      const root = mkdtempSync(join(tmpdir(), "archive-crash-"));
      const store = new FsArchiveStore(root);

      const killed = run(root, "first", point);
      expect(killed.signal, killed.stderr).toBe("SIGKILL");
      await assertConsistent(store);

      // The rerun is a new writer instance, so it waits out the killed one's
      // lease (500 ms, plus one lease of margin) rather than inheriting it.
      await new Promise((r) => setTimeout(r, 1200));

      const rerun = run(root, "second");
      expect(rerun.stdout.trim(), rerun.stderr).toBe("published");
      const head = await assertConsistent(store);
      expect(head?.generation.references).toContain(`${FP}/objects/second.json`);
    }, 120_000);
  }
});
