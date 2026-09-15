import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "@prometheus-io/client";

/**
 * The process's metrics, exported in the Prometheus text format.
 *
 * Every label is drawn from a closed set: a route TEMPLATE, never the path a
 * client sent, and a status class rather than a status code. A label that
 * carries a block hash or an address creates one series per value, and a
 * crawler walking the chain would grow this registry without limit.
 */
export const registry = new Registry();

// Resident memory, heap, event-loop lag and garbage collection. Peak resident
// memory is a budget the benchmark can only sample during a run; this is the
// same figure from the process that serves traffic.
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "explorer_http_request_duration_seconds",
  help: "Time to finish a response, by route template, method and status class.",
  labelNames: ["route", "method", "status_class"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const responseCache = new Counter({
  name: "explorer_response_cache_total",
  help: "Responses from the in-process response cache, by route template and result.",
  labelNames: ["route", "result"] as const,
  registers: [registry],
});

export const dbStatementDuration = new Histogram({
  name: "explorer_db_statement_duration_seconds",
  help: "Time for one database statement, by database and statement class.",
  labelNames: ["database", "class"] as const,
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 10],
  registers: [registry],
});

export const routeStatementsPerRequest = new Histogram({
  name: "explorer_route_statements_per_request",
  help: "Route statements one request issued, the count the statement budgets judge.",
  labelNames: ["route"] as const,
  buckets: [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32],
  registers: [registry],
});

export const indexerPassDuration = new Histogram({
  name: "explorer_indexer_pass_duration_seconds",
  help: "Time for one L1 sync pass, by outcome.",
  labelNames: ["outcome"] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120, 180, 300],
  registers: [registry],
});

/** Requests no route matched: a 404, or one refused before routing. */
export const UNMATCHED = "unmatched";

/** The matched route's template, or `UNMATCHED`. Never the requested path. */
export function routeLabel(req: {
  baseUrl?: string;
  route?: { path?: unknown };
}): string {
  const path = req.route?.path;
  return typeof path === "string" ? `${req.baseUrl ?? ""}${path}` : UNMATCHED;
}

const METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST"]);

/** The method, or `other` for anything this API does not serve. */
export function methodLabel(method: string): string {
  return METHODS.has(method) ? method : "other";
}

export function statusClass(status: number): string {
  return status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : "other";
}

/** Observes one sync pass, and rethrows what it threw. */
export async function timedPass<T>(pass: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let outcome = "failure";
  try {
    const result = await pass();
    outcome = "success";
    return result;
  } finally {
    indexerPassDuration.observe({ outcome }, (performance.now() - started) / 1_000);
  }
}
