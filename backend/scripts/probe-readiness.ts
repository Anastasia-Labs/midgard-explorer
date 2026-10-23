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
 */
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
  let failed = 0;
  for (const { name, probe } of PROBES) {
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
