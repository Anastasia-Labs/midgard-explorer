import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

/**
 * Isolated benchmark and test databases.
 *
 * Two rules, both enforced rather than documented:
 *
 *   - a database this module creates or drops MUST end in `_bench`, so no code
 *     path here can address `midgard`, `midgard_explorer`, or anything else a
 *     person is using;
 *   - the live explorer index is never written to and never benchmarked
 *     against. `cloneIndex` reads it and writes a frozen copy, and the copy
 *     carries a checksum so a later baseline can name the exact data that
 *     produced it.
 *
 * The node schema comes from the checked-in fixture rather than the live node,
 * so this is deterministic and needs no running Midgard.
 * `schema-fixture-drift.test.mts` is what keeps the fixture honest.
 */

const SUFFIX = "_bench";
const FIXTURE = "test/fixtures/schema/midgard-node.sql";

/** Refuses anything that is not a throwaway. Called before every create/drop. */
export function assertThrowaway(name: string): void {
  if (!name.endsWith(SUFFIX)) {
    throw new Error(
      `refusing to operate on "${name}": benchmark databases must end in "${SUFFIX}"`,
    );
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`refusing to operate on "${name}": unsafe identifier`);
  }
}

function adminUrl(database = "postgres"): string {
  const base = process.env.POSTGRES_URL;
  if (!base) throw new Error("POSTGRES_URL is not set");
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(work: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function dropDatabase(name: string): Promise<void> {
  assertThrowaway(name);
  await withAdmin(async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await c.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
}

export async function createDatabase(name: string): Promise<void> {
  assertThrowaway(name);
  await dropDatabase(name);
  await withAdmin((c) => c.query(`CREATE DATABASE "${name}"`));
}

/**
 * Runs `work` against a fresh database carrying the node schema, then drops it.
 *
 * The drop runs in a `finally`, so a failing test leaves nothing behind. The
 * name includes a random suffix so parallel callers cannot collide.
 */
export async function withThrowawayNodeDb(
  work: (db: Client) => Promise<void>,
): Promise<void> {
  const name = `node_${Math.random().toString(36).slice(2, 10)}${SUFFIX}`;
  await createDatabase(name);
  const client = new Client({ connectionString: adminUrl(name) });
  try {
    await client.connect();
    await client.query(stripPsqlMeta(await readFile(FIXTURE, "utf8")));
    await work(client);
  } finally {
    await client.end().catch(() => {});
    await dropDatabase(name);
  }
}

/**
 * Removes psql client meta-commands such as `\restrict`.
 *
 * `pg_dump` emits them and `psql` consumes them, but they are not SQL: sending
 * one through a driver fails with a syntax error at the backslash. The fixture
 * is applied by both psql (in scripts) and by this driver (in tests), so it
 * keeps them and this strips them.
 */
export function stripPsqlMeta(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^\s*\\/.test(line))
    .join("\n");
}

export type Checksum = {
  /** Stable across runs for identical content; changes if any row changes. */
  digest: string;
  tables: Record<string, number>;
  rows: number;
};

/**
 * A content checksum over the tables named, ordered deterministically.
 *
 * Recorded beside every baseline so a measurement can be traced to the exact
 * data that produced it. A number whose dataset cannot be identified is not
 * reproducible, and a baseline that is not reproducible is an anecdote.
 */
export async function checksum(
  db: Client,
  tables: readonly string[],
): Promise<Checksum> {
  const hash = createHash("sha256");
  const counts: Record<string, number> = {};
  let rows = 0;
  for (const table of [...tables].sort()) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      throw new Error(`unsafe table name: ${table}`);
    }
    // md5 of the whole row, aggregated in a deterministic order. Cheap, and
    // sensitive to any column changing, which is what a checksum is for.
    const { rows: result } = await db.query<{ n: string; digest: string | null }>(
      `SELECT count(*)::text AS n,
              md5(string_agg(row_digest, '' ORDER BY row_digest)) AS digest
         FROM (SELECT md5(t.*::text) AS row_digest FROM "${table}" t) s`,
    );
    const n = Number(result[0]?.n ?? 0);
    counts[table] = n;
    rows += n;
    hash.update(`${table}:${n}:${result[0]?.digest ?? "empty"}\n`);
  }
  return { digest: hash.digest("hex"), tables: counts, rows };
}
