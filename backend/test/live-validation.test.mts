import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import { syncOnce } from "../src/indexer/sync.js";
import { loadManifest, contractPurpose } from "../src/indexer/manifest.js";
import { getL1Validator } from "../src/db/l1.js";
import { probeIndexDatabase, probeNodeDatabase, probeManifest } from "../src/server/probes.js";
import { config } from "../src/config.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * End to end against the real deployment, opt in.
 *
 * Reaches live Koios and the node's database, so it is off unless LIVE_E2E=1.
 * It runs one real sync pass against the configured tx-validation manifest and
 * asserts the things this work changed, in the place they actually have to
 * hold: attribution survives ingest to query, and the executions address
 * history cannot see are indexed.
 *
 * It writes to whichever index INDEXER_POSTGRES_URL names. Point that at a test
 * database; the suite already refuses any name not ending in `_test`.
 */

const LIVE = process.env.LIVE_E2E === "1";
const manifest = loadManifest(config.MIDGARD_MANIFEST_PATH);

let scanned = 0;
let ingested = 0;

beforeAll(async () => {
  if (!LIVE) return;
  await truncateL1();
  const result = await syncOnce();
  scanned = result.scanned;
  ingested = result.ingested;
}, 900_000);

afterAll(async () => {
  if (LIVE) await indexerPrisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!LIVE)("live deployment validation", () => {
  it("reads the tx-validation manifest and states its identity", () => {
    expect(manifest.schemaVersion).toBe("midgard-deployment-manifest-v2");
    expect(manifest.deploymentId).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.deploymentId).not.toBe("default");
  });

  it("indexes transactions from the live chain", () => {
    expect(scanned).toBeGreaterThan(0);
    expect(ingested).toBeGreaterThan(0);
  });

  it("attributes every event to the manifest identity, never the old default", async () => {
    const rows = await indexerPrisma.l1Event.findMany({
      select: { deployment: true },
      distinct: ["deployment"],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.deployment)).toEqual([manifest.deploymentId]);
  });

  it("returns those events through the query path the page uses", async () => {
    const withEvents = await indexerPrisma.l1Event.findFirst();
    expect(withEvents).not.toBeNull();
    const validator = manifest.validators.find(
      (v) => v.family === withEvents!.validator,
    );
    expect(validator).toBeDefined();

    const result = await getL1Validator(validator!.scriptHash);
    expect(result).not.toBeNull();
    expect(result!.deployment).toBe(manifest.deploymentId);
    const total = result!.history.reduce((sum, r) => sum + r.eventCount, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("covers every purpose the manifest declares", () => {
    const purposes = new Set(
      manifest.validators.map((v) => contractPurpose(v.entryName)),
    );
    // Observer is gone: the deployed manifest has no such entry.
    expect(purposes.has("Observer" as never)).toBe(false);
    expect(purposes.has("Mint")).toBe(true);
    expect(purposes.has("Withdraw")).toBe(true);
    expect(purposes.has("Spend")).toBe(true);

    // Every Mint entry has a policy to scan and every Withdraw entry a reward
    // account. Without these the scan silently covers only Spend.
    for (const v of manifest.validators) {
      if (v.purpose === "Mint") expect(v.policyId).toBe(v.scriptHash);
      if (v.purpose === "Withdraw") {
        expect(v.rewardAddress).toMatch(/^stake_test1|^stake1/);
      }
    }
  });

  it("indexes the withdraw registration the address scan could never see", async () => {
    // Verified on preprod 2026-08-27: the phasMembership reward account is
    // registered, and this transaction was absent from the index because
    // nothing is ever paid to or spent from the enterprise address.
    const row = await indexerPrisma.l1Tx.findUnique({
      where: {
        txHash:
          "75e2b7d9e2a1b8badd635a29b74e08975a72ef6574718e59eb1c538b6b60b7ef",
      },
    });
    expect(row).not.toBeNull();
  });

  it("passes every readiness probe against the real databases", async () => {
    await expect(probeNodeDatabase()).resolves.toBeUndefined();
    await expect(probeIndexDatabase()).resolves.toBeUndefined();
    await expect(probeManifest()).resolves.toBeUndefined();
  });
});
