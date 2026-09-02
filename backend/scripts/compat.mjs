#!/usr/bin/env node
/**
 * The compatibility contract between this explorer and a Midgard node.
 *
 * A node whose schema has moved does not announce itself. It answers every
 * query the explorer sends until one touches a column that was renamed, and
 * that arrives as an intermittent bug in a page rather than as an incompatible
 * deployment. This turns it into a check that runs before anything starts.
 *
 * The fingerprint covers table and column NAMES for the relations the read path
 * queries, and deliberately not their types. Type spellings differ between the
 * SQL that creates a table and the catalogue that describes it afterwards
 * ("TEXT" against "text", "INTEGER" against "integer", every serial), so a
 * fingerprint over types would compare two vocabularies and report a difference
 * that is not one. Names are the same string in both, and a renamed or dropped
 * column is what actually breaks a query.
 *
 * The relation list is not restated here. It is NODE_TABLES in
 * backend/src/server/probes.ts, the list readiness already derives from every
 * FROM and JOIN in the read path.
 *
 * Usage:
 *   compat.mjs fingerprint --fixture              from the committed schema fixture
 *   compat.mjs fingerprint --database <url>       from a live node database
 *   compat.mjs check --database <url>             the pin, the fixture and a live node
 *   compat.mjs write --fixture                    regenerate the pinned fingerprint
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.argv[2];
const command = process.argv[3];
const args = process.argv.slice(4);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (!repoRoot) fail("compat.mjs needs the repository root");

const CONFIG_PATH = join(repoRoot, "config", "midgard-compatibility.json");
const FIXTURE_PATH = join(repoRoot, "backend", "test", "fixtures", "schema", "midgard-node.sql");

/** The relations the read path queries, read from readiness rather than listed
 * again. Two lists would be two answers to what this explorer needs. */
const nodeTables = () => {
  const source = readFileSync(
    join(repoRoot, "backend", "src", "server", "probes.ts"),
    "utf8",
  );
  const block = source.match(/export const NODE_TABLES = \[([\s\S]*?)\] as const;/);
  if (!block) fail("Could not read NODE_TABLES from backend/src/server/probes.ts");
  const tables = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  if (tables.length === 0) fail("NODE_TABLES parsed as empty, which cannot be right");
  return tables.sort();
};

/** Column names per table, parsed from the committed schema fixture.
 *
 * The fixture is generated from prisma/schema.prisma, so its shape is regular:
 * one CREATE TABLE per relation, one column per line, the name first and
 * quoted or bare. Constraint lines are skipped by name. */
const fromFixture = (tables) => {
  const sql = readFileSync(FIXTURE_PATH, "utf8");
  const columns = new Map();
  const pattern = /CREATE TABLE (?:(?:public|"public")\.)?"?([a-z_]+)"?\s*\(([\s\S]*?)\n\);/g;
  for (const [, table, body] of sql.matchAll(pattern)) {
    if (!tables.includes(table)) continue;
    const names = [];
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      if (line === "") continue;
      if (/^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK)\b/i.test(line)) continue;
      const name = line.match(/^"([^"]+)"|^([a-z_][a-z0-9_]*)/i);
      if (name) names.push(name[1] ?? name[2]);
    }
    columns.set(table, names.sort());
  }
  return columns;
};

/** The same, from a database that is actually running. */
const fromDatabase = async (tables, url) => {
  const require = createRequire(join(repoRoot, "backend", "package.json"));
  let pg;
  try {
    pg = require("pg");
  } catch {
    fail("The backend's PostgreSQL client is not installed. Run: cd backend && pnpm install");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [tables],
    );
    const columns = new Map();
    for (const row of rows) {
      if (!columns.has(row.table_name)) columns.set(row.table_name, []);
      columns.get(row.table_name).push(row.column_name);
    }
    for (const names of columns.values()) names.sort();
    return columns;
  } finally {
    await client.end();
  }
};

const digest = (columns, tables) => {
  const canonical = tables
    .map((table) => `${table}(${(columns.get(table) ?? ["<missing>"]).join(",")})`)
    .join(";");
  return {
    fingerprint: `sha256:${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`,
    canonical,
  };
};

const readConfig = () => {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    fail(`Could not read ${CONFIG_PATH}: ${error?.message ?? error}`);
  }
};

const urlArg = () => {
  const index = args.indexOf("--database");
  if (index === -1 || !args[index + 1]) fail("Pass --database <url>");
  return args[index + 1];
};

const tables = nodeTables();

switch (command) {
  case "fingerprint": {
    const columns = args.includes("--fixture")
      ? fromFixture(tables)
      : await fromDatabase(tables, urlArg());
    const { fingerprint } = digest(columns, tables);
    process.stdout.write(`${fingerprint}\n`);
    break;
  }
  case "write": {
    const columns = fromFixture(tables);
    const { fingerprint } = digest(columns, tables);
    const config = readConfig();
    config.nodeSchema.fingerprint = fingerprint;
    config.nodeSchema.relations = tables.length;
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    process.stdout.write(`${CONFIG_PATH} now pins ${fingerprint}\n`);
    break;
  }
  case "check": {
    const config = readConfig();
    const expected = config.nodeSchema?.fingerprint;
    const fixture = fromFixture(tables);
    const pinned = digest(fixture, tables).fingerprint;

    /* The pin is checked before the node is.
     *
     * Everything below compares a live database against the committed fixture,
     * so the fingerprint in config/midgard-compatibility.json was decorative:
     * it was read, printed on failure, and never used to decide anything. A pin
     * that no longer describes the fixture is a pin nobody regenerated, and the
     * next reader takes it as the schema this build was verified against. */
    if (expected !== pinned) {
      process.stderr.write(
        "stale pin: config/midgard-compatibility.json does not describe the committed fixture\n",
      );
      process.stderr.write(`  the fixture is ${pinned}\n`);
      process.stderr.write(`  the pin says  ${expected ?? "(nothing)"}\n`);
      process.stderr.write("  regenerate it with: pnpm compat write --fixture\n");
      process.exit(1);
    }

    const live = await fromDatabase(tables, urlArg());
    const { fingerprint } = digest(live, tables);

    /* Containment, not equality.
     *
     * The explorer reads the columns it names and no others, so a node holding
     * MORE than the fixture describes serves every query correctly: the first
     * run of this check found `address_history.created_at` on a live node and
     * not in the committed fixture, and nothing was wrong. A column the
     * explorer selects and the node does not have is the incompatibility, and
     * it is the one that produces a failing page rather than an error at
     * startup. Reporting extras as failures would make the check cry wolf on
     * every node that is one migration ahead. */
    const missing = [];
    const ahead = [];
    for (const table of tables) {
      const want = fixture.get(table) ?? [];
      const have = live.get(table);
      if (have === undefined) {
        missing.push(`${table} does not exist`);
        continue;
      }
      const gone = want.filter((column) => !have.includes(column));
      const extra = have.filter((column) => !want.includes(column));
      if (gone.length) missing.push(`${table} is missing ${gone.join(", ")}`);
      if (extra.length) ahead.push(`${table} also has ${extra.join(", ")}`);
    }

    if (missing.length > 0) {
      process.stderr.write(
        `incompatible: this node is missing ${missing.length} thing(s) the explorer reads\n`,
      );
      for (const line of missing.slice(0, 12)) process.stderr.write(`  ${line}\n`);
      process.stderr.write(`  this node is ${fingerprint}; this build expects ${expected}\n`);
      process.exit(1);
    }

    if (ahead.length > 0) {
      process.stdout.write(`compatible: this node is ahead of the pinned schema ${expected}\n`);
      for (const line of ahead.slice(0, 12)) process.stdout.write(`  ${line}\n`);
      process.stdout.write(`  nothing the explorer reads is absent\n`);
    } else {
      process.stdout.write(
        `compatible: this node matches the pinned schema ${expected} exactly\n`,
      );
    }
    break;
  }
  default:
    fail(`Unknown command: ${command ?? "(none)"}`);
}
