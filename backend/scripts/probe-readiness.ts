/**
 * Runs the readiness probes against whatever this environment points at and
 * prints the result of each one.
 *
 * Deployment sequencing needs an answer to "would this build serve traffic
 * correctly here?" before traffic is sent, and `/readyz` can only answer that
 * once the process is already listening.
 *
 * One scope, because there is one. The probes used to be split between `l2`
 * and `l1`, mirroring `/readyz` and `/readyz/l1`, so that an outage of the
 * explorer-owned Cardano index could never report the Midgard pages as unready.
 * That index is decommissioned and the scopes went with it; a `--scope` flag
 * that silently accepted a name it no longer honours would be worse than none.
 *
 * `--manifest=optional` is what `pnpm dev` passes. ADR 0003 lets a development
 * instance serve L2 reads with no manifest configured, so an unset path is
 * reported as SKIPPED and does not fail the run. A path that IS set is probed
 * in full and refused when unusable. Without the flag the check is the one
 * `/readyz` runs.
 */
import { config } from "../src/config";
import { probeManifest, probeNodeDatabase } from "../src/server/probes";

const PROBES: ReadonlyArray<{ name: string; probe: () => Promise<void> }> = [
  { name: "node database", probe: probeNodeDatabase },
  { name: "manifest", probe: probeManifest },
];

async function main(): Promise<void> {
  const unknown = process.argv.slice(2).find((arg) => arg.startsWith("--scope="));
  if (unknown !== undefined) {
    console.error(
      `${unknown} is no longer a scope: the Cardano index this split existed for is decommissioned.`,
    );
    process.exit(2);
  }
  const manifestFlag = process.argv.slice(2).find((arg) => arg.startsWith("--manifest="));
  if (manifestFlag !== undefined && manifestFlag !== "--manifest=optional") {
    console.error(`${manifestFlag} is not a manifest mode. The only one is --manifest=optional.`);
    process.exit(2);
  }
  const manifestOptional = manifestFlag !== undefined;

  let failed = 0;
  for (const { name, probe } of PROBES) {
    if (name === "manifest" && manifestOptional && config.MIDGARD_MANIFEST_PATH === undefined) {
      console.log(`SKIPPED    ${name}: MIDGARD_MANIFEST_PATH is not set`);
      continue;
    }
    try {
      await probe();
      console.log(`READY      ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`NOT READY  ${name}: ${(err as Error).message}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

void main();
