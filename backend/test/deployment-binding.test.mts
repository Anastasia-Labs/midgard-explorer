import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reachable as isReachable } from "./helpers/reachable.mjs";
import { indexerPrisma } from "../src/indexer/db.js";
import {
  bindEmptyIndex,
  checkBinding,
  mismatchMessage,
  readBinding,
} from "../src/indexer/binding.js";
import { loadManifest, type Manifest } from "../src/indexer/manifest.js";
import { truncateL1 } from "./helpers/truncate.mjs";

/**
 * One index, one deployment, enforced rather than assumed.
 *
 * Only `l1_event` ever carried a deployment column, so `l1_tx`, `l1_tx_io`,
 * `l1_redeemer`, `l1_tx_asset` and `l1_block_header` could not be filtered even
 * in principle. Pointing a second manifest at the same database merged two
 * deployments into five tables that cannot be separated again, and the
 * readiness suite permitted it on the stated grounds that the read path filters
 * predecessor rows out, which is true of one table and false of the other five.
 */

const manifest = loadManifest(new URL("./fixtures/manifest-sample.json", import.meta.url).pathname);

/** A different deployment, spelled out rather than mutated in place, so a test
 * cannot accidentally assert against the same object it bound. */
const otherDeployment = (over: Partial<Manifest> = {}): Manifest => ({
  ...manifest,
  deploymentId: "f".repeat(64),
  ...over,
});

let reachable = false;

beforeAll(async () => {
  reachable = await isReachable("index", "deployment binding");
  // Once for the file. Binding refuses a POPULATED index, so emptiness is part
  // of what these cases assert rather than incidental, and the first case would
  // otherwise inherit whatever an earlier file left in the shared test
  // database. Doing it per case instead deleted rows other files were still
  // using, which is the hazard `fileParallelism: false` exists to bound.
  // Both, and before the first case rather than after the last. `truncateL1`
  // deliberately leaves `index_binding` alone, so a run that ended badly could
  // leave a binding behind and the first case would read it as a mismatch
  // against an index that is otherwise empty.
  await indexerPrisma.indexBinding.deleteMany({});
  await truncateL1();
});

afterEach(async () => {
  if (reachable) await indexerPrisma.indexBinding.deleteMany({});
});

describe("binding an empty index", () => {
  it("claims it on the writer's first pass", async () => {
    if (!reachable) return;
    const result = await bindEmptyIndex(manifest, "midgard");
    expect(result.state).toBe("bound");
    const stored = await readBinding();
    expect(stored?.deploymentId).toBe(manifest.deploymentId);
    expect(stored?.network).toBe(manifest.network);
    expect(stored?.l2Database).toBe("midgard");
  });

  /** A new database that has not been claimed is not an error. Treating it as
   * one would mean no index could ever be built. */
  it("is idempotent for the same deployment", async () => {
    if (!reachable) return;
    await bindEmptyIndex(manifest, "midgard");
    const again = await bindEmptyIndex(manifest, "midgard");
    expect(again.state).toBe("bound");
    expect(await indexerPrisma.indexBinding.count()).toBe(1);
  });
});

describe("a manifest that disagrees with the binding", () => {
  it("refuses a different deployment id", async () => {
    if (!reachable) return;
    await bindEmptyIndex(manifest, "midgard");
    const result = await bindEmptyIndex(otherDeployment(), "midgard");
    expect(result.state).toBe("mismatch");
    if (result.state !== "mismatch") return;
    expect(result.reason).toContain("deployment");
  });

  it("refuses a different network", async () => {
    if (!reachable) return;
    await bindEmptyIndex(manifest, "midgard");
    const other = { ...manifest, network: "mainnet" as const };
    const result = await bindEmptyIndex(other, "midgard");
    expect(result.state).toBe("mismatch");
  });

  /** The database this process reads is part of the identity. The explorer once
   * read a phase-4 test database for weeks and presented it as the live chain,
   * and the cause was one line in a gitignored .env. */
  it("refuses a different L2 database", async () => {
    if (!reachable) return;
    await bindEmptyIndex(manifest, "midgard");
    const result = await bindEmptyIndex(manifest, "midgard_phase4");
    expect(result.state).toBe("mismatch");
    if (result.state !== "mismatch") return;
    expect(result.reason).toContain("midgard_phase4");
  });

  /** Never rebinds. An index holding one deployment's rows does not become
   * another's because a different manifest was pointed at it. */
  it("leaves the original binding in place", async () => {
    if (!reachable) return;
    await bindEmptyIndex(manifest, "midgard");
    await bindEmptyIndex(otherDeployment(), "midgard");
    const stored = await readBinding();
    expect(stored?.deploymentId).toBe(manifest.deploymentId);
    expect(await indexerPrisma.indexBinding.count()).toBe(1);
  });
});

describe("the refusal an operator reads", () => {
  /** A refusal that names only the problem becomes a reason to disable the
   * check. This one names both ways forward. */
  it("names rebuilding and repointing as the ways out", () => {
    const message = mismatchMessage("deployment a bound, manifest declares b");
    expect(message).toContain("rebuild");
    expect(message).toContain("point this process at that deployment's own index");
  });
});

describe("a readiness check never writes", () => {
  /** The defect this replaces: `probeDeploymentBinding` bound on first sight, so
   * whatever process was probed first claimed the database for the manifest it
   * happened to carry. A health check that mutates is not a health check. */
  it("leaves an unbound index unbound", async () => {
    if (!reachable) return;
    const before = await readBinding();
    expect(before).toBeNull();

    const result = await checkBinding(manifest, "midgard");
    expect(result.state).toBe("unbound");
    expect(await readBinding(), "checkBinding wrote a binding").toBeNull();
  });

  /** An empty index is a new database waiting for its first pass. Refusing it
   * would mean no index could ever be built. */
  it("reports an empty unbound index as empty", async () => {
    if (!reachable) return;
    const result = await checkBinding(manifest, "midgard");
    expect(result.state === "unbound" && result.indexIsEmpty).toBe(true);
  });
});

describe("a populated index is never adopted silently", () => {
  /** Rows already present were attributed by some earlier process, and nothing
   * in this configuration can prove they belong to the manifest now loaded. */
  it("refuses to bind an index that already holds rows", async () => {
    if (!reachable) return;
    await indexerPrisma.l1Tx.create({
      data: {
        txHash: "c0".repeat(32),
        blockHeight: 1,
        blockHash: "d0".repeat(32),
        slot: 1,
        epoch: 1,
        txTime: new Date(),
        fee: 0n,
        size: 0,
        totalOutput: 0n,
        blockIndex: 0,
        certDeposit: 0n,
      },
    });
    await indexerPrisma.l1Event.create({
      data: {
        txHash: "c0".repeat(32),
        validator: "stateQueue",
        eventType: "blockCommitment",
        outputIndex: 0,
        lovelace: 0n,
        deployment: "some-other-deployment",
      },
    });

    const result = await bindEmptyIndex(manifest, "midgard");
    expect(result.state).toBe("mismatch");
    expect(await readBinding(), "a populated index was bound anyway").toBeNull();

    await indexerPrisma.l1Event.deleteMany({});
    await indexerPrisma.l1Tx.deleteMany({});
  });
});
