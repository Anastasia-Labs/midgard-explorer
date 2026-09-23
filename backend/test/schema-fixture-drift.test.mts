import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * The checked-in node schema is the deterministic source for every seeded
 * dataset. When it drifts behind the live node, a generator written against it
 * cannot populate tables it does not know about, and the gap shows up as a
 * benchmark that measured a smaller system than the one we ship.
 *
 * The manifest is read rather than the Markdown: prose is generated FROM the
 * manifest, so parsing it back would test the generator, not the schema.
 */

type ManifestColumn = {
  id: string;
  table: string;
  column: string;
  type: string;
  status: string;
  decision: string;
};

const FIXTURE = "test/fixtures/schema/midgard-node.sql";
const MANIFEST = "../docs/coverage-manifest.json";

async function manifest(): Promise<{
  columns: ManifestColumn[];
  excluded_tables: string[];
}> {
  return JSON.parse(await readFile(MANIFEST, "utf8"));
}

describe("node schema fixture", () => {
  it("declares every table the coverage scope adopts", async () => {
    const { columns } = await manifest();
    const sql = await readFile(FIXTURE, "utf8");
    const adopted = new Set(
      columns.filter((c) => c.decision === "adopt").map((c) => c.table),
    );
    const missing = [...adopted].filter(
      (t) => !sql.includes(`public.${t}`) && !sql.includes(`"${t}"`),
    );
    expect(missing, `absent from ${FIXTURE}`).toEqual([]);
  });

  it("declares every column the coverage scope adopts", async () => {
    const { columns } = await manifest();
    const sql = await readFile(FIXTURE, "utf8");
    // Column presence is checked inside the owning CREATE TABLE block, so one
    // table's `payload_sha256` cannot satisfy another's.
    const blocks = new Map<string, string>();
    for (const m of sql.matchAll(
      /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/g,
    )) {
      blocks.set(m[1], m[2]);
    }
    const missing = columns
      .filter((c) => c.decision === "adopt")
      .filter((c) => {
        const body = blocks.get(c.table);
        return body === undefined || !new RegExp(`\\b${c.column}\\b`).test(body);
      })
      .map((c) => c.id);
    expect(missing, `absent from their CREATE TABLE in ${FIXTURE}`).toEqual([]);
  });

  it("does not carry tables the coverage scope excludes", async () => {
    const { excluded_tables } = await manifest();
    const sql = await readFile(FIXTURE, "utf8");
    // Excluded tables are operator internals and migration bookkeeping. Seeding
    // them would put node-operator state into a benchmark dataset.
    const present = excluded_tables.filter((t) => sql.includes(`public.${t}`));
    expect(present, "excluded tables should not be seeded").toEqual([]);
  });
});
