import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexerPrisma } from "../src/indexer/db.js";
import { ingestTxInfos } from "../src/indexer/ingest.js";
import { loadManifest } from "../src/indexer/manifest.js";
import { parseTxInfo } from "../src/indexer/koios.js";
import { getL1Validator } from "../src/db/l1.js";
import { config } from "../src/config.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * Ingest-to-query attribution.
 *
 * Events were written with the `deployment` column left to its schema default
 * while `getL1Validator` filtered on the manifest's declared identity. Every
 * event was ingested correctly and no query could return one. The live index
 * carried 158 events under "default" against a manifest identity of
 * a56045c3..., so the validator page showed an empty event list for a validator
 * whose events were all present.
 *
 * The tests that existed asserted the shape of the response, so an empty array
 * satisfied them. These assert that a specific ingested event comes back, and
 * that it stops coming back when the identity changes. Both halves are needed:
 * without the second, a filter that was accidentally dropped would still pass.
 */

const FIXTURE = new URL("./fixtures/manifest-sample.json", import.meta.url)
  .pathname;

/** Through the Koios parser, not straight from the file. The raw document
 * carries `asset_list` as the string "[]" on `collateral_output`, which is what
 * Koios really returns there; only the parser normalises it. A test that feeds
 * the file directly to the ingester is testing a shape that never arrives. */
const infos = parseTxInfo(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url),
      "utf8",
    ),
  ),
);

const manifest = loadManifest(FIXTURE);

/** The same contract set under a different declared identity. Nothing else
 * differs, so a query that still returns events is filtering on nothing. */
function manifestUnderOtherIdentity(): string {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  doc.manifestId = "b".repeat(64);
  const path = join(tmpdir(), `midgard-other-identity-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

function setManifestPath(path: string): void {
  (config as { MIDGARD_MANIFEST_PATH: string }).MIDGARD_MANIFEST_PATH = path;
}

let reachable = false;
let ingestedFamily: string | null = null;
let ingestedScriptHash: string | null = null;
const originalManifestPath = config.MIDGARD_MANIFEST_PATH;

async function probe(): Promise<void> {
  await Promise.race([
    indexerPrisma.$queryRaw`SELECT 1;`,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("probe timed out after 3000ms")), 3000),
    ),
  ]);
}

beforeAll(async () => {
  try {
    await probe();
    reachable = true;
  } catch (err) {
    if (process.env.REQUIRE_DB === "1") throw err;
    console.warn(`Skipping: indexer Postgres unreachable. ${String(err)}`);
    return;
  }

  setManifestPath(FIXTURE);
  await truncateL1();
  await ingestTxInfos(infos, manifest.validators, manifest.deploymentId);

  const event = await indexerPrisma.l1Event.findFirst();
  ingestedFamily = event?.validator ?? null;
  ingestedScriptHash =
    manifest.validators.find((v) => v.family === ingestedFamily)?.scriptHash ??
    null;
});

afterAll(async () => {
  setManifestPath(originalManifestPath);
  if (reachable) {
    await truncateL1();
    await indexerPrisma.$disconnect().catch(() => undefined);
  }
});

describe("deployment attribution", () => {
  it("ingests at least one event, so the round trip has something to find", () => {
    if (!reachable) return;
    expect(ingestedFamily).not.toBeNull();
    expect(ingestedScriptHash).not.toBeNull();
  });

  it("writes the manifest identity rather than the column default", async () => {
    if (!reachable) return;
    const rows = await indexerPrisma.l1Event.findMany({
      select: { deployment: true },
      distinct: ["deployment"],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.deployment)).toEqual([manifest.deploymentId]);
    expect(rows.map((r) => r.deployment)).not.toContain("default");
  });

  it("returns an ingested event through the real query path", async () => {
    if (!reachable) return;
    setManifestPath(FIXTURE);
    const result = await getL1Validator(ingestedScriptHash!);

    expect(result).not.toBeNull();
    expect(result!.deployment).toBe(manifest.deploymentId);

    // The assertion that the previous tests were missing: a specific event
    // comes back, not merely an array of some length.
    const withEvents = result!.history.filter((row) => row.eventCount > 0);
    expect(withEvents.length).toBeGreaterThan(0);
    expect(withEvents[0]!.txHash).toMatch(/^[0-9a-f]{64}$/);

    const total = result!.history.reduce((sum, row) => sum + row.eventCount, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("returns no events once the deployment identity differs", async () => {
    if (!reachable) return;
    setManifestPath(manifestUnderOtherIdentity());
    const result = await getL1Validator(ingestedScriptHash!);

    expect(result).not.toBeNull();
    expect(result!.deployment).toBe("b".repeat(64));

    // Same rows, same validator, different deployment. If this is non-zero the
    // filter is not discriminating and the test above proves nothing.
    const total = result!.history.reduce((sum, row) => sum + row.eventCount, 0);
    expect(total).toBe(0);
  });
});
