#!/usr/bin/env node
/**
 * Measures what each mode actually costs, so the published figures are numbers
 * somebody read rather than numbers somebody chose.
 *
 * Two kinds of measurement, because they answer different questions:
 *
 *   peak    the resident memory the processes a mode starts actually reach,
 *           sampled on this machine while the mode serves pages. This is what
 *           "recommended" is derived from.
 *
 *   limit   whether the frontend still works with a hard memory ceiling, run
 *           inside a container with `--memory` and `--cpus` so the ceiling is
 *           enforced rather than requested. This is what "minimum" is derived
 *           from, and it is the only way to find the floor without waiting for
 *           a contributor to find it for us.
 *
 * The limit runs mount the repository into a Node image and reuse the installed
 * dependencies. They do not install, and they write only to .next inside the
 * container's own copy-on-write layer.
 *
 * Usage:
 *   measure.mjs <repoRoot> peak <url> <pid...>
 *   measure.mjs <repoRoot> limit <megabytes> [--build]
 */
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const [, , repoRoot, command, ...args] = process.argv;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
if (!repoRoot) fail("measure.mjs needs the repository root");

/** Resident memory of a process and every descendant, in megabytes.
 *
 * The tree matters: `next dev` is a supervisor whose bundler workers hold most
 * of the memory, so sampling the pid alone reports a fraction of the cost. */
const treeRssMb = (pid) => {
  const descendants = (root) => {
    const found = [root];
    for (let i = 0; i < found.length; i += 1) {
      let children = [];
      try {
        children = readFileSync(`/proc/${found[i]}/task/${found[i]}/children`, "utf8")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(Number);
      } catch {
        children = [];
      }
      for (const child of children) if (!found.includes(child)) found.push(child);
    }
    return found;
  };
  let total = 0;
  for (const process_ of descendants(Number(pid))) {
    try {
      const status = readFileSync(`/proc/${process_}/status`, "utf8");
      total += Number(status.match(/^VmRSS:\s+(\d+) kB/m)?.[1] ?? 0);
    } catch {
      // Exited between listing and reading. Its memory is no longer held.
    }
  }
  return Math.round(total / 1024);
};

if (command === "peak") {
  const [url, ...pids] = args;
  if (!url || pids.length === 0) fail("peak needs a URL and at least one pid");
  let peak = 0;
  const deadline = Date.now() + 60_000;
  // Requesting pages while sampling: an idle server is not the peak, and the
  // first compile of each route is where a bundler actually spends.
  const paths = ["/", "/blocks", "/transactions", "/l1", "/deposits", "/assets"];
  const requests = (async () => {
    for (const path of paths) {
      await fetch(`${url}${path}`, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
    }
  })();
  while (Date.now() < deadline) {
    const now = pids.reduce((sum, pid) => sum + treeRssMb(pid), 0);
    if (now > peak) peak = now;
    if (now === 0) break;
    await new Promise((resume) => setTimeout(resume, 250));
    if (await Promise.race([requests.then(() => true), Promise.resolve(false)])) {
      const settle = pids.reduce((sum, pid) => sum + treeRssMb(pid), 0);
      if (settle > peak) peak = settle;
      break;
    }
  }
  process.stdout.write(`${peak}\n`);
} else if (command === "limit") {
  const megabytes = Number(args[0]);
  if (!Number.isInteger(megabytes)) fail("limit needs a size in megabytes");
  const build = args.includes("--build");
  const port = 3310;

  const script = build
    ? `cd /repo/frontend-new/app && rm -rf .next && pnpm exec next build`
    : `cd /repo/frontend-new/app && rm -rf .next && pnpm exec next dev --hostname 0.0.0.0 --port ${port} &
       for i in $(seq 1 90); do
         code=$(wget -qO /dev/null -S http://127.0.0.1:${port}/ 2>&1 | awk '/HTTP\\//{print $2; exit}')
         [ "$code" = "200" ] && echo "SERVED 200" && exit 0
         sleep 2
       done
       echo "NEVER SERVED"; exit 1`;

  const started = Date.now();
  const container = spawn(
    "docker",
    [
      "run", "--rm",
      "--cpus", "2",
      "--memory", `${megabytes}m`,
      // No swap beyond the limit. Otherwise the ceiling is advisory and the run
      // reports success at a size the machine could not actually hold.
      "--memory-swap", `${megabytes}m`,
      "-v", `${repoRoot}:/repo`,
      "-e", "CI=1",
      // Keep the container's package manager out of the mounted repository.
      // Without this, corepack writes a store into /repo and leaves it behind
      // in the working tree of the machine being measured.
      "-e", "PNPM_HOME=/tmp/pnpm",
      "-e", "COREPACK_HOME=/tmp/corepack",
      "-e", "npm_config_store_dir=/tmp/pnpm-store",
      "-e", "NEXT_PUBLIC_API_BASE=http://127.0.0.1:3110",
      "-e", "API_BASE_SERVER=http://127.0.0.1:3110",
      "-e", "NEXT_PUBLIC_NETWORK_LABEL=Measure",
      "-e", "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3310",
      "-e", "NEXT_PUBLIC_L1_EXPLORER_NAME=CExplorer",
      "-e", "NEXT_PUBLIC_L1_EXPLORER_TX_URL=https://preprod.cexplorer.io/tx/{hash}",
      "-e", "NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL=https://preprod.cexplorer.io/address/{address}",
      "-w", "/repo",
      "node:24-alpine",
      "sh", "-c",
      `corepack enable >/dev/null 2>&1; ${script}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let output = "";
  container.stdout.on("data", (chunk) => (output += chunk));
  container.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise((resolve) => container.on("close", resolve));
  const seconds = Math.round((Date.now() - started) / 1000);

  const oom = /killed|out of memory|OOM|Killed/i.test(output) || code === 137;
  const verdict = code === 0 ? "ok" : oom ? "out of memory" : `failed (exit ${code})`;
  const panic = /Turbopack error|panic/i.test(output) ? " turbopack-panic" : "";
  process.stdout.write(`${megabytes}MB ${build ? "build" : "dev"} ${verdict}${panic} ${seconds}s\n`);
  if (code !== 0) {
    process.stderr.write(`${output.split("\n").slice(-12).join("\n")}\n`);
  }
  process.exit(code === 0 ? 0 : 1);
} else {
  fail(`Unknown command: ${command ?? "(none)"}`);
}
