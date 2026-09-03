/**
 * Generates the seeded L2 records the continuous-integration job renders.
 *
 * The node schema fixture creates tables and holds no rows, so a job run
 * against it proves that a mode starts and nothing about whether a page shows
 * anything. That is the failure this repository has already had once: readiness
 * reported ready against an empty PostgreSQL because `SELECT 1` succeeded.
 *
 * Every row here is derived, not invented:
 *
 *   transactions   the six canonical transactions in shape-corpus.json, built
 *                  on a Lucid emulator and encoded with the vendored codec
 *   ids            computeMidgardNativeTxId over the decoded transaction
 *   outputs        the outputs preimage the codec reads back out of them
 *   addresses      decoded from those outputs
 *
 * So the seed cannot describe a transaction the decoder would reject: it is the
 * decoder's own reading of transactions the encoder produced. What it is not is
 * evidence about a live node. It shows the read path renders well-formed
 * records, and nothing about what any deployment contains.
 *
 * Determinism: no clock, no randomness. Timestamps are fixed, heights count
 * from one, and header hashes are sha256 over the height. Re-running must
 * produce a byte-identical file, which is what the regeneration check asserts.
 *
 * Run from backend/: node scripts/generate-l2-seed.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeMidgardNativeTxId,
  decodeMidgardNativeTxFullFromCanonicalCbor,
  decodeMidgardNativeByteListPreimage,
  decodeMidgardTxOutput,
  encodeMidgardAddressText,
  encodeCbor,
} from "@al-ft/midgard-core";

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, "..", "test", "fixtures", "shape-corpus.json");
const OUT = join(here, "..", "test", "fixtures", "schema", "midgard-node-seed.sql");

/** Fixed, so the file does not change because the day did. */
const EPOCH = Date.parse("2026-01-01T00:00:00.000Z");
const stamp = (n) => new Date(EPOCH + n * 20_000).toISOString().replace("T", " ").replace("Z", "");
const hex = (buffer) => Buffer.from(buffer).toString("hex");
/* `decode(..., 'hex')` rather than a `'\x...'::bytea` literal. The literal
 * carries a backslash, which psql reads as the start of a meta-command when the
 * file is piped to it, and the whole seed fails on the first insert. This form
 * has no backslash and means the same thing to every client. */
const bytea = (buffer) => `decode('${hex(buffer)}', 'hex')`;
const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;

/* Columns are read out of the schema fixture rather than listed here.
 *
 * `pending_block_finalizations` alone has fourteen NOT NULL columns, most of
 * which the explorer never reads. Hand-listing them would mean this generator
 * silently stops matching the schema the moment one is added, which is the
 * drift the fixture exists to prevent. Anything not given a meaningful value
 * gets a deterministic placeholder of the right type, so the row is insertable
 * and obviously not a measurement of anything. */
const SCHEMA = join(here, "..", "test", "fixtures", "schema", "midgard-node.sql");

const columnsOf = (table) => {
  const sql = readFileSync(SCHEMA, "utf8");
  const pattern = new RegExp(
    `CREATE TABLE (?:(?:public|"public")\\.)?"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\);`,
  );
  const body = sql.match(pattern)?.[1];
  if (!body) throw new Error(`no CREATE TABLE for ${table} in the schema fixture`);
  const columns = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim().replace(/,$/, "");
    if (line === "" || /^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK)\b/i.test(line)) continue;
    const match = line.match(/^"?([a-z_][a-z0-9_]*)"?\s+([^\s]+(?:\([^)]*\))?(?:\s+with\s+time\s+zone)?)/i);
    if (!match) continue;
    columns.push({
      name: match[1],
      type: match[2].toLowerCase(),
      notNull: /NOT NULL/i.test(line),
      hasDefault: /DEFAULT/i.test(line),
    });
  }
  return columns;
};

/* The shape each column's own CHECK constraint demands.
 *
 * These tables constrain their Merkle roots to 64 lowercase hex characters and
 * their hashes to an exact byte length. A placeholder chosen by SQL type alone
 * satisfies the type and fails the constraint, so the shapes are read from the
 * constraints rather than guessed. */
const constraintsOf = (table) => {
  const sql = readFileSync(SCHEMA, "utf8");
  const pattern = new RegExp(
    `CREATE TABLE (?:(?:public|"public")\\.)?"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\);`,
  );
  const body = sql.match(pattern)?.[1] ?? "";
  const hexLength = new Map();
  const byteLength = new Map();
  for (const [, column, length] of body.matchAll(
    /CHECK \(\((\w+) ~ '\^\[0-9a-f\]\{(\d+)\}\$'::text\)\)/g,
  )) {
    hexLength.set(column, Number(length));
  }
  for (const [, column, length] of body.matchAll(
    /CHECK \(\(octet_length\((\w+)\) = (\d+)\)\)/g,
  )) {
    byteLength.set(column, Number(length));
  }
  return { hexLength, byteLength };
};

/** A deterministic value of the right type and shape for a column nothing
 * meaningful fills. Never random, never clock-derived: the hex is a digest of
 * the column name, so the same schema always produces the same file. */
const placeholder = (column, shapes) => {
  const hex = shapes.hexLength.get(column.name);
  if (hex !== undefined) {
    return `'${createHash("sha256").update(`seed:${column.name}`).digest("hex").slice(0, hex)}'`;
  }
  const bytes = shapes.byteLength.get(column.name);
  if (column.type.startsWith("bytea")) {
    const size = bytes ?? 28;
    return `decode('${createHash("sha256").update(`seed:${column.name}`).digest("hex").slice(0, size * 2)}', 'hex')`;
  }
  if (/int|serial|numeric|decimal/.test(column.type)) return "0";
  if (/bool/.test(column.type)) return "false";
  if (/timestamp|date/.test(column.type)) return `'${stamp(0)}'`;
  if (/json/.test(column.type)) return `'{}'`;
  return `'seed'`;
};

/** An INSERT covering every column the table requires. */
const insert = (table, given) => {
  const values = new Map(Object.entries(given));
  const shapes = constraintsOf(table);
  for (const column of columnsOf(table)) {
    if (values.has(column.name)) continue;
    if (!column.notNull || column.hasDefault) continue;
    values.set(column.name, placeholder(column, shapes));
  }
  const names = [...values.keys()];
  return `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names
    .map((n) => values.get(n))
    .join(", ")});`;
};

const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
const entries = Object.entries(corpus.entries).sort(([a], [b]) => a.localeCompare(b));

const transactions = entries.map(([key, entry], position) => {
  const bytes = Buffer.from(entry.canonicalTxHex, "hex");
  const full = decodeMidgardNativeTxFullFromCanonicalCbor(bytes);
  // The id is computed over the decoded transaction, which is what
  // src/decode/transaction.ts does. Handing it raw bytes throws.
  const txId = Buffer.from(computeMidgardNativeTxId(full));
  // The preimage is one buffer holding every output, not an array of them.
  // src/decode/transaction.ts splits it the same way.
  const items = decodeMidgardNativeByteListPreimage(full.body.outputsPreimageCbor);
  const outputs = items.map((output, index) => {
    const decoded = decodeMidgardTxOutput(Buffer.from(output));
    /* The codec returns the address as raw bytes; the node's own
     * `confirmed_ledger.address` column is text. Writing the bytes into a text
     * column produces a value no address query can match, and control
     * characters in the middle of a SQL string besides. */
    const address = encodeMidgardAddressText(Buffer.from(decoded.address));
    return {
      index,
      output: Buffer.from(output),
      outref: Buffer.from(encodeCbor([txId, index])),
      address,
    };
  });
  return { key, label: entry.label, position, bytes, txId, outputs };
});

/* One block per transaction, plus two empty ones, so the blocks list has rows
 * that are not all the same shape and pagination has something to page. */
const blocks = transactions.map((tx, i) => ({
  height: i + 1,
  headerHash: createHash("sha256").update(`midgard-seed-block-${i + 1}`).digest().subarray(0, 28),
  txId: tx.txId,
  at: stamp(i),
}));

/**
 * One block both sides of the explorer know about.
 *
 * Every header above is a synthetic hash, and the L1 ingest fixture describes a
 * real preprod commit transaction. The two therefore had no block in common, so
 * a cross-source test running against this seed compared an empty node against
 * a populated index and passed by comparing nothing.
 *
 * These are the real values from `fixtures/koios/tx-info-state-queue.json`: the
 * header that transaction committed, and the transaction that committed it. The
 * node claims to have settled it here; the indexer observes the same block from
 * the Koios fixture; the cross-source suite has something to disagree about.
 */
blocks.push({
  height: blocks.length + 1,
  headerHash: Buffer.from("003ab288f3168c80eb09f5843844dc19a506e0177947d2ca22d9ca68", "hex"),
  txId: Buffer.from(
    "9152dc88611dc2a23c723689e5cca8efc34719c6567cc1f95d40eadb534ddf92",
    "hex",
  ),
  at: stamp(blocks.length),
});

const lines = [
  "-- Generated by backend/scripts/generate-l2-seed.mjs. Do not edit by hand.",
  "--",
  "-- Deterministic L2 records for a database created from midgard-node.sql.",
  "-- Every transaction is one of the canonical transactions in",
  "-- shape-corpus.json, and every id, output and address is read back out",
  "-- of those bytes by the vendored codec.",
  "--",
  "-- This is not evidence about a live node. It shows the read path renders",
  "-- well-formed records.",
  "",
  "BEGIN;",
  "",
  "TRUNCATE blocks, immutable, confirmed_ledger, address_history, mempool, mempool_ledger,",
  "  pending_block_finalizations, pending_block_finalization_txs, da_payloads CASCADE;",
  "",
];

lines.push("-- Committed transactions, canonical Midgard-native CBOR.");
for (const tx of transactions) {
  lines.push(
    `INSERT INTO immutable (tx_id, tx, time_stamp_tz) VALUES (${bytea(tx.txId)}, ${bytea(tx.bytes)}, '${stamp(tx.position)}');`,
  );
}
lines.push("");

lines.push("-- Blocks, one per transaction.");
for (const block of blocks) {
  lines.push(
    `INSERT INTO blocks (height, header_hash, tx_id, time_stamp_tz) VALUES (${block.height}, ${bytea(block.headerHash)}, ${bytea(block.txId)}, '${block.at}');`,
  );
}
lines.push(
  "SELECT setval(pg_get_serial_sequence('blocks', 'height'), (SELECT max(height) FROM blocks));",
  "",
);

lines.push("-- The ledger those transactions produced, and who each output pays.");
for (const tx of transactions) {
  for (const output of tx.outputs) {
    lines.push(
      `INSERT INTO confirmed_ledger (tx_id, outref, output, address, time_stamp_tz) VALUES (${bytea(tx.txId)}, ${bytea(output.outref)}, ${bytea(output.output)}, ${quote(output.address)}, '${stamp(tx.position)}');`,
    );
  }
}
lines.push("");

lines.push(
  "-- The block list and totals are driven by pending_block_finalizations and",
  "-- da_payloads, not by the blocks table, so seeding blocks alone renders an",
  "-- empty explorer against a database that plainly holds rows.",
);
for (const block of blocks) {
  lines.push(
    insert("pending_block_finalizations", {
      header_hash: bytea(block.headerHash),
      block_end_time: `'${block.at}'`,
      // The status column accepts a fixed vocabulary. `finalized` is the
      // state a committed block reaches, which is what these rows describe.
      status: `'finalized'`,
      submitted_tx_hash: bytea(block.txId),
    }),
  );
}
lines.push("");

lines.push("-- Which transaction each block finalized.");
for (const [i, tx] of transactions.entries()) {
  const block = blocks[i];
  lines.push(
    insert("pending_block_finalization_txs", {
      header_hash: bytea(block.headerHash),
      member_id: bytea(tx.txId),
      ordinal: String(i),
      payload_cbor: bytea(tx.bytes),
      payload_sha256: bytea(createHash("sha256").update(tx.bytes).digest()),
      source_table: `'immutable'`,
      source_id: bytea(tx.txId),
      source_time_stamp_tz: `'${block.at}'`,
    }),
  );
}
lines.push("");

lines.push("-- The data-availability payload each block published.");
// The anchor block carries no L2 transaction, which is the common case on the
// live chain: seven of its nine settled blocks are empty. Only blocks that
// actually carry one get a payload.
for (const [i, block] of blocks.entries()) {
  if (transactions[i] === undefined) continue;
  lines.push(
    insert("da_payloads", {
      header_hash: bytea(block.headerHash),
      // The table accepts version 2 only.
      version: "2",
      payload_cbor: bytea(transactions[i].bytes),
      payload_sha256: bytea(createHash("sha256").update(transactions[i].bytes).digest()),
      // The counts satisfy the table's own arithmetic constraints: the total is
      // the sum of the four kinds, and one transition step is recorded per
      // event. One L2 transaction per block, which is what these rows describe.
      withdrawal_count: "0",
      forced_transaction_count: "0",
      deposit_count: "0",
      l2_transaction_count: "1",
      total_event_count: "1",
      transition_step_count: "1",
      block_start_time: `'${block.at}'`,
      block_end_time: `'${block.at}'`,
    }),
  );
}
lines.push("");

lines.push("-- Address history, so an address page has transactions to list.");
const seen = new Set();
for (const tx of transactions) {
  for (const output of tx.outputs) {
    const key = `${hex(tx.txId)}:${output.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `INSERT INTO address_history (tx_id, address) VALUES (${bytea(tx.txId)}, ${quote(output.address)});`,
    );
  }
}
lines.push("", "COMMIT;", "");

writeFileSync(OUT, lines.join("\n"));

const addresses = new Set(transactions.flatMap((tx) => tx.outputs.map((o) => o.address)));
process.stdout.write(
  `${OUT}\n  ${transactions.length} transactions, ${blocks.length} blocks, ` +
    `${transactions.reduce((n, tx) => n + tx.outputs.length, 0)} outputs, ` +
    `${addresses.size} addresses\n`,
);
