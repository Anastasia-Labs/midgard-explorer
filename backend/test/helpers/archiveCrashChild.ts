// A writer the crash test kills: acquires the lease and publishes one
// generation. ARCHIVE_CRASH_AT names the point it is killed at.
// Usage: ts-node --transpile-only test/helpers/archiveCrashChild.ts <root> <fp> <owner> <label>
import { FsArchiveStore } from "../../src/archive/fsStore";
import { ArchiveWriter } from "../../src/archive/publish";

async function main(): Promise<void> {
  const [root, fingerprint, owner, label] = process.argv.slice(2) as [string, string, string, string];
  const store = new FsArchiveStore(root);
  const writer = new ArchiveWriter({ store, fingerprint, owner, leaseMs: 500 });
  await writer.acquire();
  const published = await writer.publish({
    objects: { [`${fingerprint}/objects/${label}.json`]: new TextEncoder().encode(`{"label":"${label}"}`) },
  });
  process.stdout.write(published ? "published\n" : "not-published\n");
}

void main();
