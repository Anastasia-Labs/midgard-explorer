import type { RequestHandler } from "express";
import { logger } from "../logger";
import { probeManifest } from "../server/probes";
import { readinessRoute } from "../server/readiness";
import { publicContext } from "./context";
import {
  getPublicBlock,
  getPublicBlocksPage,
  getPublicRecentBlocks,
  getPublicRecentTransactions,
  getPublicSearch,
  getPublicTotalBlocks,
  getPublicTotalTransactions,
  getPublicTransaction,
  getPublicTransactionsPage,
  unsupported,
} from "./routes";

/**
 * Can this process serve the public source?
 *
 * The archive's control object is readable, the manifest passes, and the
 * node answers for the same deployment the manifest names. Serving does not
 * consult this: with the node down, archived pages keep answering while this
 * reports not ready.
 */
const publicReadiness = readinessRoute(
  {
    archive: async () => {
      if (!(await publicContext().view.readable())) throw new Error("the archive has no control object");
    },
    manifest: probeManifest,
    "node-deployment": async () => {
      const { node, fingerprint } = publicContext();
      const { manifestId } = await node.protocolInfo();
      if (manifestId !== fingerprint) throw new Error("the node serves another deployment than the manifest names");
    },
  },
  { onFailure: (name, error) => logger.error(`Readiness probe failed for ${name}: ${String(error)}`) },
);

/** The replica handler serves this route unchanged: it reads no database. */
const SAME = "same" as const;

/**
 * The route-by-source table: what each catalogue route does in the public
 * source. Every route in the catalogue has an entry, and a test holds it to
 * that, so a new route cannot reach public mode undecided.
 */
export const PUBLIC_ROUTES: Record<string, RequestHandler | typeof SAME> = {
  "/healthz": SAME,
  "/readyz": publicReadiness,
  "/api/openapi.json": SAME,
  "/api/source": SAME,
  "/api/vitals": SAME,
  "/api/l1/validators": SAME,
  "/api/l1/validator": SAME,

  "/api/blocks/recent": getPublicRecentBlocks,
  "/api/blocks/total": getPublicTotalBlocks,
  "/api/blocks/:page": getPublicBlocksPage,
  "/api/block": getPublicBlock,
  "/api/transaction": getPublicTransaction,
  "/api/transactions/recent": getPublicRecentTransactions,
  "/api/transactions/total": getPublicTotalTransactions,
  "/api/transactions/:page": getPublicTransactionsPage,
  "/api/search": getPublicSearch,

  "/api/blocks/by-height/:height": unsupported("the archive holds no canonical heights"),
  "/api/address": unsupported("an address read from the node cannot yet say when its balance is incomplete"),
  "/api/metrics": unsupported("the archive holds no aggregates yet"),
  "/api/state-queue": unsupported("the state queue is read from the node's database"),
  "/api/assets": unsupported("asset holders need a ledger scan, which no public interface offers"),
  "/api/asset": unsupported("asset holders need a ledger scan, which no public interface offers"),
  "/api/deposits/:page": unsupported("the archive lists events per block, not across blocks, yet"),
  "/api/withdrawals/:page": unsupported("the archive lists events per block, not across blocks, yet"),
  "/api/forced-transactions/:page": unsupported("the archive lists events per block, not across blocks, yet"),
  "/api/l1/activity/summary": unsupported("Cardano activity is read from the node's journal"),
  "/api/l1/activity/:page": unsupported("Cardano activity is read from the node's journal"),
  "/api/l1/reference": unsupported("Cardano references are read from the node's journal"),
};

/** The handler a route uses in the public source. */
export function publicHandler(path: string, replica: RequestHandler): RequestHandler {
  const entry = PUBLIC_ROUTES[path];
  if (entry === undefined) throw new Error(`no public-source decision for ${path}`);
  if (entry === SAME) return replica;
  return async (req, res, next) =>
    publicContext().view.withSnapshot(() => entry(req, res, next));
}
