import { readFileSync } from "node:fs";

/**
 * The node schema's columns, parsed from the checked-in fixture.
 *
 * Exists so a generator defect is caught without a database. Loading tells you
 * a row failed; this tells you which column the generator invented and which
 * required one it forgot, for every table at once.
 *
 * The fixture carries two DDL dialects, `CREATE TABLE public.x (` from
 * `pg_dump` and `CREATE TABLE "x" (` from the Prisma-era migrations, so both
 * are matched.
 */

const FIXTURE = "test/fixtures/schema/midgard-node.sql";

export type Column = {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
};

export type TableColumns = Map<string, Column[]>;

/** Any type token, including a user-defined enum such as `public.tx_admission_status`. */
const COLUMN = /^"?(\w+)"?\s+((?:"?public"?\.)?"?\w+"?.*)$/;

export function readSchemaColumns(path: string = FIXTURE): TableColumns {
  const sql = readFileSync(path, "utf8");
  const tables: TableColumns = new Map();
  const pattern = /CREATE TABLE (?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  for (const match of sql.matchAll(pattern)) {
    const [, table, body] = match;
    const columns: Column[] = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim().replace(/,$/, "");
      if (!line || line.startsWith("CONSTRAINT") || line.startsWith("--")) continue;
      const parsed = COLUMN.exec(line);
      if (!parsed) continue;
      const rest = parsed[2].toUpperCase();
      columns.push({
        name: parsed[1],
        notNull: rest.includes("NOT NULL"),
        hasDefault: rest.includes("DEFAULT"),
      });
    }
    tables.set(table, columns);
  }
  return tables;
}

export type LengthRule = {
  table: string;
  column: string;
  operator: "=" | ">=" | ">" | "<=";
  bytes: number;
};

/**
 * Every `octet_length` CHECK in the schema.
 *
 * These are the constraints a generator gets wrong quietly: a 32-byte value in
 * a 28-byte column is the right shape, the right type, and rejected. Reading
 * them out means the whole class is checked at once rather than one failed
 * insert at a time.
 */
export function readLengthRules(path: string = FIXTURE): LengthRule[] {
  const sql = readFileSync(path, "utf8");
  const rules: LengthRule[] = [];
  const pattern = /CREATE TABLE (?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  for (const match of sql.matchAll(pattern)) {
    const [, table, body] = match;
    for (const rule of body.matchAll(
      /octet_length\((\w+)\)\s*(=|>=|>|<=)\s*(\d+)/g,
    )) {
      rules.push({
        table,
        column: rule[1],
        operator: rule[2] as LengthRule["operator"],
        bytes: Number(rule[3]),
      });
    }
  }
  return rules;
}

export type ValueRule = { table: string; column: string; allowed: string[] };

/**
 * Every enumerated-value CHECK in the schema.
 *
 * Two tables use the word "validity" for different vocabularies:
 * `forced_transaction_utxos.operator_validity` accepts `TxIsValid`, while
 * `withdrawal_utxos.validity` accepts `WithdrawalIsValid` and rejects the
 * other. Reading the allowed sets out is how that stops being a guess.
 */
export function readValueRules(path: string = FIXTURE): ValueRule[] {
  const sql = readFileSync(path, "utf8");
  const rules: ValueRule[] = [];
  const pattern = /CREATE TABLE (?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  for (const match of sql.matchAll(pattern)) {
    const [, table, body] = match;
    for (const rule of body.matchAll(
      /CHECK \(\(?\(?(\w+) = ANY \(ARRAY\[([^\]]*)\]\)/g,
    )) {
      const allowed = [...rule[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      if (allowed.length > 0) {
        rules.push({ table, column: rule[1], allowed });
      }
    }
  }
  return rules;
}

export type UniqueRule = { table: string; columns: string[] };

/**
 * Unique keys: primary keys, UNIQUE constraints and unique indexes.
 *
 * Partial unique indexes carry a WHERE clause and are skipped, because whether
 * a row falls under the predicate cannot be decided from the column list alone.
 * `uniq_pending_block_finalizations_single_active` is one of those, and the
 * profile encodes it instead.
 */
export function readUniqueRules(path: string = FIXTURE): UniqueRule[] {
  const sql = readFileSync(path, "utf8");
  const rules: UniqueRule[] = [];
  const columns = (list: string) =>
    [...list.matchAll(/"?(\w+)"?/g)].map((m) => m[1]);

  for (const match of sql.matchAll(
    /CREATE TABLE (?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/g,
  )) {
    for (const key of match[2].matchAll(/(?:PRIMARY KEY|UNIQUE)\s*\(([^)]*)\)/g)) {
      rules.push({ table: match[1], columns: columns(key[1]) });
    }
  }
  for (const match of sql.matchAll(
    /ALTER TABLE ONLY (?:public\.)?"?(\w+)"?[\s\S]*?ADD CONSTRAINT \w+ (?:PRIMARY KEY|UNIQUE) \(([^)]*)\)/g,
  )) {
    rules.push({ table: match[1], columns: columns(match[2]) });
  }
  for (const match of sql.matchAll(
    /CREATE UNIQUE INDEX \w+ ON (?:public\.)?"?(\w+)"? USING btree \(([^)]*)\)(;| WHERE)/g,
  )) {
    if (match[3] !== ";") continue;
    const cols = columns(match[2]);
    if (cols.length > 0) rules.push({ table: match[1], columns: cols });
  }
  return rules;
}

/** Columns that must be supplied: NOT NULL with no default and not generated. */
export function requiredColumns(columns: readonly Column[]): string[] {
  return columns
    .filter((c) => c.notNull && !c.hasDefault)
    .map((c) => c.name);
}
