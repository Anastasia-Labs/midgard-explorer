import express from "express";
import { config } from "../config";
import { logger } from "../logger";
import { registerRoutes } from "./routes";
import http from "http";
import { bigintStringify } from "./helpers";
import bodyParser from "body-parser";

export const startServer = async () => {
  try {
    const app = express();
    const server = http.createServer(app);

    app.use(express.json());
    app.use(bodyParser.json());

    // Middleware to convert BigInt to string before sending JSON response
    app.use((req, res, next) => {
      const oldJson = res.json;

      res.json = (data: any) => {
        return oldJson.call(res, bigintStringify(data));
      };

      next();
    });

    registerRoutes(app);

    server.listen(config.BACKEND_PORT, () => {
      logger.info(`Backend running on port: ${config.BACKEND_PORT}`);
    });
  } catch (err: any) {
    logger.error(err);
    process.exit(1);
  }
};
