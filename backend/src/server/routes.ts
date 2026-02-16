import { Express } from "express";
import {
  getBlockRoute,
  getRecentBlocksRoute,
  getTotalBlocksRoute,
  getBlocksPageRoute,
} from "./routes/block";
import { getAddressRoute } from "./routes/address";
import {
  getTotalTransactionsRoute,
  getTransactionRoute,
  getRecentTransactionsRoute,
  getTransactionsPageRoute,
} from "./routes/transaction";

export function registerRoutes(app: Express) {
  app.get("/api/block", getBlockRoute);
  app.get("/api/transcation", getTransactionRoute);
  app.get("/api/address", getAddressRoute);
  app.get("/api/blocks/recent", getRecentBlocksRoute);
  app.get("/api/blocks/total", getTotalBlocksRoute);
  app.get("/api/blocks/:page", getBlocksPageRoute);
  app.get("/api/transactions/total", getTotalTransactionsRoute);
  app.get("/api/transactions/recent", getRecentTransactionsRoute);
  app.get("/api/transactions/:page", getTransactionsPageRoute);
}
