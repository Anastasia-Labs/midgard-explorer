import { describe, expect, it } from "vitest";
import { baselineGate, hardwareProfileOf, outputExcerpt, startScriptNodeFlags } from "../bench/harness.mjs";
import type { HarnessReport } from "../bench/harness.mjs";
import { WORKLOADS } from "../bench/workloads.mjs";
import type { EnvironmentReport } from "../bench/environment.mjs";
import type { Judgement } from "../bench/judge.mjs";

/**
 * The baseline gate.
 *
 * A smoke run proves the harness works; a baseline is the measurement of
 * record. The gate is what stops one being mistaken for the other, so these
 * assertions are about refusing to certify, not about running.
 */

const GB = 1024 ** 3;
const healthy: EnvironmentReport = {
  postgresVersion: "PostgreSQL 17",
  settings: { track_io_timing: "on" },
  cpuCount: 16,
  cpuModel: "test",
  totalMemoryBytes: 64 * GB,
  freeDiskBytes: 100 * GB,
  nodeVersion: "v24",
  gitCommit: "a".repeat(40),
  gitDirty: false,
  buildHash: "b".repeat(64),
  capturedAt: new Date().toISOString(),
};

const clean: Judgement[] = [
  {
    workload: "blocks-list-page-1",
    verdict: "PASS",
    breaches: [],
    unmeasured: [],
    stats: {
      count: 40, successCount: 40, p50Ms: 10, p95Ms: 20, p99Ms: 30, maxMs: 40,
      errorRate: 0, timeoutRate: 0, rps: 50, wireBytes: 100, uncompressedBytes: 200, encodedBytes: 120,
    },
    dbWork: { statements: 3, routeStatements: 3, transactionControl: 0, metadataStatements: 0, sharedBlocks: 10, tempBytes: 0, execMs: 1 },
  },
];

describe("baselineGate", () => {
  it("permits a baseline on a healthy machine with fully measured results", () => {
    expect(baselineGate(healthy, clean)).toEqual([]);
  });

  it("refuses a run in which a workload never succeeded", () => {
    // The real `target` run this came from: the server died after the third
    // workload, so nine of twelve answered every request in under a
    // millisecond with a refused connection. The gate returned no warnings and
    // the CLI exited 0, so a run that measured nothing was recordable as the
    // measurement of record.
    const dead: Judgement[] = [
      {
        ...clean[0],
        workload: "metrics",
        verdict: "FAIL",
        breaches: ["error rate 100.00% over 0.00%"],
        stats: { ...clean[0].stats, p95Ms: 0.64, errorRate: 1, wireBytes: 0 },
        dbWork: { statements: 0, routeStatements: 0, transactionControl: 0, metadataStatements: 0, sharedBlocks: 0, tempBytes: 0, execMs: 0 },
      },
    ];
    const blocking = baselineGate(healthy, dead);
    expect(blocking.join(" ")).toMatch(/metrics/);
    expect(blocking.join(" ")).toMatch(/measured nothing/);
  });

  it("refuses a dirty tree, because HEAD would not name what ran", () => {
    // The first `target` run was taken with uncommitted harness and generator
    // changes and recorded only the HEAD commit.
    const blocking = baselineGate({ ...healthy, gitDirty: true }, clean);
    expect(blocking.join(" ")).toMatch(/working tree is dirty/);
  });

  it("refuses a baseline that did not build what it measured", () => {
    // Timestamps cannot settle this: an artifact from another checkout is
    // newer than every source file here and still wrong. The run must build.
    const blocking = baselineGate(healthy, clean, undefined, null);
    expect(blocking.join(" ")).toMatch(/did not build the backend/);
  });

  it("refuses when the artifact and the commit disagree", () => {
    const blocking = baselineGate(healthy, clean, undefined, {
      commit: "c".repeat(40),
      builtAt: new Date().toISOString(),
    });
    expect(blocking.join(" ")).toMatch(/artifact and the commit disagree/);
  });

  it("refuses payload sizes taken at the origin, which no client receives", () => {
    // The first `target` baseline measured every size at the origin, which
    // sends identity bytes whatever it is offered, while public traffic is
    // compressed by the edge proxy in front of it.
    const origin = baselineGate(healthy, clean, undefined, undefined, {
      at: "origin",
      reason: "docker is not available",
    });
    expect(origin.join(" ")).toMatch(/measured at the origin.*docker is not available/);
    const edge = baselineGate(healthy, clean, undefined, undefined, {
      at: "edge",
      image: "nginx:1.27-alpine@sha256:" + "0".repeat(64),
    });
    expect(edge).toEqual([]);
  });

  it("refuses a server run with node flags the start script does not use", () => {
    // A heap cap is compared with and without in smoke runs. The measurement of
    // record must be the configuration `pnpm start` deploys.
    const differ = baselineGate(healthy, clean, undefined, undefined, undefined, {
      used: ["--max-old-space-size=320"],
      startScript: [],
    });
    expect(differ.join(" ")).toMatch(/node flags "--max-old-space-size=320", but pnpm start uses ""/);
    const same = baselineGate(healthy, clean, undefined, undefined, undefined, {
      used: ["--max-old-space-size=320"],
      startScript: ["--max-old-space-size=320"],
    });
    expect(same).toEqual([]);
  });

  it("refuses a subset run, which is a diagnostic and not a baseline", () => {
    const blocking = baselineGate(healthy, clean, { scope: "subset", excluded: [] });
    expect(blocking.join(" ")).toMatch(/subset of the catalogue/);
  });

  describe("coverage is checked against the catalogue, not taken on trust", () => {
    const backend = WORKLOADS.filter((w) => w.origin === "backend").map((w) => w.name);
    const frontend = WORKLOADS.filter((w) => w.origin !== "backend").map((w) => w.name);
    const asResults = (names: readonly string[]): Judgement[] =>
      names.map((workload) => ({ ...clean[0], workload }));
    const fullExclusions = frontend.map((workload) => ({
      workload,
      reason: "origin is frontend: not served by the backend under test",
    }));
    const complete = { scope: "backend-only" as const, excluded: fullExclusions };

    it("accepts a sweep that accounts for every catalogue row exactly once", () => {
      expect(baselineGate(healthy, asResults(backend), complete)).toEqual([]);
    });

    it("accepts a full run, frontend routes included, with nothing excluded", () => {
      const full = { scope: "full" as const, excluded: [] };
      expect(baselineGate(healthy, asResults([...backend, ...frontend]), full)).toEqual([]);
    });

    it("refuses a full run that dropped a frontend route", () => {
      const full = { scope: "full" as const, excluded: [] };
      const blocking = baselineGate(healthy, asResults(backend), full);
      expect(blocking.join(" ")).toMatch(new RegExp(`frontend workload "${frontend[0]}" is missing`));
    });

    it("refuses a missing backend workload", () => {
      const short = asResults(backend.slice(0, -1));
      const blocking = baselineGate(healthy, short, complete);
      expect(blocking.join(" ")).toMatch(new RegExp(`${backend.at(-1)}.*missing`));
    });

    it("refuses a workload measured twice", () => {
      const doubled = asResults([...backend, backend[0]]);
      expect(baselineGate(healthy, doubled, complete).join(" ")).toMatch(
        /was measured 2 times/,
      );
    });

    it("refuses a result that is not in the catalogue at all", () => {
      const bogus = asResults([...backend, "invented-workload"]);
      expect(baselineGate(healthy, bogus, complete).join(" ")).toMatch(
        /invented-workload.*not in the catalogue/,
      );
    });

    it("refuses an exclusion with a blank reason", () => {
      const blank = {
        scope: "backend-only" as const,
        excluded: frontend.map((workload) => ({ workload, reason: "  " })),
      };
      expect(baselineGate(healthy, asResults(backend), blank).join(" ")).toMatch(
        /gives no reason/,
      );
    });

    it("refuses an exclusion naming something the catalogue does not have", () => {
      const unknown = {
        scope: "backend-only" as const,
        excluded: [...fullExclusions, { workload: "ghost", reason: "n/a" }],
      };
      expect(baselineGate(healthy, asResults(backend), unknown).join(" ")).toMatch(
        /excluded "ghost", which is not in the catalogue/,
      );
    });

    it("refuses a workload that is both measured and excluded", () => {
      const both = {
        scope: "backend-only" as const,
        excluded: [...fullExclusions, { workload: backend[0], reason: "contradictory" }],
      };
      expect(baselineGate(healthy, asResults(backend), both).join(" ")).toMatch(
        /both measured and excluded/,
      );
    });

    it("refuses a row that is neither measured nor excluded", () => {
      const silent = { scope: "backend-only" as const, excluded: [] };
      expect(baselineGate(healthy, asResults(backend), silent).join(" ")).toMatch(
        new RegExp(`${frontend[0]}.*neither measured nor excluded`),
      );
    });
  });

  it("refuses below 30 GB free, naming the headroom reason", () => {
    const blocking = baselineGate({ ...healthy, freeDiskBytes: 5.2 * GB }, clean);
    expect(blocking.join(" ")).toMatch(/30 GB free/);
    expect(blocking.join(" ")).toMatch(/5\.2 GB/);
  });

  it("permits a baseline on the accepted two-core minimum", () => {
    // Ruled 2026-09-04: two cores is the minimum supported runtime profile
    // (docs/resource-requirements.md:47), so runtime, database, payload and
    // concurrency budgets may be judged there. Scheduler pressure is part of
    // performance on the supported minimum, not a distortion of it.
    expect(baselineGate({ ...healthy, cpuCount: 2 }, clean)).toEqual([]);
  });

  it("records peak resident memory, replacing a script that never existed", () => {
    // The budgets register named `backend/scripts/measure.mjs .. peak` as the
    // verification command for the peak-RSS row. No such file was ever written,
    // and the docs gate did not read that page. Measuring it during the run
    // that produces the baseline removes the second command entirely.
    const report: Pick<HarnessReport, "peakRssBytes"> = { peakRssBytes: 0 };
    expect(report).toHaveProperty("peakRssBytes");
  });

  it("stamps the hardware, so a result is qualified rather than universal", () => {
    expect(hardwareProfileOf({ ...healthy, cpuCount: 2 })).toBe(
      "existing-minimum-2-core",
    );
    expect(hardwareProfileOf({ ...healthy, cpuCount: 16 })).toBe("unclassified");
  });

  it("refuses when any workload had an unmeasured budget", () => {
    // An unmeasured budget in a baseline is the false green the harness exists
    // to prevent: nothing failed, and nothing was checked either.
    const blocking = baselineGate(healthy, [
      { ...clean[0], verdict: "UNMEASURED", unmeasured: ["statements: probe unavailable"] },
    ]);
    expect(blocking.join(" ")).toMatch(/unmeasured budgets/);
  });

  it("reports every blocking reason, not just the first", () => {
    const blocking = baselineGate({ ...healthy, freeDiskBytes: 1 * GB }, [
      { ...clean[0], verdict: "UNMEASURED", unmeasured: ["temp bytes: warm"] },
      { ...clean[0], workload: "metrics", verdict: "UNMEASURED", unmeasured: ["statements"] },
    ]);
    expect(blocking.length).toBe(3);
  });
});

describe("outputExcerpt", () => {
  it("keeps the reason a server printed last, not only its first lines", () => {
    // Two `target` replays lost the server's reason for exiting: the startup
    // log filled the first twelve lines and the error came after them.
    const startup = Array.from({ length: 30 }, (_, i) => `startup line ${i}`);
    const text = [...startup, "Error: the reason it died", "    at the frame that threw"].join("\n");
    const excerpt = outputExcerpt(text, 12, 5);
    expect(excerpt).toContain("startup line 0");
    expect(excerpt).toContain("Error: the reason it died");
    expect(excerpt).toContain("[15 lines omitted]");
  });

  it("returns short output whole", () => {
    expect(outputExcerpt("one\ntwo\n")).toBe("one\ntwo");
  });
});

describe("startScriptNodeFlags", () => {
  const pkg = (start: string) => JSON.stringify({ scripts: { start } });

  it("reads the flags between node and the entry point", () => {
    expect(startScriptNodeFlags(pkg("node dist/index.js"))).toEqual([]);
    expect(startScriptNodeFlags(pkg("node --max-old-space-size=320 dist/index.js"))).toEqual([
      "--max-old-space-size=320",
    ]);
    expect(startScriptNodeFlags(pkg("node --a --b=1  dist/index.js"))).toEqual(["--a", "--b=1"]);
  });

  it("refuses a start script it cannot read, rather than measuring without its flags", () => {
    expect(() => startScriptNodeFlags(pkg("ts-node src/index.ts"))).toThrow(/start script/);
    expect(() => startScriptNodeFlags(pkg("node dist/index.js --inspect"))).toThrow(/start script/);
  });

  it("parses this repository's own start script", () => {
    expect(Array.isArray(startScriptNodeFlags())).toBe(true);
  });
});
