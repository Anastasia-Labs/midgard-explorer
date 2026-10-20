import { controlKey } from "./keys";
import { Control, Generation } from "./schema";
import type { ArchiveStore } from "./store";

const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

/**
 * The published generation, read once through `control.head`. A reader uses
 * only what this generation references, all of which was written before it was
 * published, so it never sees a partial or mixed archive.
 */
export async function readHead(
  store: ArchiveStore,
  fingerprint: string,
): Promise<{ key: string; generation: Generation } | null> {
  const found = await store.get(controlKey(fingerprint));
  if (found === null) return null;
  const { head } = Control.parse(parse(found.bytes));
  if (head === null) return null;
  const generation = await store.get(head.generationKey);
  if (generation === null) {
    throw new Error(`archive head names ${head.generationKey}, which does not exist`);
  }
  return { key: head.generationKey, generation: Generation.parse(parse(generation.bytes)) };
}
