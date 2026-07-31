import { request } from "@playwright/test";

/** Proves the fixture the suite is about to test against is the fixture this
 * repository ships, and that it carries no injected faults.
 *
 * Outside CI `reuseExistingServer` adopts whatever already listens on the
 * fixture port. Two ways that goes wrong have both happened here: a previous
 * run interrupted while `fail=all` was injected leaves a server that fails
 * every request, and an unrelated process on the port answers enough to look
 * alive. Both produce a suite whose result depends on the machine rather than
 * on the code, which is worse than no suite. Fail here, loudly, instead. */
export default async function globalSetup() {
  const port = Number(process.env.FIXTURE_PORT ?? 3101);
  const base = `http://127.0.0.1:${port}`;
  const ctx = await request.newContext();

  try {
    const res = await ctx.get(`${base}/__control`);
    const body = res.ok() ? await res.json().catch(() => null) : null;
    if (body?.fixture !== "midgard-explorer-e2e") {
      throw new Error(
        `The process on ${base} is not the e2e fixture backend. ` +
          `Stop it, or run with FIXTURE_PORT set to a free port.`,
      );
    }
    await ctx.post(`${base}/__control?fail=&slow=0`);
  } finally {
    await ctx.dispose();
  }
}
