import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { indexerPrisma } from "../src/indexer/db.js";
import { ingestTxInfos } from "../src/indexer/ingest.js";
import { parseTxInfo } from "../src/indexer/koios.js";
import { loadManifest } from "../src/indexer/manifest.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * Indexing a Withdraw validator execution.
 *
 * This has to be proved here rather than against the chain, because on the
 * 2026-07-15 preprod deployment no Withdraw execution exists to point at.
 * Verified against Koios on 2026-08-27: the one reward account the manifest
 * declares outside a placeholder, `phasMembership`, has exactly one account
 * update, a `stake_registration`, whose transaction carries no withdrawals and
 * no Plutus contracts at all. The other Withdraw entry, `reserveWithdraw`, is a
 * recorded placeholder.
 *
 * The live suite used to offer that registration as the Withdraw proof. It is
 * not one: it proves the reward-account SOURCE finds a transaction address
 * history cannot see, which matters and is asserted there, but it contains no
 * withdraw redeemer and so says nothing about indexing an execution. Producing
 * a real one would mean submitting a withdrawal on preprod, which is a
 * live-chain mutation and out of scope.
 *
 * So the execution is proved on the ingest path with a transaction shaped the
 * way Koios reports one: a `reward`-purpose redeemer bound to the script hash
 * the manifest declares for a Withdraw entry. That is the shape the chain will
 * deliver the moment a withdrawal happens, and the live suite asserts
 * separately that any such redeemer present on chain has been indexed.
 */

const FIXTURE = new URL("./fixtures/manifest-sample.json", import.meta.url).pathname;
const manifest = loadManifest(FIXTURE);

/** The deployed manifest, which is the one that declares a non-placeholder
 * Withdraw entry with a reward address. */
const DEPLOYED = new URL(
  "./fixtures/manifest-deployed-preprod.json",
  import.meta.url,
).pathname;
const deployed = loadManifest(DEPLOYED);

const withdrawTarget = deployed.scanTargets.find((v) => v.purpose === "Withdraw")!;

const base = parseTxInfo(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/koios/tx-info-state-queue.json", import.meta.url),
      "utf8",
    ),
  ),
)[0];

/**
 * A transaction that executed a withdraw validator, as Koios reports one.
 *
 * A withdraw execution touches no validator address: it is recorded as a
 * withdrawal from the reward account and a redeemer whose purpose is `reward`.
 * Nothing else in the transaction names the script.
 */
const withdrawTx = {
  ...base,
  tx_hash: "c".repeat(64),
  block_hash: "c".repeat(64),
  withdrawals: [
    { amount: "0", stake_addr: withdrawTarget.rewardAddress },
  ],
  plutus_contracts: [
    {
      address: null,
      script_hash: withdrawTarget.scriptHash,
      bytecode: null,
      size: 5106,
      valid_contract: true,
      input: {
        redeemer: {
          purpose: "reward",
          fee: "180000",
          unit: { steps: "120000000", mem: "400000" },
          datum: { hash: null, value: {} },
        },
        datum: { hash: null, value: null },
      },
    },
  ],
} as unknown as typeof base;

let reachable = false;

beforeEach(async () => {
  try {
    await Promise.race([
      indexerPrisma.$queryRaw`SELECT 1;`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("probe timed out")), 3000),
      ),
    ]);
    reachable = true;
    await truncateL1();
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await truncateL1();
    await indexerPrisma.$disconnect();
  }
});

describe("withdraw execution", () => {
  it("declares a withdraw target with a reward account to scan", () => {
    // Without these the withdraw source has nothing to ask for, which is how
    // the purpose went unscanned while the manifest declared it.
    expect(withdrawTarget.entryName).toBe("phasMembershipWithdraw");
    expect(withdrawTarget.placeholder).toBe(false);
    expect(withdrawTarget.rewardAddress).toMatch(/^stake_test1/);
  });

  it("indexes the redeemer of a withdraw execution", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await ingestTxInfos(
      [withdrawTx],
      deployed.validators,
      deployed.deploymentId,
    );

    const redeemers = await indexerPrisma.l1Redeemer.findMany({
      where: { txHash: withdrawTx.tx_hash },
    });
    expect(redeemers.length).toBe(1);
    expect(redeemers[0]!.purpose).toBe("reward");
    expect(redeemers[0]!.scriptHash).toBe(withdrawTarget.scriptHash);
    expect(redeemers[0]!.validContract).toBe(true);
  });

  it("attributes the execution to the script the manifest declares", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await ingestTxInfos(
      [withdrawTx],
      deployed.validators,
      deployed.deploymentId,
    );

    const row = await indexerPrisma.l1Redeemer.findFirst({
      where: { purpose: "reward" },
    });
    expect(row).not.toBeNull();
    const target = deployed.entries.find((e) => e.scriptHash === row!.scriptHash);
    expect(target?.purpose).toBe("Withdraw");
  });

  it("records the transaction itself, which carries no validator address", async (ctx) => {
    ctx.skip(!reachable, "indexer Postgres unreachable on 5435");

    await ingestTxInfos(
      [withdrawTx],
      deployed.validators,
      deployed.deploymentId,
    );

    const tx = await indexerPrisma.l1Tx.findUnique({
      where: { txHash: withdrawTx.tx_hash },
    });
    expect(tx).not.toBeNull();
  });

  it("keeps the sample manifest and the deployed manifest distinct", () => {
    // Guards against a fixture swap silently making the case above vacuous.
    expect(manifest.deploymentId).not.toBe(deployed.deploymentId);
  });
});
