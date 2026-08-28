import { defineConfig, devices } from "@playwright/test";

/* Ports the suite owns, not ports the machine happens to use.
 *
 * 3000 and 3101 were the defaults, and both are exactly where a dev server, a
 * container, or another project also lands. A run on 2026-08-11 reported 12 of
 * 12 failures that were not real: port 3000 was held by a foreign service
 * answering 500, and `reuseExistingServer` adopted it. An earlier run adopted a
 * stale build of this app and tested code that no longer existed.
 *
 * These defaults are deliberately unusual, and reuse is now opt-in. */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3211);

/* One resolved value, published to everything that needs it.
 *
 * `helpers.ts` and the fixture server each fall back to 3101 when the variable
 * is unset, while this file falls back to 3211. Three defaults for one port
 * meant the suite only worked for someone who happened to have FIXTURE_PORT
 * exported: without it, Playwright waited on 3211 for a fixture that had
 * started on 3101 and failed with a webServer timeout. Writing the resolved
 * value back makes the config the single source, since Playwright loads it in
 * the runner and in every worker. */
process.env.FIXTURE_PORT = String(FIXTURE_PORT);
process.env.E2E_PORT = String(PORT);

/* Adopting a listening server is a convenience for someone who knows what is
 * on the port. It is never safe to assume, so it has to be asked for. */
const REUSE_SERVER = process.env.E2E_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  // Runs after the web servers are up: proves the fixture port belongs to this
  // repository's fixture and clears any fault left by an interrupted run.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  // The fixture backend holds fault-injection state globally, so parallel
  // workers would clobber each other's injected failures. One worker keeps the
  // degraded-state tests deterministic; the suite still runs in ~3 minutes.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A test that passes only on retry is a defect, not a pass. Retries stay on
  // so the report still shows what flaked and the trace is captured; this is
  // what makes the run red when one does, instead of leaving it to a reader.
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node e2e/fixtures/server.mjs",
      port: FIXTURE_PORT,
      reuseExistingServer: REUSE_SERVER,
      stdout: "ignore",
      // The fixture defaults to 3101 and this config waits on 3211, so without
      // passing the port through, `pnpm test:e2e` waits sixty seconds for a
      // server that started somewhere else and then reports a webServer
      // timeout. It only ever worked because the operator happened to have
      // FIXTURE_PORT exported.
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
    },
    {
      // Test what ships. The dev server injects an overlay and a build
      // indicator that shift layout, break axe runs, and change hydration
      // timing, so e2e results from `next dev` do not describe production.
      command: `pnpm build && pnpm start --port ${PORT}`,
      port: PORT,
      reuseExistingServer: REUSE_SERVER,
      // A production build on a two core box has exceeded 180s and reported
      // itself as a suite failure. The gate must fail on regressions, not on
      // the machine being small.
      timeout: 600_000,
      env: {
        NEXT_PUBLIC_API_BASE: `http://127.0.0.1:${FIXTURE_PORT}`,
        // `.env.local` may point server components at a developer backend.
        // Override both contexts so the browser suite cannot combine fixture
        // client requests with real/stale server-rendered data.
        API_BASE_SERVER: `http://127.0.0.1:${FIXTURE_PORT}`,
        NEXT_PUBLIC_NETWORK_LABEL: "Fixture",
        NEXT_PUBLIC_L1_EXPLORER_TX_URL: "https://preprod.cexplorer.io/tx/{hash}",
        NEXT_PUBLIC_L1_EXPLORER_ADDRESS_URL: "https://preprod.cexplorer.io/address/{address}",
        NEXT_PUBLIC_L1_EXPLORER_NAME: "CExplorer",
      },
    },
  ],
});
