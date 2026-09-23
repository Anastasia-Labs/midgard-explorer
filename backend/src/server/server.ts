import express, {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import { config } from "../config";
import { logger } from "../logger";
import { registerRoutes } from "./routes";
import http from "http";
import { bigintStringify } from "./helpers";
import { prisma } from "../db";
import { configureBenchBypass } from "./cache";
import { reportDatabaseIdentity } from "../db/identity";
import { mountRateLimits, startRateLimitSweeper } from "./rateLimit";
import { resolveCorsOrigin, securityHeaders } from "./security";
import { observeRequests } from "../telemetry/http";
import { startMetricsServer } from "../telemetry/server";

export const startServer = async () => {
  const app = express();
  const server = http.createServer(app);

  // Off unless a token is configured, which production does not set. See the
  // note in cache.ts: a bare header would let any client disable the caches
  // that keep `/api/metrics` and `/api/assets` from amplifying request rate.
  configureBenchBypass(config.BENCH_CACHE_BYPASS_TOKEN);
  if (config.BENCH_CACHE_BYPASS_TOKEN) {
    logger.warn(
      "benchmark cache bypass is ENABLED; this must not be set in production",
    );
  }

  app.use(observeRequests);
  app.use(securityHeaders);

  // Refuses at boot rather than serving with a wildcard: see security.ts.
  const corsOrigin = resolveCorsOrigin(
    config.CORS_ORIGIN,
    process.env.NODE_ENV ?? "development",
  );

  // CORS: read-only public API, GET only.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", corsOrigin);
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // Middleware to convert BigInt to string before sending JSON response
  app.use((req, res, next) => {
    const oldJson = res.json;

    res.json = (data: unknown) => {
      return oldJson.call(res, bigintStringify(data));
    };

    next();
  });

  // `/healthz` is in the endpoint catalogue with everything else, so it is
  // registered by `registerRoutes` below rather than declared here.
  mountRateLimits(app, {
    limit: config.API_RATE_LIMIT_MAX,
    windowMs: config.API_RATE_LIMIT_WINDOW_MS,
  });
  startRateLimitSweeper();

  registerRoutes(app);

  const metricsServer =
    config.METRICS_PORT === undefined
      ? null
      : startMetricsServer(config.METRICS_HOST, config.METRICS_PORT);

  // Which database this process actually connected to, said out loud at boot.
  // Deliberately after route registration: naming the source must never keep
  // the API from coming up.
  void reportDatabaseIdentity();

  // 404 for unmatched routes.
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // Global error handler — catches rejections forwarded by asyncHandler.
  const errorHandler: ErrorRequestHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    logger.error(err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({ error: "Internal server error." });
  };
  app.use(errorHandler);

  server.on("error", (err) => {
    logger.error(err);
    process.exit(1);
  });

  server.listen(config.BACKEND_PORT, () => {
    logger.info(`Backend running on port: ${config.BACKEND_PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down.`);

    // Idle sockets are closed rather than waited on: `server.close` fires its
    // callback only once every connection has ended, so a keep-alive client
    // could otherwise hold the drain past the forced-exit timer below.
    const httpDrained = new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    metricsServer?.close();

    void httpDrained.then(async () => {
      await prisma.$disconnect();
      logger.info("Shutdown complete.");
      process.exit(0);
    });

    // Force-exit if the drain does not finish in time.
    setTimeout(() => {
      logger.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};
