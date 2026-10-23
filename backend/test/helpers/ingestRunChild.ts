// One `pnpm ingest` run as its own process, serving the fixture blocks from a
// stub source: what two consecutive CLI invocations do to the lease.
// Usage: ts-node --transpile-only test/helpers/ingestRunChild.ts <root> <fp> <headerHash>
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { FsArchiveStore } from "../../src/archive/fsStore";
import { runIngest } from "../../ingest/run";
import type { PayloadSource } from "../../ingest/ingestBlock";

const [root, fingerprint, headerHash] = process.argv.slice(2) as [
  string,
  string,
  string,
];
const { blocks } = JSON.parse(
  readFileSync(
    join(__dirname, "../fixtures/da-payloads-f4cf28ca1.json"),
    "utf8",
  ),
) as { blocks: Array<{ headerHash: string; identity: string }> };

async function main(): Promise<void> {
  // The SDK is ESM; this script is CommonJS.
  const { admitEvidenceProvenance, assertSecurityGradeEvidence } = await import(
    "@al-ft/midgard-sdk"
  );
  const source: PayloadSource = {
    sourceId: "stub",
    async fetchPayloadByHeaderHash(hash, options) {
      const block = blocks.find((b) => b.headerHash === hash)!;
      const payloadEnvelopeCbor = Buffer.from(block.identity, "hex");
      await options?.verifyPayload?.(payloadEnvelopeCbor);
      return {
        ok: true,
        sourceId: "stub",
        sourcePeerId: "p",
        payloadEnvelopeCbor,
        metadata: {},
        attempts: [],
        provenance: assertSecurityGradeEvidence(
          admitEvidenceProvenance({
            provenance: {
              trustClass: "public_or_permissionless_da",
              sourceId: "stub/p",
              grade: "security",
            },
          }),
        ),
      };
    },
  };

  await runIngest({
    store: new FsArchiveStore(root),
    fingerprint,
    headerHashes: [headerHash],
    sources: [source],
    limits: { maxPayloadBytes: 64 * 1024 * 1024 },
    retries: 0,
    owner: `${hostname()}:${process.pid}`,
    leaseMs: 120_000,
  }).then(
    (report) =>
      process.stdout.write(`${report.results[0]!.state} ${report.published}\n`),
    (err) => {
      process.stdout.write(`error ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}

void main();
