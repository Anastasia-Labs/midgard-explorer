/**
 * Runs the readiness probes against whatever this environment points at and
 * prints the result of each one.
 *
 * Deployment sequencing needs an answer to "would this build serve traffic
 * correctly here?" before traffic is sent, and `/readyz` can only answer that
 * once the process is already listening.
 */
import {
  probeIndexDatabase,
  probeIndexReconciled,
  probeManifest,
  probeNodeDatabase,
  shippedMigrations,
} from "../src/server/probes";

const PROBES = [
  ["node database", probeNodeDatabase],
  ["explorer index", probeIndexDatabase],
  ["index reconciled", probeIndexReconciled],
  ["manifest", probeManifest],
] as const;

async function main(): Promise<void> {
  console.log(`migrations shipped by this build: ${shippedMigrations().length}`);
  let failed = 0;
  for (const [name, probe] of PROBES) {
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
