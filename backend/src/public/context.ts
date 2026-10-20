import { config } from "../config";
import { FsArchiveStore } from "../archive/fsStore";
import { loadManifest } from "../db/manifest";
import { ArchiveView } from "./archiveView";
import { NodeClient } from "./nodeClient";

/**
 * The public source's inputs, built once from configuration.
 *
 * The archive fingerprint is the manifest's id: the same id the ingester
 * verified and keyed every object under, so this process can only ever read
 * the deployment its manifest names.
 */
export type PublicContext = {
  view: ArchiveView;
  node: NodeClient;
  fingerprint: string;
  network: string;
};

let context: PublicContext | null = null;

export function publicContext(): PublicContext {
  if (context !== null) return context;
  if (config.ARCHIVE_DIR === undefined || config.MIDGARD_NODE_URL === undefined) {
    throw new Error("the public source needs ARCHIVE_DIR and MIDGARD_NODE_URL");
  }
  const manifest = loadManifest(config.MIDGARD_MANIFEST_PATH);
  context = {
    view: new ArchiveView(new FsArchiveStore(config.ARCHIVE_DIR), manifest.deploymentId),
    node: new NodeClient(config.MIDGARD_NODE_URL, { deploymentFingerprint: manifest.deploymentId }),
    fingerprint: manifest.deploymentId,
    network: manifest.network,
  };
  return context;
}

/** Whether any archived copy came from a recorded fixture rather than a peer. */
export async function archiveHoldsFixtures(view: ArchiveView): Promise<boolean> {
  const head = await view.head();
  const sources = (head?.generation.coverage.sources as string[] | undefined) ?? [];
  return sources.some((s) => s.startsWith("fixture:"));
}
