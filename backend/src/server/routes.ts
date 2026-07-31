import { Express } from "express";
import {
  getBlockRoute,
  getBlockByHeightRoute,
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
import { getDepositsPageRoute } from "./routes/deposits";
import { getWithdrawalsPageRoute } from "./routes/withdrawals";
import { getForcedTransactionsPageRoute } from "./routes/forcedTransactions";
import { getMetricsRoute } from "./routes/metrics";

export function registerRoutes(app: Express) {
  app.get("/api/metrics", getMetricsRoute);
  app.get("/api/block", getBlockRoute);
  app.get("/api/transaction", getTransactionRoute);
  app.get("/api/address", getAddressRoute);
  app.get("/api/blocks/by-height/:height", getBlockByHeightRoute);
  app.get("/api/blocks/recent", getRecentBlocksRoute);
  app.get("/api/blocks/total", getTotalBlocksRoute);
  app.get("/api/blocks/:page", getBlocksPageRoute);
  app.get("/api/transactions/total", getTotalTransactionsRoute);
  app.get("/api/transactions/recent", getRecentTransactionsRoute);
  app.get("/api/transactions/:page", getTransactionsPageRoute);
  app.get("/api/deposits/:page", getDepositsPageRoute);
  app.get("/api/withdrawals/:page", getWithdrawalsPageRoute);
  app.get("/api/forced-transactions/:page", getForcedTransactionsPageRoute);
}
