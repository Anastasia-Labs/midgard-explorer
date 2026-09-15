import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { outputExcerpt } from "./harness.mjs";

/** The Next app the explorer deploys. */
export const FRONTEND_APP = fileURLToPath(new URL("../../frontend-new/app/", import.meta.url));

/**
 * A production build of the frontend.
 *
 * `overview-aggregate` is a Next route that calls six backend routes, so what a
 * visitor waits for is decided in that process. `next dev` compiles on first
 * request and serves unminified code, and a number from it describes nothing
 * that is deployed. The browser API base is inlined at build time; the route
 * handlers read `API_BASE_SERVER` at request time, which `startFrontend` sets.
 */
export function buildFrontend(): { buildId: string; builtAt: string } {
  execFileSync("pnpm", ["build"], {
    cwd: FRONTEND_APP,
    stdio: "pipe",
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  });
  return {
    buildId: readFileSync(`${FRONTEND_APP}.next/BUILD_ID`, "utf8").trim(),
    builtAt: new Date().toISOString(),
  };
}

export type FrontendHandle = {
  base: string;
  exitCode: () => number | null;
  output: () => string;
  stop: () => Promise<void>;
};

/** `next start` against the backend under test, ready once `/api/health` answers. */
export async function startFrontend(backendBase: string, port: number): Promise<FrontendHandle> {
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: FRONTEND_APP,
      env: {
        ...process.env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        API_BASE_SERVER: backendBase,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  };

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`the frontend exited with ${child.exitCode}:\n${outputExcerpt(output)}`);
    }
    try {
      if ((await fetch(`${base}/api/health`)).status < 500) {
        return { base, exitCode: () => child.exitCode, output: () => outputExcerpt(output), stop };
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`the frontend never answered /api/health:\n${outputExcerpt(output)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
