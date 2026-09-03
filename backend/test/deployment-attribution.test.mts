import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexerPrisma } from "../src/indexer/db.js";
import { ingestTxInfos } from "../src/indexer/ingest.js";
import { computeDeploymentId, loadManifest } from "../src/indexer/manifest.js";
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

const FIXTURE = new URL("./fixtures/manifest-sample.json", import.meta.url).pathname;

/** Through the Koios parser, not straight from the file. The raw document
 * carries `asset_list` as the string "[]" on `collateral_output`, which is what
 * Koios really returns there; only the parser normalises it. A test that feeds
 * the file directly to the ingester is testing a shape that never arrives. */
const infos = parseTxInfo(
  JSON.parse(
    readFileSync(new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url), "utf8"),
  ),
);

const manifest = loadManifest(FIXTURE);

/** A different deployment: the same contracts but for one script, under the
 * identity that contract set actually hashes to. A query that still returns
 * events is filtering on nothing.
 *
 * The identity cannot simply be relabelled any more. It is recomputed from the
 * document, so a manifest claiming to be a different deployment while
 * describing the same scripts is refused outright, which is the point: that is
 * how an edited contract set kept a legitimate-looking identity. To be a
 * different deployment it has to describe different scripts. */
function manifestUnderOtherIdentity(): { path: string; deploymentId: string } {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  // A contract the ingested event does not belong to, so the validator under
  // test is still present and only the deployment it sits in has changed.
  doc.contracts.depositMint.scriptHash = "b".repeat(56);
  doc.manifestId = computeDeploymentId(doc);
  const path = join(tmpdir(), `midgard-other-identity-${process.pid}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return { path, deploymentId: doc.manifestId };
}

function setManifestPath(path: string | undefined): void {
  (config as { MIDGARD_MANIFEST_PATH: string | undefined }).MIDGARD_MANIFEST_PATH = path;
}

let reachable = false;
let ingestedFamily: string | null = null;
let ingestedScriptHash: string | null = null;
const originalManifestPath = config.MIDGARD_MANIFEST_PATH;

beforeAll(async () => {
  reachable = await isReachable("index", "deployment attribution");

  setManifestPath(FIXTURE);
  await truncateL1();
  await ingestTxInfos(infos, manifest.validators, manifest.deploymentId);

  const event = await indexerPrisma.l1Event.findFirst();
  ingestedFamily = event?.validator ?? null;
  ingestedScriptHash =
    manifest.validators.find((v) => v.family === ingestedFamily)?.scriptHash ?? null;
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
    const other = manifestUnderOtherIdentity();
    expect(other.deploymentId).not.toBe(manifest.deploymentId);
    setManifestPath(other.path);
    const result = await getL1Validator(ingestedScriptHash!);

    expect(result).not.toBeNull();
    expect(result!.deployment).toBe(other.deploymentId);

    // Same rows, same validator, different deployment. If this is non-zero the
    // filter is not discriminating and the test above proves nothing.
    const total = result!.history.reduce((sum, row) => sum + row.eventCount, 0);
    expect(total).toBe(0);
  });
});
