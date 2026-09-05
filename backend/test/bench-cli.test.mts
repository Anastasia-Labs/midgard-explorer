import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * The CLI as a program, not as a module.
 *
 * Every other bench test imports `runHarness` directly, so none of them loads
 * `bench/cli.mts` the way a person does. That gap hid a real break: the bench
 * modules import each other by the `.mjs` specifier TypeScript expects, which
 * `tsc` and Vitest resolve to the `.mts` on disk and Node's type stripping does
 * not. Typecheck passed, the smoke test passed, and `pnpm bench` had never once
 * run. These tests execute the entry point, so resolution is proven rather than
 * assumed.
 */
describe("the bench CLI as a program", () => {
  /** No env, so it must fail on its own check rather than on an import. */
  it("loads every module and reaches its argument validation", async () => {
    const env = { ...process.env };
    delete env.BENCH_POSTGRES_URL;
    delete env.BENCH_SOURCE_INDEX_URL;

    const failure = await run(
      "node",
      ["--import", "./bench/register.mjs", "bench/cli.mts", "--profile", "small"],
      { env, cwd: process.cwd() },
    ).catch((error: { stderr: string }) => error);

    const stderr = (failure as { stderr: string }).stderr;
    // The env error proves the whole import graph loaded. ERR_MODULE_NOT_FOUND
    // is the regression this test exists to catch.
    expect(stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(stderr).toMatch(/set BENCH_POSTGRES_URL and BENCH_SOURCE_INDEX_URL/);
  }, 60_000);

  it("rejects an unknown workload, so --only cannot silently measure nothing", async () => {
    // `docs/performance-budgets.md` names `pnpm bench --only <row>` for every
    // latency row. It previously named a `--workload` flag that never existed,
    // and the docs gate did not read that page at all.
    const failure = await run(
      "node",
      ["--import", "./bench/register.mjs", "bench/cli.mts", "--only", "no-such-row"],
      { env: process.env, cwd: process.cwd() },
    ).catch((error: { stderr: string }) => error);
    const stderr = (failure as { stderr: string }).stderr;
    expect(stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(stderr).toMatch(/unknown workload: no-such-row/);
  }, 60_000);

  it("accepts every workload the budgets document names", async () => {
    const { WORKLOADS } = await import("../bench/workloads.mjs");
    const doc = await readFile("../docs/performance-budgets.md", "utf8");
    const named = [...doc.matchAll(/`pnpm bench --only ([a-z0-9-]+)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      expect(WORKLOADS.some((w) => w.name === name), name).toBe(true);
    }
  });

  it("rejects an unknown profile through the real entry point", async () => {
    const failure = await run(
      "node",
      ["--import", "./bench/register.mjs", "bench/cli.mts", "--profile", "nonesuch"],
      { env: process.env, cwd: process.cwd() },
    ).catch((error: { stderr: string }) => error);

    const stderr = (failure as { stderr: string }).stderr;
    expect(stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(stderr).toMatch(/unknown profile: nonesuch/);
  }, 60_000);
});
