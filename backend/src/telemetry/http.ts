import type { RequestHandler } from "express";
import {
  UNMATCHED,
  httpRequestDuration,
  methodLabel,
  routeLabel,
  routeStatementsPerRequest,
  statusClass,
} from "./metrics";
import { requestTally, type RequestTally } from "./requestTally";

/**
 * Times every response and counts its route statements.
 *
 * Mounted before the rate limiter, so a refused request is still a request the
 * process answered. The route is read when the response finishes, because it is
 * only known once routing has matched.
 */
export const observeRequests: RequestHandler = (req, res, next) => {
  const started = performance.now();
  const tally: RequestTally = { routeStatements: 0 };
  res.on("finish", () => {
    const route = routeLabel(req);
    httpRequestDuration.observe(
      { route, method: methodLabel(req.method), status_class: statusClass(res.statusCode) },
      (performance.now() - started) / 1_000,
    );
    if (route !== UNMATCHED) {
      routeStatementsPerRequest.observe({ route }, tally.routeStatements);
    }
  });
  requestTally.run(tally, () => next());
};
