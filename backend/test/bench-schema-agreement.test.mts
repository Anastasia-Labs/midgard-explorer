import { describe, expect, it } from "vitest";
import { PROFILES } from "../bench/profiles.mjs";
import { generateDataset, LOAD_ORDER } from "../bench/generate.mjs";
import {
  readLengthRules,
  readSchemaColumns,
  readUniqueRules,
  readValueRules,
  requiredColumns,
} from "../bench/schemaColumns.mjs";

/**
 * The generator's rows against the real schema, without a database.
 *
 * A load failure names one column of one table and stops. This names every
 * disagreement at once, and runs in the ordinary suite rather than behind
 * `REQUIRE_DB`, so an invented column cannot reach a benchmark run.
 */

const schema = readSchemaColumns();
const dataset = generateDataset(PROFILES.small);

describe("generated rows against the node schema", () => {
  it("knows every table the loader will write to", () => {
    for (const table of LOAD_ORDER) {
      expect(schema.has(table), table).toBe(true);
    }
  });

  it("invents no column", () => {
    const invented: string[] = [];
    for (const table of LOAD_ORDER) {
      const known = new Set(schema.get(table)!.map((c) => c.name));
      for (const row of dataset.tables[table] ?? []) {
        for (const column of Object.keys(row)) {
          if (!known.has(column)) invented.push(`${table}.${column}`);
        }
      }
    }
    expect([...new Set(invented)]).toEqual([]);
  });

  it("supplies every column that has no default (I11)", () => {
    const missing: string[] = [];
    for (const table of LOAD_ORDER) {
      const rows = dataset.tables[table] ?? [];
      if (rows.length === 0) continue;
      const supplied = new Set(Object.keys(rows[0]));
      for (const column of requiredColumns(schema.get(table)!)) {
        // `SERIAL` columns carry a sequence default the parser cannot see in
        // the Prisma dialect, so a generated identity is not required input.
        if (column === "height") continue;
        if (!supplied.has(column)) missing.push(`${table}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("satisfies every octet_length constraint in the schema", () => {
    // The quiet class of defect: a 32-byte value in a 28-byte column is the
    // right type and the right shape, and is rejected on insert.
    const violations: string[] = [];
    for (const rule of readLengthRules()) {
      for (const row of dataset.tables[rule.table] ?? []) {
        const value = row[rule.column];
        if (!(value instanceof Buffer)) continue;
        const size = value.length;
        const ok =
          rule.operator === "=" ? size === rule.bytes
          : rule.operator === ">=" ? size >= rule.bytes
          : rule.operator === ">" ? size > rule.bytes
          : size <= rule.bytes;
        if (!ok) {
          violations.push(
            `${rule.table}.${rule.column} is ${size}, needs ${rule.operator} ${rule.bytes}`,
          );
        }
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  });

  it("uses only values the enumerated CHECK constraints permit", () => {
    // Two tables spell "validity" the same and mean different vocabularies:
    // forced transactions take `TxIsValid`, withdrawals take
    // `WithdrawalIsValid` and reject the other.
    const violations: string[] = [];
    for (const rule of readValueRules()) {
      const allowed = new Set(rule.allowed);
      for (const row of dataset.tables[rule.table] ?? []) {
        const value = row[rule.column];
        if (value === null || value === undefined) continue;
        if (typeof value === "string" && !allowed.has(value)) {
          violations.push(`${rule.table}.${rule.column} = ${value}`);
        }
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  });

  it("violates no unique key", () => {
    // A transaction paying one address twice produced two identical
    // `address_history` rows, and the table is unique on (tx_id, address).
    const violations: string[] = [];
    for (const rule of readUniqueRules()) {
      const rows = dataset.tables[rule.table] ?? [];
      if (rows.length === 0) continue;
      if (!rule.columns.every((c) => c in rows[0])) continue;
      const seen = new Set<string>();
      for (const row of rows) {
        const key = rule.columns
          .map((c) => {
            const v = row[c];
            return v instanceof Buffer ? v.toString("hex") : String(v);
          })
          .join("|");
        if (seen.has(key)) {
          violations.push(`${rule.table}(${rule.columns.join(", ")})`);
          break;
        }
        seen.add(key);
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  });

  it("fills every table the coverage scope adopts", () => {
    // An empty table is a silent coverage gap: the page renders, shows nothing,
    // and the budget passes.
    for (const table of LOAD_ORDER) {
      expect((dataset.tables[table] ?? []).length, table).toBeGreaterThan(0);
    }
  });
});
