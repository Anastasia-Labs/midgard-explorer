#!/usr/bin/env node
/**
 * Claims an EXISTING explorer index for a deployment, deliberately.
 *
 * The writer binds an empty index on its first pass, and readiness only ever
 * reads. Neither will claim a database that already holds rows, because nothing
 * in a process's configuration can prove that rows written by some earlier
 * process belong to the manifest now loaded. Adopting one is a judgement an
 * operator makes, so it is a command an operator runs.
 *
 * Before binding, this checks what the existing rows actually say. Every
 * `l1_event` carries the deployment it was ingested under, so an index whose
 * events disagree with the manifest is refused rather than relabelled: the
 * binding is meant to record a fact, and writing one over rows that contradict
 * it would make it a lie with a timestamp.
 *
 *   cd backend && pnpm adopt-index            # report what would happen
 *   cd backend && pnpm adopt-index --confirm  # write the binding
 */
import { config } from "../src/config";
import { prisma } from "../src/db";
import { indexerPrisma } from "../src/indexer/db";
import { readBinding } from "../src/indexer/binding";
import { loadManifest } from "../src/indexer/manifest";

const die = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const confirm = process.argv.includes("--confirm");

async function main(): Promise<void> {

  const manifest = loadManifest(config.MIDGARD_MANIFEST_PATH);
  const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db;`;
    const l2Database = rows[0]?.db ?? die("the node connection did not name its database");

  const existing = await readBinding();
  if (existing !== null) {
    if (existing.deploymentId === manifest.deploymentId && existing.network === manifest.network) {
      process.stdout.write(`Already bound to ${existing.deploymentId} on ${existing.network}.\n`);
      process.exit(0);
    }
    die(
      `This index is bound to ${existing.deploymentId} on ${existing.network}, and the ` +
        `manifest declares ${manifest.deploymentId} on ${manifest.network}.\n` +
        `Adoption does not rebind. Point this process at that deployment's index, or ` +
        `rebuild this one.`,
    );
  }

  // What the rows themselves say. A deployment the manifest does not name is the
  // signal that this index belongs to something else.
  const byDeployment = await indexerPrisma.l1Event.groupBy({
    by: ["deployment"],
    _count: { _all: true },
  });
  const events = byDeployment.reduce((n, g) => n + g._count._all, 0);

  process.stdout.write(`Index events: ${events}\n`);
  for (const group of byDeployment) {
    const mark = group.deployment === manifest.deploymentId ? "matches manifest" : "FOREIGN";
    process.stdout.write(`  ${group.deployment}  ${group._count._all}  ${mark}\n`);
  }

  const foreign = byDeployment.filter((g) => g.deployment !== manifest.deploymentId);
  if (foreign.length > 0) {
    die(
      `\nRefusing to adopt: ${foreign.length} deployment ` +
        `${foreign.length === 1 ? "identity" : "identities"} in this index do not match the ` +
        `manifest.\nRebuild the index under the intended manifest instead.`,
    );
  }

  if (!confirm) {
    process.stdout.write(
      `\nEvery event matches ${manifest.deploymentId}.\n` +
        `Re-run with --confirm to write the binding.\n`,
    );
    process.exit(0);
  }

  await indexerPrisma.indexBinding.create({
    data: {
      deploymentId: manifest.deploymentId,
      network: manifest.network,
      networkMagic: null,
      manifestSchemaVersion: manifest.schemaVersion,
      l2Database,
    },
  });
  process.stdout.write(`\nBound this index to ${manifest.deploymentId} on ${manifest.network}.\n`);
  await prisma.$disconnect();
  await indexerPrisma.$disconnect();

}

main().catch((error) => die(String(error)));
