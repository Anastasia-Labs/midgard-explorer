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
  probeDeploymentBinding,
} from "../src/server/probes";

/** Every probe, and the scopes each one belongs to.
 *
 * These mirror the HTTP routes exactly, so the same name cannot answer two
 * different questions. `full` is `/readyz/full`, `l2` is `/readyz`, and `l1` is
 * `/readyz/l1`.
 *
 * `l2` is whether this process can serve Midgard blocks, transactions,
 * addresses and UTxOs. Those come from the node's own tables, so they wait on
 * no reconciliation pass against Koios and do not read the deployment manifest,
 * which describes the L1 contracts. It no longer includes the explorer index:
 * no L2 page reads it, and including it meant an index outage still reported
 * the L2 surface as unready.
 *
 * `full` remains what a deployment gates on, and is the union of the two.
 */
const SCOPES = ["full", "l2", "l1"] as const;
type Scope = (typeof SCOPES)[number];

const PROBES: ReadonlyArray<{
  name: string;
  probe: () => Promise<void>;
  scopes: readonly Scope[];
}> = [
  { name: "node database", probe: probeNodeDatabase, scopes: ["full", "l2", "l1"] },
  { name: "explorer index", probe: probeIndexDatabase, scopes: ["full", "l1"] },
  { name: "index reconciled", probe: probeIndexReconciled, scopes: ["full", "l1"] },
  { name: "manifest", probe: probeManifest, scopes: ["full", "l1"] },
  { name: "deployment binding", probe: probeDeploymentBinding, scopes: ["full", "l1"] },
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
      `scope: ${scope}. This answers /readyz${scope === "l1" ? "/l1" : ""}, ` +
        `not the deployment gate, which is --scope=full and /readyz/full.`,
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
