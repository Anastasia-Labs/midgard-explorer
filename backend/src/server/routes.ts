import { Express } from "express";
import { getBlockRoute, getRecentBlocksRoute } from "./routes/block";
import { getAddressRoute } from "./routes/address";
import { getTransactionRoute } from "./routes/transaction";

export function registerRoutes(app: Express) {
  app.get("/api/block", getBlockRoute);
  app.get("/api/transcation", getTransactionRoute);
  app.get("/api/address", getAddressRoute);
  app.get("/api/block/recent", getRecentBlocksRoute);
}
