import { cpus, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { Client } from "pg";

/**
 * Everything a baseline needs in order to be comparable with a later one.
 *
 * A latency figure without its planner settings, core count and dataset
 * identity is not reproducible, and a measurement that cannot be reproduced is
 * an anecdote. `docs/dataset-profiles.md` requires each of these to be recorded
 * beside every dataset, so they are collected here rather than remembered.
 *
 * `freeDiskBytes` is included because of an actual failure: the machine hit
 * 100% and PostgreSQL then cannot spill temp files, so a `maxTempBytes` budget
 * errors rather than measures, and every timing describes a starved
 * filesystem instead of a query.
 */

export type EnvironmentReport = {
  postgresVersion: string;
  settings: Record<string, string>;
  cpuCount: number;
  cpuModel: string;
  totalMemoryBytes: number;
  freeDiskBytes: number;
  nodeVersion: string;
  gitCommit: string;
  /** True when the tree carries changes `gitCommit` does not describe. */
  gitDirty: boolean;
  /**
   * sha256 over the whole `dist` tree, paths sorted, or "unknown".
   *
   * The entry point alone said nothing about the modules it imports, which is
   * most of what actually ran.
   */
  buildHash: string;
  capturedAt: string;
};

/** Settings that change a plan, so a baseline is meaningless without them. */
const SETTINGS = [
  "shared_buffers",
  "work_mem",
  "effective_cache_size",
  "max_parallel_workers_per_gather",
  "random_page_cost",
  "track_io_timing",
  "block_size",
] as const;

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Uncommitted changes, including untracked files. */
function gitDirty(): boolean {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  } catch {
    // Unknown is not clean: a baseline may not be certified on a tree whose
    // state could not be read.
    return true;
  }
}

/**
 * The artifact the benchmark actually ran, named by content.
 *
 * Every file under `dist`, in sorted path order, so the digest covers the
 * imported modules rather than just the entry point. Timestamps are not used:
 * a stale artifact carried in from another checkout can be newer than every
 * source file here, so freshness is established by building, not by mtime.
 */
function buildHash(root = "dist"): string {
  try {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(root);
    if (files.length === 0) return "unknown";
    const digest = createHash("sha256");
    for (const file of files.sort()) {
      digest.update(file);
      digest.update(createHash("sha256").update(readFileSync(file)).digest());
    }
    return digest.digest("hex");
  } catch {
    return "unknown";
  }
}

function freeDisk(path = "."): number {
  try {
    const out = execFileSync("df", ["-kP", path], { encoding: "utf8" });
    const line = out.trim().split("\n").at(-1) ?? "";
    return Number(line.split(/\s+/)[3] ?? 0) * 1024;
  } catch {
    return -1;
  }
}

export async function captureEnvironment(db: Client): Promise<EnvironmentReport> {
  const version = await db.query<{ version: string }>(`SELECT version()`);
  const settings: Record<string, string> = {};
  for (const name of SETTINGS) {
    const { rows } = await db.query<{ setting: string; unit: string | null }>(
      `SELECT setting, unit FROM pg_settings WHERE name = $1`,
      [name],
    );
    if (rows[0]) {
      settings[name] = rows[0].unit
        ? `${rows[0].setting}${rows[0].unit}`
        : rows[0].setting;
    }
  }
  const cores = cpus();
  return {
    postgresVersion: version.rows[0]?.version ?? "unknown",
    settings,
    cpuCount: cores.length,
    cpuModel: cores[0]?.model ?? "unknown",
    totalMemoryBytes: totalmem(),
    freeDiskBytes: freeDisk(),
    nodeVersion: process.version,
    gitCommit: gitCommit(),
    gitDirty: gitDirty(),
    buildHash: buildHash(),
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Reasons this environment cannot produce a trustworthy baseline.
 *
 * Returned rather than thrown: the caller decides whether to refuse or to
 * record the run as degraded. What must not happen is a number published with
 * no note that the machine was starved when it was taken.
 */
export function environmentWarnings(report: EnvironmentReport): string[] {
  const warnings: string[] = [];
  if (report.freeDiskBytes >= 0 && report.freeDiskBytes < 2 * 1024 ** 3) {
    warnings.push(
      `only ${(report.freeDiskBytes / 1024 ** 3).toFixed(1)} GB free: PostgreSQL cannot reliably spill temp files, so temp-byte budgets error rather than measure`,
    );
  }
  // Not a warning any more: two cores is the accepted minimum supported runtime
  // profile, and scheduler pressure there is part of performance on it. The
  // report stamps `hardware` instead, so a number is qualified rather than
  // disclaimed.
  if (report.settings.track_io_timing !== "on") {
    warnings.push("track_io_timing is off, so shared-block figures carry no I/O cost");
  }
  return warnings;
}
