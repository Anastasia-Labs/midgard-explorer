import { request } from "@playwright/test";

/** Proves both servers the suite is about to test against are the ones this
 * repository builds, and that the fixture carries no injected faults.
 *
 * With `reuseExistingServer` enabled, Playwright adopts whatever already
 * listens. Three ways that has gone wrong here: a run interrupted while
 * `fail=all` was injected leaves a fixture that fails every request; a stale
 * production build of this app keeps answering on the port, so the suite tests
 * code that no longer exists; and a foreign service on port 3000 answered every
 * navigation with 500, reporting twelve failures that were not real.
 *
 * Each of those produces a result that depends on the machine rather than on
 * the code, which is worse than no suite. Fail here, loudly, instead. */
export default async function globalSetup() {
  const fixturePort = Number(process.env.FIXTURE_PORT ?? 3211);
  const appPort = Number(process.env.E2E_PORT ?? 3210);
  const fixtureBase = `http://127.0.0.1:${fixturePort}`;
  const appBase = `http://127.0.0.1:${appPort}`;
  const ctx = await request.newContext();

  try {
    const res = await ctx.get(`${fixtureBase}/__control`);
    const body = res.ok() ? await res.json().catch(() => null) : null;
    if (body?.fixture !== "midgard-explorer-e2e") {
      throw new Error(
        `The process on ${fixtureBase} is not the e2e fixture backend. ` +
          `Stop it, or run with FIXTURE_PORT set to a free port.`,
      );
    }
    await ctx.post(`${fixtureBase}/__control?fail=&slow=0`);

    /* The app's own identity, read from a route contract rather than from a
     * health verdict. `/api/health` answers `{ up: boolean }` whether or not
     * the backend behind it is reachable, so the shape identifies the
     * application while the value says nothing about whether it is well. A
     * foreign service on this port fails the shape check. */
    const health = await ctx.get(`${appBase}/api/health`).catch(() => null);
    const healthBody = health?.ok() ? await health.json().catch(() => null) : null;
    if (typeof healthBody?.up !== "boolean") {
      throw new Error(
        `The process on ${appBase} did not answer /api/health as this explorer. ` +
          `Received ${health ? health.status() : "no response"}. Stop whatever holds ` +
          `that port, or run with E2E_PORT set to a free one.`,
      );
    }
  } finally {
    await ctx.dispose();
  }
}
