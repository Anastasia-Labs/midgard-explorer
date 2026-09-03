#!/usr/bin/env node
/**
 * Real Midgard data, on a laptop, without starting Midgard.
 *
 *   pnpm snapshot:export    capture from a running node database
 *   pnpm snapshot:restore   load a capture into a local database
 *   pnpm snapshot:verify    check a capture against its own manifest
 *
 * The explorer reads the node directly, so development had only a live node or
 * fixtures, and fixtures describe nothing. A snapshot is real data allowed to be
 * stale, and the restored database says so about itself.
 *
 * Captures default to a PRIMARY for a narrow reason. `pg_dump` already takes one
 * MVCC snapshot across every table, so cross-table consistency does not depend
 * on the flag; `--serializable-deferrable` adds a wait for a snapshot no serial
 * ordering could contradict, and a hot standby cannot run serializable
 * transactions. A replica capture is a reasonable way to spare the primary, not
 * a broken one.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Exactly the relations the explorer reads.
 *
 * An allowlist rather than a whole-database dump. The node's database holds
 * operational tables the explorer has no business copying to a laptop, and a
 * capture that grows a table because upstream added one is a capture nobody
 * reviewed.
 */
const TABLES = [
  "blocks",
  "immutable",
  "mempool",
  "processed_mempool",
  "confirmed_ledger",
  "mempool_ledger",
  "address_history",
  "da_payloads",
  "deposits_utxos",
  "withdrawal_utxos",
  "forced_transaction_utxos",
  "pending_block_finalizations",
  "pending_block_finalization_txs",
  "pending_block_finalization_deposits",
  "pending_block_finalization_withdrawals",
  "pending_block_finalization_forced_transactions",
  "tx_admissions",
  "tx_rejections",
];

/** A refusal, raised rather than exited.
 *
 * `die` used to call `process.exit`, which skips every `finally` on the way
 * out. The restore's guard, which re-asserts read-only and rewrites the
 * ownership marker on the way out, therefore never ran on the one path that
 * needs it: a refusal in the middle of a restore. Throwing gives those blocks
 * their turn; `runCli` turns the throw back into an exit code. */
class SnapshotRefusal extends Error {}

const die = (message) => {
  throw new SnapshotRefusal(message);
};

/**
 * libpq environment for a connection string, instead of passing the URL.
 *
 * Two reasons, both found by running this. Prisma URLs carry `?schema=public`,
 * which libpq rejects outright as an invalid query parameter. And a URL on the
 * command line reaches `ps`, and reaches the error message when the command
 * fails: the first run of this script printed the password to the terminal.
 * PG* variables keep the credential out of argv entirely.
 */
function pgEnv(url) {
  const u = new URL(url);
  const env = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGDATABASE: u.pathname.slice(1),
  };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  // libpq understands this one; everything else in a Prisma URL it does not.
  const sslmode = u.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** Never includes the URL, so a failure cannot print a credential. */
const run = (command, args, url, options = {}) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      env: pgEnv(url),
      ...options,
    });
  } catch (error) {
    const detail = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    die(`${command} failed${detail ? `: ${detail}` : "."}`);
  }
};

const psql = (url, sql) => run("psql", ["-At", "-c", sql], url).trim();

/**
 * Client and server must share a major version.
 *
 * A newer `pg_dump` writes SET commands an older server does not recognise, so
 * the capture succeeds, the manifest looks right, and the restore fails on a
 * parameter nobody chose: PostgreSQL 18's client emits `SET transaction_timeout`
 * and a 15 server rejects it. That is a snapshot which is wrong only at the
 * moment someone needs it, which is the worst time to find out.
 *
 * Refused rather than worked around. Stripping the offending statements would
 * make this script responsible for knowing every version's preamble.
 */
function assertVersionMatch(url, tool) {
  const server = Number(psql(url, "SHOW server_version_num;"));
  const serverMajor = Math.floor(server / 10000);
  const reported = run(tool, ["--version"], url).trim();
  const clientMajor = Number(
    /(\d+)/.exec(reported.split(" ").pop() ?? "")?.[1],
  );
  if (!Number.isFinite(clientMajor) || clientMajor === serverMajor) return;
  die(
    `${tool} is PostgreSQL ${clientMajor} and the server is ${serverMajor}. ` +
      `A client of a different major version writes a preamble the server cannot ` +
      `read, so the archive would only fail at restore time. Install the ` +
      `postgresql-client-${serverMajor} package, or run this through a container ` +
      `whose client matches.`,
  );
}

/** A capture's fingerprint, so a restore can refuse a dump that does not match
 * the schema this build reads. Column names and types, not data. */
function schemaFingerprint(url) {
  const rows = psql(
    url,
    `SELECT table_name || ':' || column_name || ':' || data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${TABLES.map((t) => `'${t}'`).join(",")})
      ORDER BY table_name, column_name;`,
  );
  return createHash("sha256").update(rows).digest("hex");
}

const rowCounts = (url) =>
  Object.fromEntries(
    TABLES.map((table) => [
      table,
      Number(psql(url, `SELECT count(*) FROM "${table}";`)),
    ]),
  );

/** Every column the marker must have, with the type it must have. A table that
 * merely shares the name is not this tool's marker. */
const MARKER_COLUMNS = {
  captured_at: "timestamp with time zone",
  source_database: "text",
  deployment_id: "text",
  network: "text",
  archive_sha256: "text",
  restored_at: "timestamp with time zone",
};

/**
 * Whether this tool may replace what is in the target database.
 *
 * "empty"    nothing in the public schema, so there is nothing to lose.
 * "snapshot" carries this tool's own marker, so the tool put the data there.
 * "foreign"  holds something else, and `pg_restore --clean` would drop it.
 *
 * Each answer is evidence, not a name or a guess. Refusing only a database
 * called "midgard" left every other one on the host an environment variable
 * away from `--clean`. Counting `information_schema.tables` called a database
 * of views and sequences empty. Accepting any table NAMED
 * `explorer_snapshot_meta` handed over databases this tool never wrote.
 * `test/snapshot-safety.test.mts` holds one case per hole.
 */
function targetOwnership(url) {
  const objects = Number(
    psql(
      url,
      `SELECT (SELECT count(*) FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public')
            + (SELECT count(*) FROM pg_proc p
                 JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public')
            + (SELECT count(*) FROM pg_type t
                 JOIN pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd'));`,
    ),
  );
  if (objects === 0) return "empty";

  // The marker's shape, not merely its name.
  const columns = psql(
    url,
    `SELECT string_agg(column_name || ' ' || data_type, ', ' ORDER BY column_name)
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'explorer_snapshot_meta';`,
  );
  const expected = Object.entries(MARKER_COLUMNS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, type]) => `${name} ${type}`)
    .join(", ");
  if (columns !== expected) return "foreign";

  // A singleton. The restore writes exactly one row, so zero rows or several
  // mean something other than this tool last wrote the table.
  const rows = Number(
    psql(url, "SELECT count(*) FROM explorer_snapshot_meta;"),
  );
  return rows === 1 ? "snapshot" : "foreign";
}

const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") die(`${name} is not set.`);
  return value;
}

/** Never printed. A connection string carries a password, and this writes a
 * manifest that is meant to be shared. */
const databaseName = (url) => new URL(url).pathname.slice(1);

/**
 * One PostgreSQL snapshot for the dump AND for everything claimed about it.
 *
 * `pg_dump` takes its own snapshot, and the row counts used to be gathered
 * afterwards through eighteen separate statements. Against a node that is still
 * ingesting, those counts describe a later database than the archive does, so a
 * perfectly good capture recorded numbers its own restore would reject. The
 * manifest accused the archive of being wrong when the manifest was.
 *
 * So a psql session opens a read-only transaction, exports its snapshot, and
 * stays open: `pg_dump --snapshot` uses it, and the counts and the fingerprint
 * run inside that same transaction. The isolation moves here from `pg_dump`,
 * which is why `--serializable-deferrable` is no longer passed to it: a
 * SERIALIZABLE READ ONLY DEFERRABLE transaction is what waits for a snapshot no
 * concurrent ordering could contradict, and a standby uses REPEATABLE READ for
 * the same reason it always did.
 */
async function withExportedSnapshot(url, inRecovery, work) {
  // No URL argument. `pgEnv` exists so the connection never reaches a command
  // line, where every user on the host can read it out of `ps`, and because a
  // Prisma URL carries `?schema=public`, which libpq rejects outright:
  // `invalid URI query parameter: "schema"`. Passing both, as this did, gets
  // the leak AND the failure.
  const child = spawn(
    "psql",
    ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    {
      env: pgEnv(url),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  let failure = null;
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("error", (error) => (failure = error));

  /**
   * Sends one statement and resolves with its single-value result.
   *
   * Every statement is followed by a sentinel SELECT, because `BEGIN`, `SET`
   * and friends produce no rows under `-q -A -t`: waiting for a line of output
   * from those waits forever. The sentinel is the only reliable "this statement
   * is finished" signal available over a pipe.
   */
  let sequence = 0;
  const ask = async (sql) => {
    const seen = stdout.length;
    const marker = `__snapshot_ok_${(sequence += 1)}__`;
    child.stdin.write(`${sql}\nSELECT '${marker}';\n`);
    for (let waited = 0; waited < 60_000; waited += 25) {
      if (failure) throw failure;
      if (child.exitCode !== null) {
        throw new Error(`psql exited during capture: ${stderr.trim()}`);
      }
      const fresh = stdout.slice(seen);
      if (fresh.includes(marker)) {
        // Every row, joined and trimmed, so the output is byte-identical to
        // what `psql -At -c` gives. The schema fingerprint hashes this text and
        // the restore recomputes it with that helper, so a difference of one
        // newline would fail every restore.
        return fresh
          .slice(0, fresh.indexOf(marker))
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
          .join("\n")
          .trim();
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`psql did not answer within 60s: ${sql}`);
  };

  try {
    // READ ONLY in both cases. Nothing here writes, and saying so lets the
    // server refuse a statement that would.
    await ask(
      inRecovery
        ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"
        : "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE;",
    );
    const snapshotId = await ask("SELECT pg_export_snapshot();");
    if (!/^[0-9A-Fa-f-]+$/.test(snapshotId)) {
      die(
        `Could not export a snapshot to capture from: ${snapshotId || stderr.trim()}`,
      );
    }
    return await work(snapshotId, ask);
  } finally {
    child.stdin.end("ROLLBACK;\n");
    child.kill();
  }
}

async function exportSnapshot(args) {
  const out = resolve(args.out ?? "snapshots");
  mkdirSync(out, { recursive: true });
  const url = requireEnv("POSTGRES_URL");

  assertVersionMatch(url, "pg_dump");
  const inRecovery = psql(url, "SELECT pg_is_in_recovery();") === "t";
  if (inRecovery && !args.allowReplica) {
    die(
      "Refusing to capture from a standby by default. `pg_dump` would still take " +
        "one consistent snapshot across tables, but PostgreSQL does not allow " +
        "serializable transactions on a hot standby, so the dump cannot also wait " +
        "for a snapshot no concurrent ordering could contradict. Capture from the " +
        "primary, or pass --allow-replica to " +
        "accept a repeatable-read capture whose tables may disagree.",
    );
  }

  // Computed against the source, not assumed, so a table added to the node
  // after this build was written is excluded rather than silently carried.
  const publicTables = psql(
    url,
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const carried = new Set(TABLES);
  const excludedData = publicTables.filter((table) => !carried.has(table));

  const manifestPath = requireEnv("MIDGARD_MANIFEST_PATH");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const capturedAt = new Date().toISOString();
  const stamp = capturedAt.replace(/[:.]/g, "-");
  const archive = join(out, `midgard-${stamp}.dump`);

  process.stdout.write(
    `Capturing ${TABLES.length} relations from "${databaseName(url)}"\n`,
  );
  await withExportedSnapshot(url, inRecovery, async (snapshotId, ask) => {
    run(
      "pg_dump",
      [
        "--format=custom",
        "--compress=9",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshotId}`,
        // Schema-wide for DEFINITIONS, allowlisted for DATA.
        //
        // `--table` selects relations and nothing else, so the enum types the
        // node's columns are declared with were left out of every archive and
        // `pg_restore` into an empty database failed on the first column that
        // used one. Dumping the whole schema fixes that and introduces a worse
        // problem in its place: it would copy the rows of every table the node
        // happens to own, including operational tables the explorer never reads,
        // into a database made for a read-only explorer.
        //
        // So the schema comes whole and the data does not. Every public table
        // outside `TABLES` is dumped as a definition with no rows.
        "--schema=public",
        ...excludedData.flatMap((t) => ["--exclude-table-data", `public.${t}`]),
        "--file",
        archive,
      ],
      url,
      { stdio: "inherit" },
    );

    const meta = {
      kind: "midgard-explorer-snapshot",
      version: 1,
      capturedAt,
      consistency: inRecovery ? "repeatable-read" : "serializable-deferrable",
      sourceDatabase: databaseName(url),
      sourceWasReplica: inRecovery,
      deploymentId: manifest.manifestId ?? null,
      // Lowercased, as `src/indexer/manifest.ts` does when it parses the same
      // document. The manifest spells the network "Preprod"; the reader below
      // requires lowercase, so writing it verbatim made every archive captured
      // from a real manifest unreadable by this tool's own verify and restore.
      network:
        typeof manifest.network === "string"
          ? manifest.network.toLowerCase()
          : null,
      // Both read inside the exporting transaction, so they describe the same
      // database state the archive holds rather than a later one.
      schemaFingerprint: await fingerprintInSession(ask),
      rowCounts: await countsInSession(ask),
      /** The tables whose ROWS this archive carries. Every other table in the
       * schema is present as a definition and empty by design, so a restore that
       * finds rows in one of them is not a snapshot this tool wrote. */
      dataTables: [...TABLES],
      archive: basename(archive),
      archiveBytes: statSync(archive).size,
      archiveSha256: sha256(archive),
    };
    const metaPath = `${archive}.json`;
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

    process.stdout.write(`\nSnapshot  ${archive}\nManifest  ${metaPath}\n`);
    process.stdout.write(
      `Captured  ${capturedAt} (${meta.consistency})\n` +
        `Rows      ${Object.values(meta.rowCounts).reduce((a, b) => a + b, 0)}\n`,
    );
  });
}

/** The same eighteen counts, asked inside the transaction that exported the
 * dump's snapshot. */
async function countsInSession(ask) {
  const entries = [];
  for (const table of TABLES) {
    entries.push([
      table,
      Number(await ask(`SELECT count(*) FROM "${table}";`)),
    ]);
  }
  return Object.fromEntries(entries);
}

/** The column fingerprint, likewise from the dump's own snapshot: a migration
 * applied mid-capture would otherwise be recorded against an archive taken
 * before it. */
async function fingerprintInSession(ask) {
  // The SAME statement text as `schemaFingerprint`, deliberately. The restore
  // recomputes the fingerprint with that helper and compares digests, so these
  // two must agree down to the row order.
  const rows = await ask(
    `SELECT table_name || ':' || column_name || ':' || data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${TABLES.map((t) => `'${t}'`).join(",")})
      ORDER BY table_name, column_name;`,
  );
  return createHash("sha256").update(rows).digest("hex");
}

/**
 * Writes the ownership marker. Extracted because it is now called twice: once
 * on the success path, and once from the failure path, where a restore that
 * dropped the marker and then died would otherwise leave a database this tool
 * no longer recognises as its own. The next restore would demand `--force` to
 * reclaim a database it had written itself.
 */
function writeMarker(url, meta, writable) {
  run(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `captured_at=${meta.capturedAt}`,
      "-v",
      `source_database=${meta.sourceDatabase}`,
      "-v",
      `deployment_id=${meta.deploymentId ?? ""}`,
      "-v",
      `network=${meta.network ?? ""}`,
      "-v",
      `archive_sha256=${meta.archiveSha256}`,
      // Read from stdin, NOT `-c`. psql performs variable interpolation in
      // files and standard input but not in `-c`, where `:'captured_at'` is
      // passed to the server verbatim and fails as a syntax error. The marker
      // write therefore never succeeded, and a restore reported a target it
      // could not claim.
      "-f",
      "-",
    ],
    url,
    {
      ...writable,
      input: `CREATE TABLE IF NOT EXISTS explorer_snapshot_meta (
         captured_at timestamptz NOT NULL,
         source_database text NOT NULL,
         deployment_id text,
         network text,
         archive_sha256 text NOT NULL,
         restored_at timestamptz NOT NULL DEFAULT now()
       );
       DELETE FROM explorer_snapshot_meta;
       INSERT INTO explorer_snapshot_meta
         (captured_at, source_database, deployment_id, network, archive_sha256)
       VALUES (:'captured_at'::timestamptz, :'source_database',
               NULLIF(:'deployment_id', ''), NULLIF(:'network', ''),
               :'archive_sha256');`,
    },
  );
}

/** Puts back the marker a failed restore removed, from the values read before
 * anything was touched. Same shape as `writeMarker`, different source of truth:
 * this one asserts what the database still holds, not what was being written. */
function restoreMarker(url, packed, writable) {
  const [capturedAt, sourceDatabase, deploymentId, network, archiveSha256] =
    packed.split("|");
  writeMarker(
    url,
    {
      capturedAt,
      sourceDatabase,
      deploymentId: deploymentId || null,
      network: network || null,
      archiveSha256,
    },
    writable,
  );
}

/** A PostgreSQL identifier this tool is willing to name in DDL.
 *
 * Identifiers cannot be passed as parameters, so the only safe handling is to
 * refuse anything that is not a plain lowercase name. A database called
 * `x"; DROP DATABASE midgard; --` is a legal name and was previously
 * interpolated straight into `ALTER DATABASE`. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

const SNAPSHOT_KIND = "midgard-explorer-snapshot";
/** Bumped when the manifest shape changes; an archive from another version is
 * refused rather than read on a guess. */
const SNAPSHOT_VERSION = 1;

/**
 * The sidecar, validated rather than trusted.
 *
 * Only the archive checksum used to be checked, and every other field went
 * straight into SQL. A manifest is a file next to a file: anyone who can hand
 * over an archive can hand over its manifest, so its shape and its values are
 * input, not fact.
 */
const readMeta = (archive) => {
  const metaPath = `${archive}.json`;
  if (!existsSync(metaPath))
    die(`No manifest beside ${archive}. Expected ${metaPath}.`);

  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (error) {
    die(`Manifest at ${metaPath} is not valid JSON: ${String(error)}`);
  }
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    die(`Manifest at ${metaPath} is not an object.`);
  }

  const text = (name, { required = true, pattern = null } = {}) => {
    const value = meta[name];
    if (value === undefined || value === null) {
      if (required) die(`Manifest at ${metaPath} is missing "${name}".`);
      return null;
    }
    if (typeof value !== "string")
      die(`Manifest field "${name}" is not a string.`);
    if (pattern && !pattern.test(value)) {
      die(`Manifest field "${name}" is malformed: ${value.slice(0, 80)}`);
    }
    return value;
  };

  if (text("kind") !== SNAPSHOT_KIND) {
    die(`Manifest at ${metaPath} is not a ${SNAPSHOT_KIND}.`);
  }
  if (meta.version !== SNAPSHOT_VERSION) {
    die(
      `Manifest at ${metaPath} declares version ${JSON.stringify(meta.version)}; ` +
        `this tool writes and reads ${SNAPSHOT_VERSION}.`,
    );
  }
  if (typeof meta.sourceWasReplica !== "boolean") {
    die(`Manifest field "sourceWasReplica" is not a boolean.`);
  }
  if (!Number.isInteger(meta.archiveBytes) || meta.archiveBytes <= 0) {
    die(`Manifest field "archiveBytes" is not a positive integer.`);
  }
  const validated = {
    kind: SNAPSHOT_KIND,
    capturedAt: text("capturedAt", { pattern: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/ }),
    sourceDatabase: text("sourceDatabase", { pattern: SAFE_IDENTIFIER }),
    deploymentId: text("deploymentId", {
      required: false,
      pattern: /^[0-9a-f-]{1,80}$/,
    }),
    network: text("network", { required: false, pattern: /^[a-z]{1,20}$/ }),
    archiveSha256: text("archiveSha256", { pattern: /^[0-9a-f]{64}$/ }),
    schemaFingerprint: text("schemaFingerprint", { pattern: /^[0-9a-f]{64}$/ }),
    // Read rather than discarded. `verifySnapshot` printed this field while
    // `readMeta` dropped it, so the line reported `undefined` for every archive.
    consistency: text("consistency", {
      pattern: /^(serializable-deferrable|repeatable-read)$/,
    }),
    archive: text("archive", { pattern: /^[A-Za-z0-9._-]{1,120}$/ }),
    sourceWasReplica: meta.sourceWasReplica,
    archiveBytes: meta.archiveBytes,
    version: SNAPSHOT_VERSION,
  };

  // The archive on disk is the archive the manifest describes. A checksum alone
  // proves the bytes are intact and says nothing about whether they are the
  // bytes this manifest was written for.
  if (basename(archive) !== validated.archive) {
    die(
      `Manifest names archive "${validated.archive}" but this file is ` +
        `"${basename(archive)}".`,
    );
  }
  const actualBytes = statSync(archive).size;
  if (actualBytes !== meta.archiveBytes) {
    die(
      `Archive is ${actualBytes} bytes; the manifest says ${meta.archiveBytes}.`,
    );
  }
  if (meta.rowCounts === null || typeof meta.rowCounts !== "object") {
    die(`Manifest at ${metaPath} has no rowCounts object.`);
  }
  for (const [table, count] of Object.entries(meta.rowCounts)) {
    if (!Number.isInteger(count) || count < 0) {
      die(`Manifest rowCounts.${table} is not a non-negative integer.`);
    }
  }
  // Checked here rather than after the restore. A missing key used to surface
  // as an `undefined` row-count comparison once the target had already been
  // dropped and rewritten, which is the worst moment to discover the manifest
  // was incomplete.
  const declared = Array.isArray(meta.dataTables)
    ? meta.dataTables.map(String)
    : null;
  if (declared === null || declared.join(",") !== [...TABLES].join(",")) {
    die(
      `Manifest at ${metaPath} carries data for a different set of tables than ` +
        `this build reads. Restoring it would populate an explorer from an ` +
        `archive whose contents this build cannot describe.`,
    );
  }

  const missing = TABLES.filter((table) => !(table in meta.rowCounts));
  if (missing.length > 0) {
    die(
      `Manifest at ${metaPath} has no row count for ${missing.join(", ")}. ` +
        `It was written for a different set of tables than this build reads.`,
    );
  }
  return { ...validated, rowCounts: meta.rowCounts };
};

function verifySnapshot(args) {
  const archive = resolve(args._[0] ?? die("Usage: snapshot:verify <archive>"));
  const meta = readMeta(archive);
  const actual = sha256(archive);
  if (actual !== meta.archiveSha256) {
    die(
      `Checksum mismatch.\n  manifest ${meta.archiveSha256}\n  archive  ${actual}`,
    );
  }
  process.stdout.write(
    `Verified  ${basename(archive)}\n` +
      `Captured  ${meta.capturedAt} from "${meta.sourceDatabase}" (${meta.consistency})\n` +
      `Network   ${meta.network ?? "unknown"}\n` +
      `Deployment ${meta.deploymentId ?? "unknown"}\n` +
      `Rows      ${Object.values(meta.rowCounts).reduce((a, b) => a + b, 0)}\n`,
  );
}

/**
 * Restores into a database this script creates, never into one it found.
 *
 * The target must not be the live node database, and the guard is a refusal
 * rather than a warning: the explorer once read a phase-4 test database for
 * weeks and presented it as the live chain, and the cause was one line in a
 * gitignored .env.
 */
function restoreSnapshot(args) {
  const archive = resolve(
    args._[0] ?? die("Usage: snapshot:restore <archive>"),
  );
  const meta = readMeta(archive);
  if (sha256(archive) !== meta.archiveSha256)
    die("Checksum mismatch. Refusing to restore.");

  const url = requireEnv("SNAPSHOT_TARGET_URL");
  const target = databaseName(url);

  // An identifier, because `ALTER DATABASE` cannot take a parameter. Anything
  // that is not a plain lowercase name is refused rather than quoted, since a
  // legal database name may contain a quote.
  if (!SAFE_IDENTIFIER.test(target)) {
    die(
      `Refusing to restore into "${target}": not a plain lowercase identifier.`,
    );
  }

  // Ownership, not a name check.
  //
  // This refused exactly one name, "midgard", and ran `pg_restore --clean
  // --if-exists` against anything else. Every other database on the host was
  // therefore one environment variable away from being emptied: a colleague's
  // development database, a staging copy, a production replica.
  //
  // This tool does NOT create the target database. It restores into one that
  // already exists, which is exactly why the check below has to be careful:
  // the database on the other end of SNAPSHOT_TARGET_URL was made by someone,
  // for something.
  //
  // A target is now acceptable only if it is EMPTY, or if it already carries
  // this tool's marker, which means the tool put the data there and may replace
  // it. Overwriting anything else takes an explicit flag AND the target named
  // back, because a destructive default is a destructive default however well
  // documented.
  const ownership = targetOwnership(url);
  if (ownership !== "empty" && ownership !== "snapshot") {
    if (args.force !== target) {
      die(
        `Refusing to restore into "${target}": it holds data this tool did not ` +
          `put there.\n` +
          `  pg_restore --clean would drop and replace its objects.\n` +
          `  If that is genuinely intended, re-run with --force=${target}.\n` +
          `  Otherwise point SNAPSHOT_TARGET_URL at an empty database.`,
      );
    }
    process.stdout.write(
      `--force=${target} given; replacing a database this tool does not own\n`,
    );
  }

  assertVersionMatch(url, "pg_restore");

  // Cleared before restoring, set again at the end. The last restore left the
  // database read-only, which is right for serving and fatal for refreshing:
  // `pg_restore` opens its own session, inherits the database-level setting and
  // dies on the first ALTER TABLE, so a snapshot target could be written once
  // and never updated. Takes effect for sessions started after this statement,
  // which is why it is its own invocation rather than part of the restore.
  // The database-level read-only setting is never cleared.
  //
  // Clearing it opened a window: everything between the RESET and the final SET
  // ran against a writable database, so a restore that failed anywhere in
  // between left a snapshot open to writes, silently, until someone noticed.
  // A session-level override does the same job with no window at all, because
  // it dies with the process that asked for it.
  const writable = {
    env: { ...pgEnv(url), PGOPTIONS: "-c default_transaction_read_only=off" },
  };

  // Everything from here to the marker write is the stretch where this database
  // is neither the old snapshot nor the new one. A failure inside it used to
  // leave the target with no marker at all, so the tool no longer recognised a
  // database it had written and the next restore demanded `--force` to reclaim
  // it. The marker is therefore re-asserted on the way out, whichever way the
  // restore ended.
  // What this database was before the restore touched it, so a failure can put
  // its identity back rather than inventing one.
  const previousMarker =
    ownership === "snapshot"
      ? psql(
          url,
          `SELECT captured_at || '|' || source_database || '|' ||
                  coalesce(deployment_id, '') || '|' || coalesce(network, '') || '|' ||
                  archive_sha256
             FROM explorer_snapshot_meta LIMIT 1;`,
        )
      : null;

  let markerWritten = false;
  let restoreApplied = false;
  try {
    // The marker is this tool's own, and it is not in the archive, so it is the
    // one object left holding schema `public` open when `pg_restore --clean`
    // tries to drop it. Removed here and written again at the end. A separate
    // invocation from the ALTER above: `psql -c` wraps multiple statements in a
    // transaction, and ALTER DATABASE cannot run inside one.
    if (ownership === "snapshot") {
      run(
        "psql",
        ["-c", "DROP TABLE IF EXISTS explorer_snapshot_meta;"],
        url,
        writable,
      );
    }
    process.stdout.write(`Restoring ${basename(archive)} into "${target}"\n`);
    run(
      "pg_restore",
      [
        // The NAME only. pg_restore requires an explicit --dbname and will not
        // take it from PGDATABASE; the credential stays in the environment.
        "--dbname",
        target,
        "--no-owner",
        "--no-privileges",
        // All or nothing. A half-restored database is one that answers queries
        // with a subset of the chain and says nothing about it.
        "--single-transaction",
        "--clean",
        "--if-exists",
        archive,
      ],
      url,
      { stdio: "inherit", ...writable },
    );

    // `pg_restore --single-transaction` has either applied the whole archive or
    // none of it. Past this line the database holds the new data, so the old
    // identity is no longer true of it.
    restoreApplied = true;

    const fingerprint = schemaFingerprint(url);
    if (fingerprint !== meta.schemaFingerprint) {
      die(
        `Restored schema does not match the capture.\n` +
          `  captured ${meta.schemaFingerprint}\n  restored ${fingerprint}\n` +
          `The archive was taken from a different node schema than this one reads.`,
      );
    }

    const counts = rowCounts(url);
    const drift = TABLES.filter((t) => counts[t] !== meta.rowCounts[t]).map(
      (t) => `${t}: expected ${meta.rowCounts[t]}, restored ${counts[t]}`,
    );
    if (drift.length > 0)
      die(`Row counts do not match the capture:\n  ${drift.join("\n  ")}`);

    // The marker `src/db/source.ts` reads. Without it a restored snapshot is
    // indistinguishable from a fixture, and being called a fixture is the safe
    // way for that to fail rather than the correct answer.
    // psql variables, not string interpolation. `:'name'` is quoted and escaped
    // by psql itself, so a manifest value cannot close the literal and continue
    // the statement. The values are validated on the way in as well; this is the
    // second of the two, because one of them alone has been enough to fail
    // before.
    writeMarker(url, meta, writable);
    markerWritten = true;

    // Inside the guarded block, where `counts` is in scope and, more to the
    // point, only on the path that actually succeeded.
    process.stdout.write(
      `\nRestored  ${Object.values(counts).reduce((a, b) => a + b, 0)} rows into "${target}"\n` +
        `Captured  ${meta.capturedAt}\n` +
        `The explorer will report this source as a snapshot, not as live or as a fixture.\n`,
    );
  } finally {
    if (!markerWritten) {
      // The marker states which archive this database holds, VERIFIED. Three
      // failures used to end with the incoming archive's identity written over
      // whatever was actually there:
      //
      //   - a refusal before `pg_restore` left the OLD snapshot's rows labelled
      //     as the new archive;
      //   - a refusal after it left unverified rows labelled as verified;
      //   - a failure against an empty target labelled an empty database a
      //     valid snapshot of real data.
      //
      // So the only marker ever written here is the one that was already true:
      // the previous snapshot's, and only while that snapshot is still the data
      // in the database. Anything else is left unmarked, which costs a `--force`
      // on the next restore and is the correct price for not knowing.
      if (!restoreApplied && previousMarker !== null && previousMarker !== "") {
        try {
          restoreMarker(url, previousMarker, writable);
        } catch {
          // Already failing. Report the original error, not this one.
        }
      }
    }

    // Read-only by default: the explorer never writes to the node's database,
    // and a local copy that permits writes invites a divergence nothing would
    // notice. In the finally, because a failed restore must not leave a
    // writable database behind either.
    run(
      "psql",
      [
        "-c",
        `ALTER DATABASE "${target}" SET default_transaction_read_only = on;`,
      ],
      url,
      writable,
    );
  }
}

const argv = process.argv.slice(2);
const args = {
  _: argv.filter((a) => !a.startsWith("--")),
  allowReplica: argv.includes("--allow-replica"),
  out: argv.find((a) => a.startsWith("--out="))?.slice("--out=".length),
  // Takes the target's NAME, not a bare boolean. A destructive flag that can be
  // pasted from a wiki page without naming what it destroys is not a
  // confirmation.
  force: argv.find((a) => a.startsWith("--force="))?.slice("--force=".length),
  adopt: argv.includes("--adopt"),
};
const command = args._.shift();

// Only when RUN as a command. `TABLES` and `schemaFingerprint` are imported by
// the test suite, and a module that dispatches on `process.argv` at import time
// exits the importer with a usage message instead.
const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) runCli();

/** One place where a refusal becomes an exit code, so every path reports the
 * same way and no `finally` is skipped on the way there. */
function fail(error) {
  process.stderr.write(`${error?.message ?? String(error)}\n`);
  process.exit(1);
}

function runCli() {
  try {
    runCommand();
  } catch (error) {
    fail(error);
  }
}

function runCommand() {
  switch (command) {
    case "export":
      // The only async command: the capture holds a psql session open so the
      // dump, the counts and the fingerprint share one snapshot. A rejection
      // still has to exit non-zero, which an unhandled promise would not.
      exportSnapshot(args).catch(fail);
      break;
    case "restore":
      restoreSnapshot(args);
      break;
    case "verify":
      verifySnapshot(args);
      break;
    default:
      die(
        "Usage:\n" +
          "  snapshot.mjs export [--out=DIR] [--allow-replica]\n" +
          "  snapshot.mjs restore <archive>\n" +
          "  snapshot.mjs verify <archive>",
      );
  }
}

export { TABLES, schemaFingerprint };
