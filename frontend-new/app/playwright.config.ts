import { defineConfig, devices } from "@playwright/test";

// Overridable so the harness can run against its own production build while a
// dev server holds the default port.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3101);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The fixture backend holds fault-injection state globally, so parallel
  // workers would clobber each other's injected failures. One worker keeps the
  // degraded-state tests deterministic; the suite still runs in ~3 minutes.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
    },
    {
      // Test what ships. The dev server injects an overlay and a build
      // indicator that shift layout, break axe runs, and change hydration
      // timing, so e2e results from `next dev` do not describe production.
      command: `pnpm build && pnpm start --port ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_BASE: `http://127.0.0.1:${FIXTURE_PORT}`,
        NEXT_PUBLIC_NETWORK_LABEL: "Fixture",
        NEXT_PUBLIC_L1_EXPLORER_URL: "https://preprod.cardanoscan.io",
      },
    },
  ],
});
