import http from "node:http";
import { logger } from "../logger";
import { registry } from "./metrics";

/**
 * The metrics endpoint, on its own listener.
 *
 * Not a route on the API. The edge proxy forwards every `/api/` path and a
 * public `/metrics` would publish the process's internals, so it is served on a
 * separate port the proxy never forwards, bound to loopback unless an operator
 * names a private address.
 */
export function startMetricsServer(host: string, port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    registry.metrics().then(
      (body) => res.writeHead(200, { "Content-Type": registry.contentType }).end(body),
      (error: unknown) => {
        logger.error(`Metrics collection failed: ${String(error)}`);
        res.writeHead(500).end();
      },
    );
  });
  server.on("error", (error) => {
    // A metrics port that cannot bind is a telemetry failure, not a reason to
    // stop serving the explorer.
    logger.error(`Metrics listener failed on ${host}:${port}: ${String(error)}`);
  });
  server.listen(port, host, () => {
    logger.info(`Metrics on http://${host}:${port}/metrics`);
  });
  return server;
}
