import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexerPrisma } from "../src/indexer/db.js";
import { syncOnce } from "../src/indexer/sync.js";
import { fetchAccountUpdates, fetchTxInfo } from "../src/indexer/koios.js";
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

  it("scans every purpose the manifest declares, not only the ones it kept", () => {
    // Counted against the document rather than against what survived parsing.
    // The old version asserted that at least one Mint and one Withdraw entry
    // existed, which stayed true while three purposes were being dropped.
    const declared = manifest.entries.filter((e) => !e.placeholder);
    const scannedNames = new Set(manifest.scanTargets.map((v) => v.entryName));
    for (const entry of declared) {
      expect(scannedNames.has(entry.entryName)).toBe(true);
    }

    // Every Mint target has a policy to scan and every Withdraw target a reward
    // account. Without these the scan silently covers only Spend.
    for (const v of manifest.scanTargets) {
      if (v.purpose === "Mint") expect(v.policyId).toBe(v.scriptHash);
      if (v.purpose === "Withdraw") {
        expect(v.rewardAddress).toMatch(/^stake_test1|^stake1/);
      }
    }
    // Observer is gone: the deployed manifest has no such entry.
    const purposes = new Set(manifest.entries.map((v) => contractPurpose(v.entryName)));
    expect(purposes.has("Observer" as never)).toBe(false);
  });

  it("indexes the reward-account transaction the address scan could never see", async () => {
    // Verified on preprod 2026-08-27: the phasMembership reward account is
    // registered, and this transaction was absent from the index because
    // nothing is ever paid to or spent from the enterprise address.
    //
    // This proves the reward-account SOURCE, not a withdraw execution. The
    // transaction is a stake_registration with no withdrawals and no Plutus
    // contracts, so it carries no withdraw redeemer to index. Indexing an
    // execution is proved on the ingest path in withdraw-execution.test.mts,
    // because no Withdraw execution exists on this deployment to point at.
    const row = await indexerPrisma.l1Tx.findUnique({
      where: {
        txHash:
          "75e2b7d9e2a1b8badd635a29b74e08975a72ef6574718e59eb1c538b6b60b7ef",
      },
    });
    expect(row).not.toBeNull();
  });

  it("indexes every withdraw redeemer the chain currently has", async () => {
    // Today both sides are empty, and the assertion says so out loud rather
    // than passing silently: the moment a withdrawal is submitted against one
    // of these scripts, this fails unless the indexer picked it up.
    const withdrawHashes = new Set(
      manifest.scanTargets
        .filter((v) => v.purpose === "Withdraw")
        .map((v) => v.scriptHash),
    );
    expect(withdrawHashes.size).toBeGreaterThan(0);

    const indexed = await indexerPrisma.l1Redeemer.findMany({
      where: { purpose: "reward" },
      select: { scriptHash: true, txHash: true },
    });
    for (const row of indexed) {
      expect(withdrawHashes.has(row.scriptHash)).toBe(true);
    }

    const onChain = await fetchAccountUpdates(
      manifest.scanTargets
        .map((v) => v.rewardAddress)
        .filter((a): a is string => a !== null),
    );
    const executions = await fetchTxInfo(onChain.map((u) => u.txHash));
    const expected = executions.filter((info) =>
      (info.plutus_contracts ?? []).some(
        (c) => c.input?.redeemer?.purpose === "reward",
      ),
    );
    expect(indexed.length).toBe(expected.length);
  });

  it("passes every readiness probe against the real databases", async () => {
    await expect(probeNodeDatabase()).resolves.toBeUndefined();
    await expect(probeIndexDatabase()).resolves.toBeUndefined();
    await expect(probeManifest()).resolves.toBeUndefined();
  });
});
