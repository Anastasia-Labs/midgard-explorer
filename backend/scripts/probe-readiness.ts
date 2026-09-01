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

/** Every probe, and the scopes each one belongs to.
 *
 * `full` is what `/readyz` answers and what a deployment gates on. Nothing
 * about it changes here.
 *
 * `l2` is a development scope: whether this process can serve L2 blocks,
 * transactions, addresses and UTxOs from the node's database. Those come from
 * the node's own tables, so they do not wait on a reconciliation pass against
 * Koios, and they do not read the deployment manifest, which describes the L1
 * contracts. A contributor pointing the explorer at an existing Midgard
 * database is asking that narrower question, and answering it with the full
 * check reports "not ready" for a page that would render correctly.
 *
 * It exists on the command line only. `/readyz` gaining a second answer would
 * give a load balancer two verdicts for one question.
 */
const SCOPES = ["full", "l2"] as const;
type Scope = (typeof SCOPES)[number];

const PROBES: ReadonlyArray<{
  name: string;
  probe: () => Promise<void>;
  scopes: readonly Scope[];
}> = [
  { name: "node database", probe: probeNodeDatabase, scopes: ["full", "l2"] },
  { name: "explorer index", probe: probeIndexDatabase, scopes: ["full", "l2"] },
  { name: "index reconciled", probe: probeIndexReconciled, scopes: ["full"] },
  { name: "manifest", probe: probeManifest, scopes: ["full"] },
];

function requestedScope(argv: readonly string[]): Scope {
  const flag = argv.find((arg) => arg.startsWith("--scope="));
  if (flag === undefined) return "full";
  const value = flag.slice("--scope=".length);
  if (!SCOPES.includes(value as Scope)) {
    console.error(`Unknown scope: ${value}. Use one of: ${SCOPES.join(", ")}`);
    process.exit(2);
  }
  return value as Scope;
}

async function main(): Promise<void> {
  const scope = requestedScope(process.argv.slice(2));
  console.log(`migrations shipped by this build: ${shippedMigrations().length}`);
  if (scope !== "full") {
    console.log(
      `scope: ${scope}. This is not what /readyz answers, and not a deployment gate.`,
    );
  }
  let failed = 0;
  for (const { name, probe } of PROBES.filter((p) => p.scopes.includes(scope))) {
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
