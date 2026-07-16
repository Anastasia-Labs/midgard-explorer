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

export const startServer = async () => {
  const app = express();
  const server = http.createServer(app);

  // CORS: read-only public API, GET only. Origin configurable, defaults to "*".
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", config.CORS_ORIGIN);
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

    res.json = (data: any) => {
      return oldJson.call(res, bigintStringify(data));
    };

    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", now: new Date().toISOString() });
  });

  registerRoutes(app);

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
    server.close(async () => {
      await prisma.$disconnect();
      logger.info("Shutdown complete.");
      process.exit(0);
    });
    // Force-exit if connections don't drain in time.
    setTimeout(() => {
      logger.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};
