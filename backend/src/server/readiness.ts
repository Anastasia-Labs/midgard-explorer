import type { RequestHandler } from "express";

/** One dependency the explorer cannot serve without. A probe resolves when the
 * dependency answered and rejects otherwise; nothing here inspects what it
 * returned. */
export type Probe = () => Promise<unknown>;

export type ReadinessCheck = {
  name: string;
  ok: boolean;
  latencyMs: number;
};

export type ReadinessReport = {
  ready: boolean;
  now: string;
  checks: ReadinessCheck[];
};

/** Long enough that a busy database still answers, short enough that a probe
 * cannot become the slow request it is meant to detect. */
const DEFAULT_TIMEOUT_MS = 3_000;

type Options = {
  timeoutMs?: number;
  /** How long an answer may be reused. A probe endpoint sits outside the /api
   * rate limit by design, so without this a flood opens two database round
   * trips per request and competes with real traffic for a small pool. One
   * second is far shorter than any probe interval. */
  cacheMs?: number;
  /** Where the driver's own message goes. It is kept out of the response
   * because a connection error commonly carries the host, the port and
   * sometimes the user of the database that failed. */
  onFailure?: (name: string, error: unknown) => void;
};

async function bounded(probe: Probe, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Keyed by the probe set, so one route's memory cannot answer another's. */
const remembered = new WeakMap<
  Record<string, Probe>,
  { at: number; report: ReadinessReport }
>();

/** Runs every probe, in parallel, and reports each one separately. A single
 * aggregate boolean makes an operator guess which dependency is down. */
export async function checkReadiness(
  probes: Record<string, Probe>,
  options: Options = {},
): Promise<ReadinessReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? 0;

  if (cacheMs > 0) {
    const last = remembered.get(probes);
    if (last && Date.now() - last.at < cacheMs) return last.report;
  }

  const checks = await Promise.all(
    Object.entries(probes).map(async ([name, probe]) => {
      const started = Date.now();
      try {
        await bounded(probe, timeoutMs);
        return { name, ok: true, latencyMs: Date.now() - started };
      } catch (error) {
        options.onFailure?.(name, error);
        return { name, ok: false, latencyMs: Date.now() - started };
      }
    }),
  );

  const report: ReadinessReport = {
    ready: checks.every((check) => check.ok),
    now: new Date().toISOString(),
    checks,
  };

  if (cacheMs > 0) remembered.set(probes, { at: Date.now(), report });

  return report;
}

/** Readiness is a separate question from liveness. `/healthz` says the process
 * is running, which is the only thing a restart decision may rest on. This
 * says the explorer can serve data, which is what removes an instance from
 * rotation. Answering both from one route means a database outage restarts
 * every process that depends on it. */
export function readinessRoute(
  probes: Record<string, Probe>,
  options: Options = {},
): RequestHandler {
  const withDefaults: Options = { cacheMs: 1_000, ...options };
  return async (_req, res) => {
    const report = await checkReadiness(probes, withDefaults);
    res.setHeader("Cache-Control", "no-store");
    res.status(report.ready ? 200 : 503).json(report);
  };
}
