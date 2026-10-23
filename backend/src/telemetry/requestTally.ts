import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What one request has cost so far, carried through its async work.
 *
 * The database instrumentation runs far below the route handler, inside the
 * Prisma adapter, and has no request object to attach a count to. The request's
 * async context reaches it, including inside an interactive transaction.
 */
export type RequestTally = { routeStatements: number };

export const requestTally = new AsyncLocalStorage<RequestTally>();
