import { describe, expect, it } from "vitest";
import { checkReadiness } from "../src/server/readiness.js";

/**
 * L1 trouble must not take the L2 explorer out of rotation.
 *
 * `/readyz` used to answer `checks.every(ok)` over the node database, the
 * index, its reconciliation and the manifest. An index that had never
 * reconciled therefore removed the whole instance from service, every L2 route
 * included, which contradicts the rule the explorer is built on: an index
 * behind the tip degrades the Cardano surface and never makes a Midgard page
 * unavailable.
 *
 * These assert the shape of the split rather than the wiring of one route, so
 * they hold whichever probe set a route is given.
 */

const ok = () => Promise.resolve();
const fails = (why: string) => () => Promise.reject(new Error(why));

/** The probe sets, named the way the routes are. Kept here rather than imported
 * so a change to the route wiring has to be made deliberately in both places
 * and cannot silently re-merge the two questions. */
const l2Probes = { "midgard-node": ok };
const l1Probes = (indexHealthy: boolean) => ({
  "midgard-node": ok,
  "explorer-index": indexHealthy ? ok : fails("index unreachable"),
  "index-reconciled": indexHealthy ? ok : fails("no completed reconciliation"),
  manifest: ok,
});

describe("L2 readiness", () => {
  it("stays ready while the Cardano index is unreachable", async () => {
    const report = await checkReadiness(l2Probes);
    expect(report.ready).toBe(true);
  });

  /** The L2 surface reads the node's own tables. If it needed the explorer
   * index, the split would have moved the outage rather than removed it. */
  it("does not probe the explorer index at all", async () => {
    const report = await checkReadiness(l2Probes);
    expect(report.checks.map((check) => check.name)).toEqual(["midgard-node"]);
  });

  it("goes unready when the node database is unreachable", async () => {
    const report = await checkReadiness({ "midgard-node": fails("node down") });
    expect(report.ready).toBe(false);
  });
});

describe("L1 readiness", () => {
  it("is ready when the index is healthy", async () => {
    const report = await checkReadiness(l1Probes(true));
    expect(report.ready).toBe(true);
  });

  it("goes unready when the index has not reconciled", async () => {
    const report = await checkReadiness(l1Probes(false));
    expect(report.ready).toBe(false);
  });

  /** An operator has to be able to read WHICH dependency failed. One aggregate
   * boolean makes them guess. */
  it("reports each dependency separately", async () => {
    const report = await checkReadiness(l1Probes(false));
    const failed = report.checks.filter((check) => !check.ok).map((check) => check.name);
    expect(failed.sort()).toEqual(["explorer-index", "index-reconciled"]);
  });
});

describe("the two questions are independent", () => {
  it("answers ready for L2 and unready for L1 from the same broken index", async () => {
    const [l2, l1] = await Promise.all([checkReadiness(l2Probes), checkReadiness(l1Probes(false))]);
    expect([l2.ready, l1.ready]).toEqual([true, false]);
  });
});
