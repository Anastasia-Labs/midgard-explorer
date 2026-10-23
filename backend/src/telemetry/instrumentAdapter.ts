import type { PrismaPg } from "@prisma/adapter-pg";
import { classifyStatement, normalizeQuery } from "../db/statementClass";
import { dbStatementDuration } from "./metrics";
import { requestTally } from "./requestTally";

export type DatabaseLabel = "node" | "index";

type Adapter = Awaited<ReturnType<PrismaPg["connect"]>>;

/** Records one statement's duration, and counts it against the request if it
 * is route work. `BEGIN` and `COMMIT` never reach here: the adapter issues them
 * on its own connection object, not through the methods this wraps, which is
 * the same exclusion the statement budgets make. */
function record(database: DatabaseLabel, sql: string, started: number): void {
  const statementClass = classifyStatement(normalizeQuery(sql));
  dbStatementDuration.observe(
    { database, class: statementClass },
    (performance.now() - started) / 1_000,
  );
  if (statementClass === "route-query") {
    const tally = requestTally.getStore();
    if (tally) tally.routeStatements += 1;
  }
}

/**
 * The same object, with `queryRaw` and `executeRaw` timed.
 *
 * A proxy rather than a subclass, so every other method, and the adapter's own
 * private state, is the original's. Methods are bound to the target, not the
 * proxy, because the adapter classes keep private fields a proxy cannot read.
 */
function timed<T extends object>(target: T, database: DatabaseLabel): T {
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      if (property === "queryRaw" || property === "executeRaw") {
        return async (query: { sql: string }) => {
          const started = performance.now();
          try {
            return await value.call(object, query);
          } finally {
            record(database, query.sql, started);
          }
        };
      }
      if (property === "startTransaction") {
        // Statements inside an interactive transaction go through the
        // transaction object, so it is timed too.
        return async (...args: unknown[]) =>
          timed(await value.apply(object, args), database);
      }
      return value.bind(object);
    },
  });
}

/** A driver adapter factory whose connections time every statement. */
export function instrumentAdapter(factory: PrismaPg, database: DatabaseLabel): PrismaPg {
  return new Proxy(factory, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object);
      if (property === "connect" && typeof value === "function") {
        return async (): Promise<Adapter> => timed(await value.call(object), database);
      }
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}
