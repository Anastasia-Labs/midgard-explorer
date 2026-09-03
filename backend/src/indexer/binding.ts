import { indexerPrisma, type IndexerTx } from "./db";
import type { Manifest } from "./manifest";

/**
 * Which deployment this index belongs to.
 *
 * Only `l1_event` ever carried a deployment column, so `l1_tx`, `l1_tx_io`,
 * `l1_redeemer`, `l1_tx_asset` and `l1_block_header` could not be filtered even
 * in principle. Pointing a second manifest at the same database merged two
 * deployments in five tables that cannot be separated again, and the readiness
 * suite permitted exactly that on the stated grounds that the read path filters
 * predecessor rows out, which is true of one table and false of the other five.
 *
 * One binding is smaller than a deployment column plus a filter on every table,
 * and it fails closed. The trade is that reusing an index for another
 * deployment now needs a deliberate act.
 *
 * The L2 database persists no protocol deployment identity of its own, only a
 * migration-bundle hash, so this records an operator's assertion rather than
 * something the explorer can derive. It is still worth recording: an assertion
 * that is written down and checked on every boot is what turns a silent merge
 * into a refusal.
 */

export type Binding = {
  deploymentId: string;
  network: string;
  networkMagic: number | null;
  manifestSchemaVersion: string | null;
  l2Database: string;
  boundAt: Date;
};

export type BindingCheck =
  | { state: "bound"; binding: Binding }
  | { state: "unbound"; indexIsEmpty: boolean }
  | { state: "mismatch"; binding: Binding; reason: string };

export async function readBinding(
  tx: IndexerTx = indexerPrisma,
): Promise<Binding | null> {
  const row = await tx.indexBinding.findUnique({ where: { id: true } });
  return row satisfies Binding | null;
}

/**
 * Reports how this index stands to the loaded manifest. Writes nothing.
 *
 * Split from binding on purpose. This is called from a readiness probe, and a
 * health check that mutates is not a health check: the first process to be
 * probed used to CLAIM an unbound index for whatever manifest it happened to
 * carry, so an operator who started the backend against the wrong deployment
 * and let anything hit `/readyz/l1` would silently bind a populated index to a
 * manifest that does not describe its rows.
 */
export async function checkBinding(
  manifest: Manifest,
  l2Database: string,
  tx: IndexerTx = indexerPrisma,
): Promise<BindingCheck> {
  const existing = await readBinding(tx);
  if (existing === null) {
    const rows = await tx.l1Event.count();
    return { state: "unbound", indexIsEmpty: rows === 0 };
  }

  const disagreements: string[] = [];
  if (existing.deploymentId !== manifest.deploymentId) {
    disagreements.push(
      `deployment ${existing.deploymentId} bound, manifest declares ${manifest.deploymentId}`,
    );
  }
  if (existing.network !== manifest.network) {
    disagreements.push(
      `network ${existing.network} bound, manifest declares ${manifest.network}`,
    );
  }
  if (existing.l2Database !== l2Database) {
    disagreements.push(
      `L2 database ${existing.l2Database} bound, this process reads ${l2Database}`,
    );
  }

  return disagreements.length > 0
    ? { state: "mismatch", binding: existing, reason: disagreements.join("; ") }
    : { state: "bound", binding: existing };
}

/**
 * Claims an EMPTY index for this deployment. Called once, by the writer, at
 * startup, and never from a read path.
 *
 * Refuses a populated index. Rows already in it were attributed by some earlier
 * process, and nothing here can prove they belong to the manifest now loaded;
 * adopting them on the strength of a configuration file is how two deployments
 * end up merged in five tables that carry no deployment of their own. A
 * populated unbound index needs a deliberate adoption or a rebuild.
 */
export async function bindEmptyIndex(
  manifest: Manifest,
  l2Database: string,
  tx: IndexerTx = indexerPrisma,
): Promise<BindingCheck> {
  const current = await checkBinding(manifest, l2Database, tx);
  if (current.state !== "unbound") return current;

  if (!current.indexIsEmpty) {
    return {
      state: "mismatch",
      binding: {
        deploymentId: "(none)",
        network: manifest.network,
        networkMagic: null,
        manifestSchemaVersion: manifest.schemaVersion,
        l2Database,
        boundAt: new Date(),
      },
      reason:
        "the index already holds rows but carries no binding, so which deployment " +
        "wrote them cannot be established from this process's configuration",
    };
  }

  const created = await tx.indexBinding.create({
    data: {
      deploymentId: manifest.deploymentId,
      network: manifest.network,
      networkMagic: null,
      manifestSchemaVersion: manifest.schemaVersion,
      l2Database,
    },
  });
  return { state: "bound", binding: created satisfies Binding };
}

/** The message an operator gets, naming the two ways out rather than only the
 * problem. A refusal that does not say how to proceed becomes a reason to
 * disable the check. */
export function mismatchMessage(reason: string): string {
  return (
    `This explorer index is bound to a different deployment: ${reason}. ` +
    `An index holds one deployment's rows in tables that carry no deployment ` +
    `of their own, so serving from it under another manifest would merge two ` +
    `deployments where nothing can separate them again. Either point this ` +
    `process at that deployment's own index, or rebuild this one: clear the ` +
    `derived L1 tables and its binding, then re-index from the intended ` +
    `manifest.`
  );
}
