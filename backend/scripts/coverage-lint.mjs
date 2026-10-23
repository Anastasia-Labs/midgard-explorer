#!/usr/bin/env node
/**
 * Coverage lint: schema -> manifest -> Markdown.
 *
 * The manifest (`docs/coverage-manifest.json`) is the source of truth. This
 * checks it against the checked-in schema fixture and against the generated
 * Markdown, and fails when any of the three drift apart.
 *
 * The schema source is the FIXTURE, not the live database, so the lint is
 * deterministic and runs without Docker. `test/schema-fixture-drift.test.mts`
 * is what keeps the fixture honest against the live node.
 *
 * Every check here corresponds to a defect that actually occurred while this
 * inventory was built. They are not hypothetical:
 *
 *   - a column with no record, because a hand-written candidate list omitted it;
 *   - a gap named in prose but not under its own table, because a name-only
 *     check cannot tell one table's `payload_sha256` from another's;
 *   - counts in prose that no longer match the manifest.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const FIXTURE = resolve(repo, "backend/test/fixtures/schema/midgard-node.sql");
const MANIFEST = resolve(repo, "docs/coverage-manifest.json");
const MARKDOWN = resolve(repo, "docs/coverage-scope.md");

const GAP = new Set(["not-read", "referenced-only"]);
const DECISIONS = new Set(["adopt", "defer", "exclude", "already-exposed"]);

/** `CREATE TABLE` bodies, so a column is only ever credited to its own table. */
function tableBodies(sql) {
  const blocks = new Map();
  const pattern =
    /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  for (const m of sql.matchAll(pattern)) blocks.set(m[1], m[2]);
  return blocks;
}

/** Markdown split by `### \`table\`` heading, so checks are table-qualified. */
function sections(md) {
  const out = new Map();
  for (const part of md.split(/\n(?=### )/)) {
    const m = part.split("\n")[0].match(/^### `([^`]+)`/);
    if (m) out.set(m[1], part);
  }
  return out;
}

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(detail ? `${name}\n    ${detail}` : name);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}`);
};

const [sql, manifestRaw, md] = await Promise.all([
  readFile(FIXTURE, "utf8"),
  readFile(MANIFEST, "utf8"),
  readFile(MARKDOWN, "utf8"),
]);

const manifest = JSON.parse(manifestRaw);
const records = manifest.columns;
const excluded = new Set(manifest.excluded_tables);
const bodies = tableBodies(sql);
const ids = records.map((r) => r.id);
const byId = new Map(records.map((r) => [r.id, r]));

// 1. Schema -> manifest, table-qualified.
// The fixture carries two DDL dialects: Prisma-style (`"tx_id" BYTEA NOT NULL`,
// quoted and upper-cased) and pg_dump-style (`tx_id bytea NOT NULL`). Both must
// parse, or the lint reports phantom records that are really parser misses.
// Any type token, including user-defined enums such as
// `public.tx_admission_status`. Whitelisting built-ins silently dropped
// every enum column and reported it as a phantom manifest record.
const TYPE = /^(?:"?public"?\.)?"?\w+"?(?:\s*\(|\s|$)/;
const schemaIds = [];
for (const [table, body] of bodies) {
  if (excluded.has(table)) continue;
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (!line || /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(line)) continue;
    const m = line.match(/^"?(\w+)"?\s+(.+)$/);
    if (m && TYPE.test(m[2])) schemaIds.push(`${table}.${m[1]}`);
  }
}
const schemaSet = new Set(schemaIds);
const unrecorded = [...schemaSet].filter((id) => !byId.has(id));
check(
  "every in-scope schema column has a manifest record",
  unrecorded.length === 0,
  unrecorded.slice(0, 8).join(", "),
);

// 2. No phantom records.
const phantom = ids.filter((id) => !schemaSet.has(id));
check("no manifest record without a schema column", phantom.length === 0, phantom.slice(0, 8).join(", "));

// 3. Ids unique.
check("manifest ids are unique", new Set(ids).size === ids.length, `${ids.length} records, ${new Set(ids).size} unique`);

// 4. Record shape.
const malformed = records
  .filter((r) => !r.status || !r.decision || !r.delivery || !r.evidence)
  .map((r) => r.id);
check("every record carries status, decision, delivery and evidence", malformed.length === 0, malformed.slice(0, 8).join(", "));

const badDecision = records.filter((r) => !DECISIONS.has(r.decision)).map((r) => r.id);
check("decisions come from the closed set", badDecision.length === 0, badDecision.slice(0, 8).join(", "));

const badStatus = records.filter((r) => !(r.status in manifest.legend)).map((r) => r.id);
check("statuses are declared in the legend", badStatus.length === 0, badStatus.slice(0, 8).join(", "));

// 5. Manifest -> Markdown, under the owning table's own section.
const secs = sections(md);
const undocumented = records
  .filter((r) => GAP.has(r.status))
  .filter((r) => {
    const sec = secs.get(r.table);
    return sec === undefined || !sec.includes(`<!-- ${r.id} -->`);
  })
  .map((r) => r.id);
check(
  "every gap appears under its own table, id-qualified",
  undocumented.length === 0,
  undocumented.slice(0, 8).join(", "),
);

// 6. Counts in prose match the manifest.
const counts = {};
for (const r of records) counts[r.status] = (counts[r.status] ?? 0) + 1;
for (const [status, n] of Object.entries(counts)) {
  check(`prose states ${status} = ${n}`, md.includes(`**${n}**`));
}
const adopted = records.filter((r) => GAP.has(r.status) && r.decision === "adopt").length;
check(`prose states adopted = ${adopted}`, md.includes(`**${adopted} adopted columns**`));

// 7. No superseded language.
for (const stale of ["108 SELECTED", "8 AMBIGUOUS", "all 82 adopted", "No route emits raw `tx` or `output` hex"]) {
  check(`no superseded claim: ${stale}`, !md.includes(stale));
}

console.log(`\n${failures.length === 0 ? "coverage lint passed" : `coverage lint FAILED (${failures.length})`}`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
