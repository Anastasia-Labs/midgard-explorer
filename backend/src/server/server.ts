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
import { indexerPrisma } from "../indexer/db";
import { startSync, type SyncHandle } from "../indexer/sync";
import { reportDatabaseIdentity } from "../db/identity";
import { mountRateLimits, startRateLimitSweeper } from "./rateLimit";
import { resolveCorsOrigin, securityHeaders } from "./security";

export const startServer = async () => {
  const app = express();
  const server = http.createServer(app);

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

  // Background L1 indexing. Deliberately after route registration: a sync
  // failure must never prevent the API from coming up.
  // Before the sync loop, so the log names its databases even if sync fails.
  void reportDatabaseIdentity();

  // One process indexes. Extra instances serve reads against the same index
  // with L1_SYNC_ENABLED=false, and say so rather than appearing to index.
  let sync: SyncHandle | null = null;
  if (config.L1_SYNC_ENABLED) {
    sync = startSync();
  } else {
    logger.info("L1 sync disabled by configuration; serving reads only");
  }

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

    // Stop scheduling immediately, then drain HTTP and the indexer at the same
    // time. `server.close` fires its callback only once every connection has
    // ended, so stopping the indexer inside it made a keep-alive client able to
    // hold the drain past the forced-exit timer below and have an active sync
    // killed mid-transaction. Idle sockets are closed rather than waited on for
    // the same reason.
    const indexerDrained = sync
      ? sync.stop().catch((err) => {
          logger.error(`Indexer did not drain cleanly: ${String(err)}`);
        })
      : Promise.resolve();

    const httpDrained = new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });

    void Promise.all([indexerDrained, httpDrained]).then(async () => {
      await prisma.$disconnect();
      await indexerPrisma.$disconnect();
      logger.info("Shutdown complete.");
      process.exit(0);
    });

    // Force-exit if either side does not drain in time.
    setTimeout(() => {
      logger.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};
